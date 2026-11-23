import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import express from 'express';
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
  escapeBsdtarGlobPattern,
  escapeUnzipGlobPattern,
  inspectArchiveForItem,
  isClutterEntry,
  isMarkdownDocEntry,
  listArchiveEntries,
  parseBsdtarVerboseOutput,
  parseUnrarLtOutput,
  readArchiveTextPreview,
  resolve7zBinary,
  streamExtractedEntryToResponse,
} from '../src/server/archiveService.ts';
import type { ReleaseFileRecord, RepositoryItemRecord } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-archive-browse-'));
const sampleZipPath = path.join(tempRoot, 'Chrono Trigger (USA) [T-En].zip');
const genesisZipPath = path.join(tempRoot, 'Sonic the Hedgehog (USA, Europe).zip');
const genesis7zPath = path.join(tempRoot, 'Genesis Edge Cases.7z');

const genesisRomPayload = Buffer.alloc(262_144, 0x53); // 256 KB binary Genesis ROM
const smallHomebrewPayload = Buffer.alloc(32_768, 0x4d); // 32 KB tiny Genesis homebrew

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

function createGenesisZip(outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(genesisRomPayload, 'Sonic the Hedgehog (USA, Europe) [!].md');
    zip.addBuffer(Buffer.from('# Sonic Hack\nReadme instructions.\n', 'utf8'), 'README.md');
    zip.addBuffer(Buffer.from('v1.0 initial\n', 'utf8'), 'CHANGELOG.md');
    zip.addBuffer(smallHomebrewPayload, 'Pokémon – Mini Demo (World).md');
    zip.addBuffer(smallHomebrewPayload, '-Leading Dash.md');
    zip.addBuffer(smallHomebrewPayload, '@AtPrefix.md');

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
  await createGenesisZip(genesisZipPath);
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
  assert.equal(byPath.get('Docs/long-notes.md')?.category, 'doc');
  assert.equal(byPath.get('Docs/long-notes.md')?.previewableText, true);
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

test('Sega Genesis / Mega Drive .md ROMs are recognized as playable ROMs while Markdown docs remain stripped', async () => {
  // Unit checks for disambiguation rules
  assert.equal(isMarkdownDocEntry('Sonic the Hedgehog (USA).md', 524_288, 'sega_genesis_roms'), false);
  assert.equal(isMarkdownDocEntry('Sonic the Hedgehog (USA).md', 524_288), false);
  assert.equal(isMarkdownDocEntry('Tiny Homebrew (PD).md', 32_768, 'sega_genesis_roms'), false);
  assert.equal(isMarkdownDocEntry('README.md', 4_096, 'sega_genesis_roms'), true);
  assert.equal(isMarkdownDocEntry('CHANGELOG.md', 2_048, 'sega_genesis_roms'), true);
  assert.equal(isMarkdownDocEntry('Docs/notes.md', 8_192, 'sega_genesis_roms'), true);
  assert.equal(isMarkdownDocEntry('HackInfo.md', 6_000, 'snes_roms'), true);
  assert.equal(isClutterEntry('Sonic the Hedgehog (USA).md', 524_288, 'sega_genesis_roms'), false);
  assert.equal(isClutterEntry('README.md', 4_096, 'sega_genesis_roms'), true);

  // Archive Explorer classification with systemName context
  const listing = await browseArchiveAtPath(genesisZipPath, 'sega_genesis_roms');
  const byPath = new Map(listing.entries.map((e) => [e.path, e]));
  assert.equal(byPath.get('Sonic the Hedgehog (USA, Europe) [!].md')?.category, 'rom');
  assert.equal(byPath.get('Sonic the Hedgehog (USA, Europe) [!].md')?.previewableText, false);
  assert.equal(byPath.get('README.md')?.category, 'doc');
  assert.equal(byPath.get('README.md')?.previewableText, true);
  assert.equal(byPath.get('CHANGELOG.md')?.category, 'doc');
  assert.equal(byPath.get('CHANGELOG.md')?.previewableText, true);

  // Full inspectArchiveForItem on a Sega Genesis release
  const mockFile: ReleaseFileRecord = {
    id: 101,
    releaseId: 501,
    remoteUrl: 'https://example.invalid/sonic',
    downloadUrl: 'https://example.invalid/sonic.zip',
    remotePath: '/sega_genesis_roms/Sonic the Hedgehog (USA, Europe).zip',
    localPath: genesisZipPath,
    filename: 'Sonic the Hedgehog (USA, Europe).zip',
    displayLabel: 'Sonic the Hedgehog (USA, Europe).zip',
    fileRole: 'ROM',
    fileSizeBytes: fs.statSync(genesisZipPath).size,
    status: 'downloaded',
    errorMessage: null,
    lastRunId: null,
    discoveredAt: '2026-11-23T00:00:00.000Z',
    downloadedAt: '2026-11-23T00:00:00.000Z',
  };
  const mockItem: RepositoryItemRecord = {
    id: 501,
    wpPostId: null,
    wpPostType: null,
    remoteUrl: 'https://example.invalid/sonic',
    remotePath: '/sega_genesis_roms/sonic',
    localPath: genesisZipPath,
    systemName: 'sega_genesis_roms',
    releaseType: 'Retail',
    releaseTags: ['Retail'],
    title: 'Sonic the Hedgehog',
    fileSizeBytes: mockFile.fileSizeBytes,
    publishedAt: null,
    remoteUpdatedAt: null,
    remoteCheckedAt: null,
    status: 'downloaded',
    errorMessage: null,
    lastRunId: null,
    discoveredAt: '2026-11-23T00:00:00.000Z',
    downloadedAt: '2026-11-23T00:00:00.000Z',
    publisher: null,
    developer: null,
    releaseYear: null,
    genres: ['Platformer'],
    regions: ['USA', 'Europe'],
    languages: ['English'],
    sources: [],
    coverLocalPath: null,
    screenshotsCount: 0,
    hasMetadata: false,
    metadata: null,
    installedAt: null,
    installedDeviceLabel: null,
    installedFileId: null,
    installedFilename: null,
    isFavorite: false,
    syncOverride: 'default',
    collectionIds: [],
    filesCount: 1,
    files: [mockFile],
  };

  const inspection = await inspectArchiveForItem(mockItem, mockFile, genesisZipPath, {
    romNamingTemplate: '{title}{region}{lang}{role}{version}',
    romSanitizeFat32: true,
    romMaxFilenameLen: 180,
  });

  assert.equal(inspection.patchOnly, false);
  assert.equal(inspection.ignoredEntriesCount, 2); // README.md and CHANGELOG.md stripped
  assert.equal(inspection.playableTargets.length, 4); // All 4 Genesis .md ROMs detected
  const targetEntries = inspection.playableTargets.map((t) => t.primaryEntry);
  assert.ok(targetEntries.includes('Sonic the Hedgehog (USA, Europe) [!].md'));
  assert.ok(targetEntries.includes('Pokémon – Mini Demo (World).md'));
  assert.ok(targetEntries.includes('-Leading Dash.md'));
  assert.ok(targetEntries.includes('@AtPrefix.md'));
});

test('glob escaping and streamExtractedEntryToResponse handle brackets, UTF-8 under LANG=C, leading -/@, and errors cleanly', async () => {
  assert.equal(
    escapeUnzipGlobPattern('Sonic (USA) [!].md'),
    'Sonic (USA) \\[\\!\\].md'.replace('\\!', '!'),
  );
  assert.equal(escapeUnzipGlobPattern('Who? What* [b1].md'), 'Who\\? What\\* \\[b1\\].md');
  assert.equal(escapeBsdtarGlobPattern('Game [T-En] *.md'), 'Game \\[T-En\\] \\*.md');

  // Create a real .7z archive containing tricky filenames if 7z is available
  const bin7z = await resolve7zBinary();
  if (bin7z) {
    const stageDir = fs.mkdtempSync(path.join(tempRoot, 'stage7z-'));
    fs.writeFileSync(path.join(stageDir, 'Sonic (USA, Europe) [!].md'), genesisRomPayload);
    fs.writeFileSync(path.join(stageDir, 'Pokémon – Red.md'), smallHomebrewPayload);
    const created = spawnSync(
      bin7z,
      ['a', '-spd', '-i!Sonic (USA, Europe) [!].md', '-i!Pokémon – Red.md', '--', genesis7zPath],
      { cwd: stageDir, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } },
    );
    assert.equal(created.status, 0);
  }

  // Spin up an Express server exposing streamExtractedEntryToResponse
  const app = express();
  app.get('/download', async (req, res) => {
    const archive = String(req.query.archive || '');
    const entry = String(req.query.entry || '');
    const expected = req.query.expected ? Number(req.query.expected) : undefined;
    try {
      await streamExtractedEntryToResponse(archive, entry, path.posix.basename(entry), res, expected);
    } catch {
      // Handled inside streamExtractedEntryToResponse
    }
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  // Simulate Alpine Linux default C locale to verify buildExtractorEnv() enforces C.UTF-8
  const prevLang = process.env.LANG;
  const prevLcAll = process.env.LC_ALL;
  process.env.LANG = 'C';
  process.env.LC_ALL = 'C';

  try {
    // 1. Bracketed Genesis .md ROM from .zip
    const res1 = await fetch(
      `${baseUrl}/download?archive=${encodeURIComponent(genesisZipPath)}&entry=${encodeURIComponent(
        'Sonic the Hedgehog (USA, Europe) [!].md',
      )}&expected=${genesisRomPayload.length}`,
    );
    assert.equal(res1.status, 200);
    assert.equal(res1.headers.get('content-length'), String(genesisRomPayload.length));
    const buf1 = Buffer.from(await res1.arrayBuffer());
    assert.equal(buf1.length, genesisRomPayload.length);
    assert.ok(buf1.equals(genesisRomPayload));

    // 2. Non-ASCII UTF-8 filename under LANG=C
    const res2 = await fetch(
      `${baseUrl}/download?archive=${encodeURIComponent(genesisZipPath)}&entry=${encodeURIComponent(
        'Pokémon – Mini Demo (World).md',
      )}&expected=${smallHomebrewPayload.length}`,
    );
    assert.equal(res2.status, 200);
    const buf2 = Buffer.from(await res2.arrayBuffer());
    assert.equal(buf2.length, smallHomebrewPayload.length);
    assert.ok(buf2.equals(smallHomebrewPayload));

    // 3. Leading '-' and '@' filenames
    for (const tricky of ['-Leading Dash.md', '@AtPrefix.md']) {
      const r = await fetch(
        `${baseUrl}/download?archive=${encodeURIComponent(genesisZipPath)}&entry=${encodeURIComponent(
          tricky,
        )}&expected=${smallHomebrewPayload.length}`,
      );
      assert.equal(r.status, 200, `Expected 200 for ${tricky}`);
      const b = Buffer.from(await r.arrayBuffer());
      assert.equal(b.length, smallHomebrewPayload.length);
    }

    // 4. Real .7z archive extraction under LANG=C
    if (bin7z && fs.existsSync(genesis7zPath)) {
      const r7z = await fetch(
        `${baseUrl}/download?archive=${encodeURIComponent(genesis7zPath)}&entry=${encodeURIComponent(
          'Pokémon – Red.md',
        )}&expected=${smallHomebrewPayload.length}`,
      );
      assert.equal(r7z.status, 200);
      const b7z = Buffer.from(await r7z.arrayBuffer());
      assert.equal(b7z.length, smallHomebrewPayload.length);
      assert.ok(b7z.equals(smallHomebrewPayload));
    }

    // 5. Missing entry with non-zero expectedSizeBytes must return clean HTTP 500 JSON (NOT hung 200 with Content-Length mismatch!)
    const resMissing = await fetch(
      `${baseUrl}/download?archive=${encodeURIComponent(genesisZipPath)}&entry=${encodeURIComponent(
        'Does Not Exist.md',
      )}&expected=32768`,
    );
    assert.equal(resMissing.status, 500);
    const errJson = (await resMissing.json()) as { error?: string };
    assert.match(errJson.error || '', /0 bytes|extraction failed/i);
  } finally {
    if (prevLang === undefined) delete process.env.LANG;
    else process.env.LANG = prevLang;
    if (prevLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = prevLcAll;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
