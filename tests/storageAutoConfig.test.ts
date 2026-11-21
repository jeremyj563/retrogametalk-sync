import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyDiscoveredConsoleDiff,
  classifyRomTypeSubfolderName,
  discoverStorageFolderMappings,
  mergeDiscoveredStorageMappings,
  normalizeFolderToken,
  type ScannedDirNode,
} from '../src/shared/storageAutoConfig.ts';
import {
  createDefaultStorageFolderConfig,
  resolveBaseSystemFolder,
  resolveTargetStorageFolder,
} from '../src/shared/storageFolderMappings.ts';
import {
  scanStorageDirectoryTree,
  type SdDirectoryHandle,
  type SdFileHandle,
} from '../src/utils/sdCardFs.ts';

function node(
  relativePath: string,
  opts: Partial<Omit<ScannedDirNode, 'relativePath' | 'name' | 'depth'>> & { name?: string } = {},
): ScannedDirNode {
  const clean = relativePath.replace(/^\/+|\/+$/g, '');
  const parts = clean ? clean.split('/') : [];
  const depth = parts.length;
  const name = opts.name ?? (parts[parts.length - 1] || 'SD_ROOT');
  return {
    relativePath: clean,
    name,
    depth,
    childDirs: opts.childDirs ?? [],
    sampleExtensions: opts.sampleExtensions ?? [],
    fileCount: opts.fileCount ?? opts.sampleExtensions?.length ?? 0,
  };
}

function makeMockDirHandle(
  name: string,
  entries: Array<SdDirectoryHandle | SdFileHandle>,
): SdDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const entry of entries) {
        yield entry;
      }
    },
    async getDirectoryHandle(childName: string) {
      const found = entries.find((e) => e.kind === 'directory' && e.name === childName);
      if (!found || found.kind !== 'directory') {
        throw new DOMException(`Not found: ${childName}`, 'NotFoundError');
      }
      return found;
    },
    async getFileHandle(childName: string) {
      const found = entries.find((e) => e.kind === 'file' && e.name === childName);
      if (!found || found.kind !== 'file') {
        throw new DOMException(`Not found: ${childName}`, 'NotFoundError');
      }
      return found;
    },
    async removeEntry() {
      // no-op for read-only scan mock
    },
  };
}

function makeMockFileHandle(name: string): SdFileHandle {
  return {
    kind: 'file',
    name,
    async createWritable() {
      throw new Error('Not implemented in scan test');
    },
    async getFile() {
      return new File([], name);
    },
  };
}

test('normalizes decorated folder names and classifies ROM-type subfolder aliases', () => {
  assert.equal(normalizeFolderToken('01 - Super Nintendo'), 'supernintendo');
  assert.equal(normalizeFolderToken('[03] Game Boy Advance'), 'gameboyadvance');
  assert.equal(normalizeFolderToken('02_SFC'), 'sfc');

  assert.equal(classifyRomTypeSubfolderName('ROM Hacks'), 'hack');
  assert.equal(classifyRomTypeSubfolderName('hacks'), 'hack');
  assert.equal(classifyRomTypeSubfolderName('English Translations'), 'translations');
  assert.equal(classifyRomTypeSubfolderName('trans'), 'translations');
  assert.equal(classifyRomTypeSubfolderName('transl'), 'translations');
  assert.equal(classifyRomTypeSubfolderName('T-En'), 'translations');
  assert.equal(classifyRomTypeSubfolderName('eng'), 'translations');
  assert.equal(classifyRomTypeSubfolderName('Homebrew'), 'homebrew');
  assert.equal(classifyRomTypeSubfolderName('hb'), 'homebrew');
  assert.equal(classifyRomTypeSubfolderName('Ports'), 'port');
  assert.equal(classifyRomTypeSubfolderName('Undubs'), 'undub');
  assert.equal(classifyRomTypeSubfolderName('Prototypes'), 'demo_proto');
  assert.equal(classifyRomTypeSubfolderName('Unlicensed'), 'bootleg');
  assert.equal(classifyRomTypeSubfolderName('unlic'), 'bootleg');
  assert.equal(classifyRomTypeSubfolderName('BIOS'), 'bios');
  assert.equal(classifyRomTypeSubfolderName('PSX2PSP'), 'psx2psp');
  assert.equal(classifyRomTypeSubfolderName('Random Misc Folder'), null);
});

