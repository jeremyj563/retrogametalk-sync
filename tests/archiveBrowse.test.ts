import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import yazl from 'yazl';
import {
  filterArchiveEntries,
  isBrowsableArchiveName,
  listArchiveDirectoryAtPath,
  normalizeArchiveSubpath,
} from '../src/shared/archiveTree.ts';
import {
  browseArchiveAtPath,
  classifyArchiveEntry,
  classifyArchiveMagicBytes,
  detect7zRarSupportFromInfoOutput,
  listArchiveEntries,
  parseBsdtarVerboseOutput,
  parseUnrarLtOutput,
  readArchiveTextPreview,
} from '../src/server/archiveService.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-archive-browse-'));
const sampleZipPath = path.join(tempRoot, 'Chrono Trigger (USA) [T-En].zip');

function createTestZip(outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.alloc(2048, 0x41), 'Chrono Trigger.sfc');
    zip.addBuffer(Buffer.from('Chrono Trigger Translation v1.2\nEnjoy the game!\n', 'utf8'), 'Docs/README.txt');
    zip.addBuffer(Buffer.from('PATCH_DATA', 'utf8'), 'Docs/Patches/fix.ips');
    zip.addBuffer(Buffer.from('FILE "Disc 1.bin" BINARY\n  TRACK 01 MODE2/2352\n', 'utf8'), 'Extras/Disc 1.cue');
    zip.addBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'Docs/fake-binary.txt');
    zip.addBuffer(Buffer.from('A'.repeat(2000), 'utf8'), 'Docs/long-notes.md');

    const out = fs.createWriteStream(outPath);
    out.on('error', reject);
    out.on('close', () => resolve());
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);
    zip.end();
  });
}