test('infers device-wide ROM root, console leaf casing, majority subfolder names, and subfolder casing style', () => {
  const customLowerTree: ScannedDirNode[] = [
    node('', { name: 'HANDHELD_SD', childDirs: ['Roms'] }),
    node('Roms', { childDirs: ['SNES', 'NES', 'GBA'] }),
    node('Roms/SNES', { childDirs: ['hacks', 'BIOS'], sampleExtensions: ['sfc'], fileCount: 25 }),
    node('Roms/NES', { childDirs: ['trans', 'hacks'], sampleExtensions: ['nes'], fileCount: 18 }),
    node('Roms/GBA', { sampleExtensions: ['gba'], fileCount: 12 }),
  ];
  const lowerRes = discoverStorageFolderMappings(customLowerTree, { rootLabel: 'HANDHELD_SD' });
  assert.equal(lowerRes.conventions.inferredRomRoot, 'Roms');
  assert.equal(lowerRes.conventions.inferredConsoleCasing, 'upper');
  assert.equal(lowerRes.conventions.hasInferredTypeSubfolders, true);
  assert.equal(lowerRes.conventions.inferredSubfolderCasing, 'lower');
  assert.equal(lowerRes.conventions.inferredTypeSubfolders.hack, 'hacks');
  assert.equal(lowerRes.conventions.inferredTypeSubfolders.translations, 'trans');

  // EmuDeck lowercase console folders + uppercase subfolder style
  const deckTree: ScannedDirNode[] = [
    node('', { name: 'DECK_SD', childDirs: ['Emulation'] }),
    node('Emulation', { childDirs: ['roms'] }),
    node('Emulation/roms', { childDirs: ['snes', 'gba', 'psx'] }),
    node('Emulation/roms/snes', { childDirs: ['HACKS', 'TRANS'], sampleExtensions: ['sfc'], fileCount: 10 }),
    node('Emulation/roms/gba', { sampleExtensions: ['gba'], fileCount: 8 }),
    node('Emulation/roms/psx', { sampleExtensions: ['chd'], fileCount: 4 }),
  ];
  const deckRes = discoverStorageFolderMappings(deckTree, { rootLabel: 'DECK_SD' });
  assert.equal(deckRes.conventions.inferredRomRoot, 'Emulation/roms');
  assert.equal(deckRes.conventions.inferredConsoleCasing, 'lower');
  assert.equal(deckRes.conventions.inferredSubfolderCasing, 'upper');
  assert.equal(deckRes.conventions.inferredTypeSubfolders.hack, 'HACKS');
  assert.equal(deckRes.conventions.inferredTypeSubfolders.translations, 'TRANS');

  // Analogue Pocket does not fabricate synthetic Assets/*/common roots for unseen consoles
  const pocketTree: ScannedDirNode[] = [
    node('', { name: 'POCKET_SD', childDirs: ['Assets'] }),
    node('Assets', { childDirs: ['snes', 'gba'] }),
    node('Assets/snes', { childDirs: ['common'] }),
    node('Assets/snes/common', { sampleExtensions: ['sfc'], fileCount: 10 }),
    node('Assets/gba', { childDirs: ['common'] }),
    node('Assets/gba/common', { sampleExtensions: ['gba'], fileCount: 8 }),
  ];
  const pocketRes = discoverStorageFolderMappings(pocketTree, { rootLabel: 'POCKET_SD' });
  assert.equal(pocketRes.detectedRomRoot, 'Assets/*/common');
  assert.equal(pocketRes.conventions.inferredRomRoot, '');
});

test('discovers OnionOS / GarlicOS nested Roms/ layout and ignores metadata folders', () => {
  const tree: ScannedDirNode[] = [
    node('', { name: 'MIYOO_SD', childDirs: ['Roms', 'Saves', 'Themes', 'CFW', 'Imgs'] }),
    node('Roms', {
      childDirs: ['FC', 'SFC', 'MD', 'MS', 'GG', 'PS', 'PCE', 'GBA', 'CustomStuff'],
    }),
    node('Roms/FC', { sampleExtensions: ['nes', 'nes', 'zip'], fileCount: 18 }),
    node('Roms/SFC', {
      childDirs: ['ROM Hacks', 'Translations', 'Imgs'],
      sampleExtensions: ['sfc', 'smc'],
      fileCount: 42,
    }),
    node('Roms/MD', { sampleExtensions: ['md', 'gen'], fileCount: 15 }),
    node('Roms/MS', { sampleExtensions: ['sms'], fileCount: 9 }),
    node('Roms/GG', { sampleExtensions: ['gg'], fileCount: 41 }),
    node('Roms/PS', { sampleExtensions: ['chd', 'pbp'], fileCount: 12 }),
    node('Roms/PCE', { sampleExtensions: ['pce'], fileCount: 8 }),
    node('Roms/GBA', { sampleExtensions: ['gba'], fileCount: 25 }),
    node('Roms/CustomStuff', { sampleExtensions: ['txt'], fileCount: 2 }),
  ];

  const result = discoverStorageFolderMappings(tree, {
    rootLabel: 'MIYOO_SD',
    preferredSlugs: ['snes-roms', 'game-gear'],
  });

  assert.equal(result.detectedRomRoot, 'Roms');
  assert.match(result.detectedLayoutLabel, /OnionOS \/ GarlicOS/);
  assert.equal(result.matches.length, 8);
  assert.deepEqual(result.unmatchedFolders, ['Roms/CustomStuff']);

  const bySlug = new Map(result.matches.map((m) => [m.canonicalSlug, m]));
  assert.equal(bySlug.get('nes-roms')?.recommendedPath, 'Roms/FC');
  // Preferred slugs from catalog/config are honored cleanly
  assert.equal(bySlug.get('snes-roms')?.recommendedPath, 'Roms/SFC');
  assert.equal(bySlug.get('game-gear')?.recommendedPath, 'Roms/GG');
  assert.equal(bySlug.get('genesis-roms')?.recommendedPath, 'Roms/MD');
  assert.equal(bySlug.get('sms-roms')?.recommendedPath, 'Roms/MS');
  assert.equal(bySlug.get('psx-iso')?.recommendedPath, 'Roms/PS');
  assert.equal(bySlug.get('pc-engine-roms')?.recommendedPath, 'Roms/PCE');
  assert.equal(bySlug.get('gba-roms')?.recommendedPath, 'Roms/GBA');

  // Exact on-disk casing preserved for ROM-type subfolders
  assert.deepEqual(bySlug.get('snes-roms')?.detectedTypeSubfolders, {
    hack: 'ROM Hacks',
    translations: 'Translations',
  });
});

test('discovers EmuDeck / EmulationStation nested Emulation/roms layout', () => {
  const tree: ScannedDirNode[] = [
    node('', { name: 'DECK_SD', childDirs: ['Emulation'] }),
    node('Emulation', { childDirs: ['roms', 'saves', 'bios'] }),
    node('Emulation/roms', {
      childDirs: ['megadrive', 'n3ds', 'psx', 'pcenginecd', 'mastersystem', 'gamegear'],
    }),
    node('Emulation/roms/megadrive', { sampleExtensions: ['md'], fileCount: 5 }),
    node('Emulation/roms/n3ds', { sampleExtensions: ['3ds'], fileCount: 4 }),
    node('Emulation/roms/psx', { sampleExtensions: ['chd'], fileCount: 6 }),
    node('Emulation/roms/pcenginecd', { sampleExtensions: ['chd'], fileCount: 3 }),
    node('Emulation/roms/mastersystem', { sampleExtensions: ['sms'], fileCount: 7 }),
    node('Emulation/roms/gamegear', { sampleExtensions: ['gg'], fileCount: 2 }),
  ];

  const result = discoverStorageFolderMappings(tree, { rootLabel: 'DECK_SD' });
  assert.equal(result.detectedRomRoot, 'Emulation/roms');
  assert.match(result.detectedLayoutLabel, /EmuDeck/);

  const bySlug = new Map(result.matches.map((m) => [m.canonicalSlug, m]));
  assert.equal(bySlug.get('genesis-roms')?.recommendedPath, 'Emulation/roms/megadrive');
  assert.equal(bySlug.get('3ds-roms')?.recommendedPath, 'Emulation/roms/n3ds');
  assert.equal(bySlug.get('psx-iso')?.recommendedPath, 'Emulation/roms/psx');
  assert.equal(bySlug.get('pce-cd-iso')?.recommendedPath, 'Emulation/roms/pcenginecd');
  assert.equal(bySlug.get('sms-roms')?.recommendedPath, 'Emulation/roms/mastersystem');
  assert.equal(bySlug.get('gg-roms')?.recommendedPath, 'Emulation/roms/gamegear');
});