before(async () => {
  await createTestZip(sampleZipPath);
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('archiveTree helpers detect archive extensions, navigate nested folders, compute totals, and deep-search', () => {
  assert.equal(isBrowsableArchiveName('Super Metroid.zip'), true);
  assert.equal(isBrowsableArchiveName('Metal Gear.7z'), true);
  assert.equal(isBrowsableArchiveName('Castlevania.rar'), true);
  assert.equal(isBrowsableArchiveName('Bundle.tar.gz'), true);
  assert.equal(isBrowsableArchiveName('Super Metroid.sfc'), false);
  assert.equal(normalizeArchiveSubpath('/Docs\\Patches//'), 'Docs/Patches');

  const entries = [
    classifyArchiveEntry('Chrono Trigger.sfc', 2048),
    classifyArchiveEntry('Docs/README.txt', 48),
    classifyArchiveEntry('Docs/Patches/fix.ips', 10),
    classifyArchiveEntry('Extras/Disc 1.cue', 54),
  ];

  const rootView = listArchiveDirectoryAtPath(entries, '');
  assert.equal(rootView.currentPath, '');
  assert.equal(rootView.parentPath, null);
  assert.deepEqual(rootView.breadcrumbs, []);
  assert.deepEqual(
    rootView.folders.map((f) => ({ name: f.name, fileCount: f.fileCount, totalBytes: f.totalBytes })),
    [
      { name: 'Docs', fileCount: 2, totalBytes: 58 },
      { name: 'Extras', fileCount: 1, totalBytes: 54 },
    ],
  );
  assert.deepEqual(rootView.files.map((f) => f.name), ['Chrono Trigger.sfc']);

  const docsView = listArchiveDirectoryAtPath(entries, 'Docs');
  assert.equal(docsView.currentPath, 'Docs');
  assert.equal(docsView.parentPath, '');
  assert.deepEqual(docsView.breadcrumbs, [{ label: 'Docs', path: 'Docs' }]);
  assert.deepEqual(docsView.folders.map((f) => f.path), ['Docs/Patches']);
  assert.deepEqual(docsView.files.map((f) => f.path), ['Docs/README.txt']);

  const patchesView = listArchiveDirectoryAtPath(entries, 'Docs/Patches');
  assert.equal(patchesView.parentPath, 'Docs');
  assert.deepEqual(patchesView.files.map((f) => f.name), ['fix.ips']);

  const searchMatches = filterArchiveEntries(entries, 'readme');
  assert.deepEqual(searchMatches.map((e) => e.path), ['Docs/README.txt']);

  const patchMatches = filterArchiveEntries(entries, 'patch');
  assert.deepEqual(patchMatches.map((e) => e.path), ['Docs/Patches/fix.ips']);
});

test('browseArchiveAtPath and readArchiveTextPreview inspect real ZIP archives without unpacking to disk', async () => {
  const listing = await browseArchiveAtPath(sampleZipPath);
  assert.equal(listing.archiveFormat, 'zip');
  assert.equal(listing.sourceFilename, 'Chrono Trigger (USA) [T-En].zip');
  assert.equal(listing.totalFiles, 6);
  assert.ok(listing.archiveSizeBytes > 0);

  const byPath = new Map(listing.entries.map((e) => [e.path, e]));
  assert.equal(byPath.get('Chrono Trigger.sfc')?.category, 'rom');
  assert.equal(byPath.get('Chrono Trigger.sfc')?.previewableText, false);
  assert.equal(byPath.get('Docs/README.txt')?.category, 'doc');
  assert.equal(byPath.get('Docs/README.txt')?.previewableText, true);
  assert.equal(byPath.get('Docs/Patches/fix.ips')?.category, 'patch');
  assert.equal(byPath.get('Extras/Disc 1.cue')?.category, 'disc');
  assert.equal(byPath.get('Extras/Disc 1.cue')?.previewableText, true);

  // Full UTF-8 text preview
  const readme = await readArchiveTextPreview(sampleZipPath, 'Docs/README.txt');
  assert.equal(readme.filename, 'README.txt');
  assert.equal(readme.truncated, false);
  assert.ok(readme.text.includes('Chrono Trigger Translation v1.2'));

  // Truncation boundary respected
  const truncated = await readArchiveTextPreview(sampleZipPath, 'Docs/long-notes.md', 256);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.bytesRead, 256);
  assert.equal(truncated.text.length, 256);

  // Binary null-byte file disguised as .txt is rejected cleanly
  await assert.rejects(
    () => readArchiveTextPreview(sampleZipPath, 'Docs/fake-binary.txt'),
    /binary data/i,
  );

  // Non-text ROM binary is rejected cleanly
  await assert.rejects(
    () => readArchiveTextPreview(sampleZipPath, 'Chrono Trigger.sfc'),
    /not supported/i,
  );
});

test('RAR parsers, 7-Zip RAR codec detection, and archive magic-byte sniffing handle RAR4/RAR5 and corrupt files', async () => {
  const unrarSample = `
UNRAR 7.10 freeware      Copyright (c) 1993-2025 Alexander Roshal

Archive: /run/repo/sega_cd_isos/sonic-megamix-hack/Sonic Megamix 5.0a BIN.rar
Details: RAR 5

        Name: Sonic Megamix 5.0a (Track 01).bin
        Type: File
        Size: 451234567
 Packed size: 210123456
       Ratio: 46%
       mtime: 2024-03-10 12:34:56,000000000
  Attributes: ..A....
     Host OS: Windows
 Compression: RAR 5.0(v50) -m3 -md=32m

        Name: Docs
        Type: Directory
        Size: 0
  Attributes: ..D....

        Name: Docs\\Sonic Megamix 5.0a.cue
        Type: File
        Size: 1420
  Attributes: ..A....

        Name: ../escape.bin
        Type: File
        Size: 128

        Name: __MACOSX/._Sonic Megamix 5.0a.cue
        Type: File
        Size: 212
`;

  const unrarEntries = parseUnrarLtOutput(unrarSample);
  assert.deepEqual(unrarEntries, [
    { entryPath: 'Sonic Megamix 5.0a (Track 01).bin', sizeBytes: 451234567, isDir: false },
    { entryPath: 'Docs/Sonic Megamix 5.0a.cue', sizeBytes: 1420, isDir: false },
  ]);

  const bsdtarSample = [
    'drwxr-xr-x  0 0      0           0 Mar 10  2024 Docs/',
    '-rw-r--r--  0 0      0   451234567 Mar 10  2024 Sonic Megamix 5.0a (Track 01).bin',
    '-rw-rw-rw-  0 0      0        1420 Sep 30 19:41 Docs/Sonic Megamix 5.0a.cue',
    '-rw-r--r--  0 0      0          64 Sep 30 19:41 ../bad.bin',
  ].join('\n');

  const bsdtarEntries = parseBsdtarVerboseOutput(bsdtarSample);
  assert.deepEqual(bsdtarEntries, [
    { entryPath: 'Sonic Megamix 5.0a (Track 01).bin', sizeBytes: 451234567, isDir: false },
    { entryPath: 'Docs/Sonic Megamix 5.0a.cue', sizeBytes: 1420, isDir: false },
  ]);

  assert.equal(
    detect7zRarSupportFromInfoOutput(
      'Formats:\n 0  7z                   7z\n 0  Rar5                 rar r00\n 0  zip                  zip\n\nCodecs:\n',
    ),
    true,
  );
  assert.equal(
    detect7zRarSupportFromInfoOutput(
      'Formats:\n 0  7z                   7z\n 0  zip                  zip\n\nCodecs:\n',
    ),
    false,
  );

  assert.equal(
    classifyArchiveMagicBytes(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 0x00])).kind,
    'rar5',
  );
  assert.equal(
    classifyArchiveMagicBytes(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0xcf])).kind,
    'rar4',
  );
  assert.equal(
    classifyArchiveMagicBytes(Buffer.from('<!DOCTYPE html><html><body>Login</body></html>', 'utf8')).kind,
    'html',
  );
  assert.equal(classifyArchiveMagicBytes(Buffer.alloc(0)).kind, 'empty');

  const htmlRarPath = path.join(tempRoot, 'bad-download.rar');
  fs.writeFileSync(htmlRarPath, '<!DOCTYPE html><html><body>Cloudflare challenge</body></html>', 'utf8');
  await assert.rejects(() => listArchiveEntries(htmlRarPath), /HTML page/i);

  const emptyRarPath = path.join(tempRoot, 'empty.rar');
  fs.writeFileSync(emptyRarPath, Buffer.alloc(0));
  await assert.rejects(() => listArchiveEntries(emptyRarPath), /empty \(0 bytes\)/i);
});