test('discovers Analogue Pocket OpenFPGA Assets/<core>/common paths and ignores author core dirs', () => {
  const tree: ScannedDirNode[] = [
    node('', { name: 'POCKET_SD', childDirs: ['Assets', 'Cores', 'Platforms'] }),
    node('Assets', { childDirs: ['snes', 'gba', 'genesis', 'gg', 'ng'] }),
    node('Assets/snes', { childDirs: ['common', 'agg23.SNES'] }),
    node('Assets/snes/common', { childDirs: ['Hacks'], sampleExtensions: ['sfc'], fileCount: 20 }),
    node('Assets/snes/agg23.SNES', { sampleExtensions: ['json'], fileCount: 3 }),
    node('Assets/gba', { childDirs: ['common'] }),
    node('Assets/gba/common', { sampleExtensions: ['gba'], fileCount: 14 }),
    node('Assets/genesis', { childDirs: ['common'] }),
    node('Assets/genesis/common', { sampleExtensions: ['md'], fileCount: 9 }),
    node('Assets/gg', { childDirs: ['common'] }),
    node('Assets/gg/common', { sampleExtensions: ['gg'], fileCount: 11 }),
    node('Assets/ng', { childDirs: ['common'] }),
    node('Assets/ng/common', { sampleExtensions: ['zip'], fileCount: 6 }),
  ];

  const result = discoverStorageFolderMappings(tree, { rootLabel: 'POCKET_SD' });
  assert.equal(result.detectedRomRoot, 'Assets/*/common');
  assert.match(result.detectedLayoutLabel, /Analogue Pocket/);

  const bySlug = new Map(result.matches.map((m) => [m.canonicalSlug, m]));
  assert.equal(bySlug.get('snes-rom')?.recommendedPath, 'Assets/snes/common');
  assert.deepEqual(bySlug.get('snes-rom')?.detectedTypeSubfolders, { hack: 'Hacks' });
  assert.equal(bySlug.get('gba-roms')?.recommendedPath, 'Assets/gba/common');
  assert.equal(bySlug.get('genesis-roms')?.recommendedPath, 'Assets/genesis/common');
  assert.equal(bySlug.get('gg-roms')?.recommendedPath, 'Assets/gg/common');
  assert.equal(bySlug.get('neogeo-roms')?.recommendedPath, 'Assets/ng/common');
});

test('discovers MiSTer games/ layout and human-readable numbered folders', () => {
  const misterTree: ScannedDirNode[] = [
    node('', { name: 'MISTER_SD', childDirs: ['games'] }),
    node('games', { childDirs: ['SNES', 'NES', 'MegaDrive', 'TGFX16', 'S32X'] }),
    node('games/SNES', { sampleExtensions: ['sfc'], fileCount: 10 }),
    node('games/NES', { sampleExtensions: ['nes'], fileCount: 10 }),
    node('games/MegaDrive', { sampleExtensions: ['md'], fileCount: 10 }),
    node('games/TGFX16', { sampleExtensions: ['pce'], fileCount: 5 }),
    node('games/S32X', { sampleExtensions: ['32x'], fileCount: 4 }),
  ];

  const misterRes = discoverStorageFolderMappings(misterTree, { rootLabel: 'MISTER_SD' });
  assert.equal(misterRes.detectedRomRoot, 'games');
  assert.match(misterRes.detectedLayoutLabel, /MiSTer/);
  const misterMap = new Map(misterRes.matches.map((m) => [m.canonicalSlug, m.recommendedPath]));
  assert.equal(misterMap.get('snes-rom'), 'games/SNES');
  assert.equal(misterMap.get('genesis-roms'), 'games/MegaDrive');
  assert.equal(misterMap.get('pc-engine-roms'), 'games/TGFX16');
  assert.equal(misterMap.get('32x-roms'), 'games/S32X');

  const humanTree: ScannedDirNode[] = [
    node('', {
      name: 'EVERDRIVE',
      childDirs: ['01 - Super Nintendo', '[02] Sega Game Gear', 'Nintendo 64'],
    }),
    node('01 - Super Nintendo', { sampleExtensions: ['sfc'], fileCount: 12 }),
    node('[02] Sega Game Gear', { sampleExtensions: ['gg'], fileCount: 8 }),
    node('Nintendo 64', { sampleExtensions: ['z64'], fileCount: 5 }),
  ];

  const humanRes = discoverStorageFolderMappings(humanTree, { rootLabel: 'EVERDRIVE' });
  assert.equal(humanRes.detectedRomRoot, '');
  const humanMap = new Map(humanRes.matches.map((m) => [m.canonicalSlug, m.recommendedPath]));
  assert.equal(humanMap.get('snes-rom'), '01 - Super Nintendo');
  assert.equal(humanMap.get('gg-roms'), '[02] Sega Game Gear');
  assert.equal(humanMap.get('n64-roms'), 'Nintendo 64');
});

test('resolves duplicate console conflicts via ROM-root consensus and ROM extension evidence, and avoids treating console/BIOS as standalone bios-files', () => {
  const tree: ScannedDirNode[] = [
    node('', { name: 'HYBRID_SD', childDirs: ['SNES', 'Roms'] }),
    node('SNES', { sampleExtensions: [], fileCount: 0 }), // stale empty folder at root
    node('Roms', { childDirs: ['SFC', 'GBA', 'NES', 'MD'] }),
    node('Roms/SFC', {
      childDirs: ['BIOS', 'Homebrew'],
      sampleExtensions: ['sfc', 'sfc', 'smc'],
      fileCount: 30,
    }),
    node('Roms/SFC/BIOS', { sampleExtensions: ['bin'], fileCount: 2 }),
    node('Roms/GBA', { sampleExtensions: ['gba'], fileCount: 12 }),
    node('Roms/NES', { sampleExtensions: ['nes'], fileCount: 19 }),
    node('Roms/MD', { sampleExtensions: ['md'], fileCount: 14 }),
  ];

  const result = discoverStorageFolderMappings(tree, { rootLabel: 'HYBRID_SD' });
  const bySlug = new Map(result.matches.map((m) => [m.canonicalSlug, m]));

  // Winner should be Roms/SFC (consensus + ROM extensions), with root SNES kept as alternate candidate
  const snes = bySlug.get('snes-rom');
  assert.ok(snes);
  assert.equal(snes.recommendedPath, 'Roms/SFC');
  assert.equal(snes.candidates.length, 2);
  assert.equal(snes.candidates[0]?.relativePath, 'Roms/SFC');
  assert.equal(snes.candidates[1]?.relativePath, 'SNES');

  // Roms/SFC/BIOS should be captured as a ROM-type subfolder of SNES, NOT as standalone bios-files console
  assert.equal(snes.detectedTypeSubfolders.bios, 'BIOS');
  assert.equal(snes.detectedTypeSubfolders.homebrew, 'Homebrew');
  assert.equal(bySlug.has('bios-files'), false);
});

test('classifies diffs accurately and merges selected mappings non-destructively into StorageFolderMappingConfig', () => {
  const existingConfig = {
    ...createDefaultStorageFolderConfig(),
    systemFolders: {
      'n64-roms': 'Custom/N64_KeepMe',
      'gba-roms': 'OldGBA',
    },
  };

  const tree: ScannedDirNode[] = [
    node('', { name: 'MY_SD', childDirs: ['Roms'] }),
    node('Roms', { childDirs: ['SFC', 'GBA', 'NES'] }),
    node('Roms/SFC', { childDirs: ['ROM Hacks', 'Translations'], sampleExtensions: ['sfc'], fileCount: 20 }),
    node('Roms/GBA', { sampleExtensions: ['gba'], fileCount: 10 }),
    node('Roms/NES', { sampleExtensions: ['nes'], fileCount: 8 }),
  ];

  const result = discoverStorageFolderMappings(tree, { rootLabel: 'MY_SD' });
  const snesMatch = result.matches.find((m) => m.canonicalSlug === 'snes-rom')!;
  const gbaMatch = result.matches.find((m) => m.canonicalSlug === 'gba-roms')!;

  const snesDiff = classifyDiscoveredConsoleDiff(
    snesMatch.canonicalSlug,
    snesMatch.recommendedPath,
    snesMatch.detectedTypeSubfolders,
    true,
    existingConfig,
  );
  assert.equal(snesDiff.kind, 'new');
  assert.equal(snesDiff.baseChanged, true);
  assert.equal(snesDiff.subfoldersChanged, true);

  const gbaDiff = classifyDiscoveredConsoleDiff(
    gbaMatch.canonicalSlug,
    gbaMatch.recommendedPath,
    gbaMatch.detectedTypeSubfolders,
    true,
    existingConfig,
  );
  assert.equal(gbaDiff.kind, 'updates_custom');
  assert.equal(gbaDiff.hasCustomBase, true);

  // Merge ONLY SNES (leaving GBA custom override and N64 untouched)
  const merged = mergeDiscoveredStorageMappings(existingConfig, result, {
    selectedSlugs: ['snes-rom'],
    includeTypeSubfolders: true,
  });

  assert.equal(resolveBaseSystemFolder('snes-rom', merged), 'Roms/SFC');
  assert.equal(resolveTargetStorageFolder('snes-rom', 'hack', merged), 'Roms/SFC/ROM Hacks');
  assert.equal(
    resolveTargetStorageFolder('snes-rom', 'translations', merged),
    'Roms/SFC/Translations',
  );
  assert.equal(resolveTargetStorageFolder('snes-rom', 'retail', merged), 'Roms/SFC');
  // Untouched custom overrides preserved!
  assert.equal(resolveBaseSystemFolder('gba-roms', merged), 'OldGBA');
  assert.equal(resolveBaseSystemFolder('n64-roms', merged), 'Custom/N64_KeepMe');
  // Global typeSubfoldersEnabled stays false so flat consoles remain flat
  assert.equal(merged.typeSubfoldersEnabled, false);
  assert.equal(resolveTargetStorageFolder('gba-roms', 'hack', merged), 'OldGBA');
});

test('scanStorageDirectoryTree walks handles, prunes ignored dirs, samples ROM extensions, and honors abort', async () => {
  const mockRoot = makeMockDirHandle('RETRO_CARD', [
    makeMockDirHandle('.Spotlight-V100', [makeMockFileHandle('store.db')]),
    makeMockDirHandle('Imgs', [makeMockFileHandle('cover.png')]),
    makeMockDirHandle('Roms', [
      makeMockDirHandle('SFC', [
        makeMockFileHandle('Chrono Trigger.sfc'),
        makeMockFileHandle('Super Metroid.smc'),
        makeMockDirHandle('Hacks', [makeMockFileHandle('SMW_Kaizo.sfc')]),
      ]),
      makeMockDirHandle('GG', [makeMockFileHandle('Sonic.gg')]),
    ]),
  ]);

  const scanned = await scanStorageDirectoryTree(mockRoot);
  const paths = scanned.map((n) => n.relativePath);
  assert.ok(paths.includes(''));
  assert.ok(paths.includes('Roms'));
  assert.ok(paths.includes('Roms/SFC'));
  assert.ok(paths.includes('Roms/GG'));
  assert.equal(paths.includes('.Spotlight-V100'), false);
  assert.equal(paths.includes('Imgs'), false);

  const result = discoverStorageFolderMappings(scanned, { rootLabel: mockRoot.name });
  const snes = result.matches.find((m) => m.canonicalSlug === 'snes-rom');
  assert.equal(snes?.recommendedPath, 'Roms/SFC');
  assert.deepEqual(snes?.detectedTypeSubfolders, { hack: 'Hacks' });

  // Verify AbortController cancellation throws AbortError
  const abortController = new AbortController();
  abortController.abort();
  await assert.rejects(
    () => scanStorageDirectoryTree(mockRoot, { signal: abortController.signal }),
    (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
  );
});
