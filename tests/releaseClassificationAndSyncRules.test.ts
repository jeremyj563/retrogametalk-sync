import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyFileRole, deriveReleaseTags } from '../src/server/releaseTags.ts';
import {
  classifyFileRoleToTypeKeys,
  evaluateReleaseTypeMatch,
} from '../src/shared/releaseTypeFilter.ts';
import { doesCatalogReleaseMatchSyncRules } from '../src/shared/syncRuleMatcher.ts';
import { isReleaseFullyMirroredForRules } from '../src/server/syncFastSkip.ts';
import type { RepositoryItemRecord, ScraperConfigPublic } from '../src/types.ts';

function makeRulesConfig(
  allowedReleaseTypes: string[],
  systemFilter = '',
): Pick<ScraperConfigPublic, 'systemFilter' | 'allowedReleaseTypes'> {
  return { systemFilter, allowedReleaseTypes };
}

test('Real-world Full Sync hacks & QoL mods with region tags classify as Hack (never Retail ROM or French Translation)', () => {
  const hackCases: Array<{
    filename: string;
    context: Parameters<typeof classifyFileRole>[2];
    expectedRole: string;
    expectedTypeKey: string;
  }> = [
    {
      filename: 'Castlevania - Dawn of Sorrow (U)(No-Touch v1.1).7z',
      context: { genres: ['Hack'], title: 'Castlevania - Dawn of Sorrow', systemName: 'nds-roms' },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Castlevania - Rondo of Ruin (v1.1.0) (Rondo of Blood Richter) (USA).7z',
      context: {
        genres: ['Hack'],
        title: 'Castlevania - Rondo of Ruin',
        systemName: 'nds-roms',
        siblingFilenames: [
          'Castlevania - Rondo of Ruin (v1.1.0) (Rondo of Blood Richter) (USA).7z',
          'Castlevania - Rondo of Ruin (v1.1.0) (Symphony of the Night Tailcoat Richter) (USA).7z',
        ],
      },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Dragon Quest V - Hand of the Heavenly Bride (USA) (Monster Trainer v1.0).7z',
      context: { genres: ['Hack'], title: 'Dragon Quest V', systemName: 'nds-roms' },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Animal Crossing - Wild World (USA) - Singleplayer Nookingtons (v1.1.1).7z',
      context: {
        genres: ['Hack'],
        title: 'Animal Crossing - Wild World',
        systemName: 'nds-roms',
        siblingFilenames: [
          'Animal Crossing - Wild World (USA) - Singleplayer Nookingtons (v1.1.1).7z',
          'Animal Crossing - Wild World (Europe) (En,Fr,De,Es,It) - Singleplayer Nookingtons (v1.1.1).7z',
        ],
      },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'The Sealed Palace (U) (v1.3).7z',
      context: { genres: ['Hack'], title: 'The Sealed Palace', systemName: 'n64-roms' },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Quest 64 - Hard Mode (v0.8.6)(USA).7z',
      context: { genres: ['Hack'], title: 'Quest 64 - Hard Mode', systemName: 'n64-roms' },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Quest 64 French Vanilla (QoL) (v48).7z',
      context: { genres: ['Hack'], title: 'Quest 64 French Vanilla', systemName: 'n64-roms' },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Yu-Gi-Oh! 5Ds World Championship 2011 - Over the Nexus (Europe) (QoL v1.2).7z',
      context: { genres: ['Hack'], title: 'Yu-Gi-Oh! 5Ds', systemName: 'nds-roms' },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Rhythm Heaven (USA)(Touchless v1.0).7z',
      context: {
        genres: ['Hack'],
        title: 'Rhythm Heaven',
        systemName: 'nds-roms',
        siblingFilenames: [
          'Rhythm Heaven (USA)(Touchless v1.0).7z',
          'Rhythm Heaven (USA)(Touchless v1.0)[undub v1.0].7z',
        ],
      },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'MegaMan ZX (U)(Slot-2 Patch v1.0).7z',
      context: { genres: ['Hack'], title: 'MegaMan ZX', systemName: 'nds-roms' },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Nine Hours, Nine Persons, Nine Doors (USA) (FastText v1.0 NoOneee).zip',
      context: {
        genres: ['Hack'],
        title: 'Nine Hours, Nine Persons, Nine Doors',
        systemName: 'nds-roms',
        siblingFilenames: [
          'Nine Hours, Nine Persons, Nine Doors (USA) (FastText v1.0 NoOneee).zip',
          'Nine Hours, Nine Persons, Nine Doors (USA) (T+It v1.3 OniAle).zip',
          'Nine Hours, Nine Persons, Nine Doors (USA) (T+Ar 1.0a EternalDreamAR).zip',
        ],
      },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Duke Nukem 64 (USA) - Coop up to 4 players (v1.0).7z',
      context: { genres: ['Hack'], title: 'Duke Nukem 64', systemName: 'n64-roms' },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Premier Manager 64 (E) (NTSC Patched).7z',
      context: {
        genres: ['Hack'],
        title: 'Premier Manager 64',
        systemName: 'n64-roms',
        siblingFilenames: [
          'Premier Manager 64 (E) (NTSC Patched).7z',
          'Premier Manager 64 (Europe).7z',
        ],
      },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Airboarder 64 (E) (NTSC Patched).7z',
      context: {
        genres: ['Hack'],
        title: 'Airboarder 64',
        systemName: 'n64-roms',
        siblingFilenames: [
          'Airboarder 64 (E) (NTSC Patched).7z',
          'Airboarder 64 (Europe).7z',
        ],
      },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Salamander - Enhanced (Japan).zip',
      context: {
        genres: ['Hack'],
        title: 'Salamander - Enhanced',
        systemName: 'pc-engine',
        siblingFilenames: [
          'Salamander - Enhanced (Japan).zip',
          'Salamander (Japan).zip',
        ],
      },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Mario & Sonic at the Olympic Winter Games (USA) (En,Fr,Es).zip',
      context: {
        genres: ['Hack'],
        title: 'Mario & Sonic at the Olympic Winter Games',
        systemName: 'nds-roms',
        siblingFilenames: [
          'Mario & Sonic at the Olympic Winter Games (USA) (En,Fr,Es).zip',
          'Mario & Sonic at the Olympic Winter Games (Europe) (En,Fr,De,Es,It).zip',
          'Mario & Sonic at Vancouver Olympic (Japan).zip',
        ],
      },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'Wing Warriors (World) (Aftermarket) (Unl).zip',
      context: { genres: ['Homebrew'], title: 'Wing Warriors', systemName: 'nes-roms' },
      expectedRole: 'Homebrew',
      expectedTypeKey: 'homebrew',
    },
  ];

  for (const tc of hackCases) {
    const role = classifyFileRole(tc.filename, tc.filename, tc.context);
    assert.equal(role, tc.expectedRole, `Expected "${tc.filename}" -> "${tc.expectedRole}", got "${role}"`);
    const typeKeys = classifyFileRoleToTypeKeys(role, [tc.expectedRole], tc.context?.systemName);
    assert.ok(
      typeKeys.includes(tc.expectedTypeKey),
      `Expected typeKeys for "${tc.filename}" to include "${tc.expectedTypeKey}", got [${typeKeys.join(', ')}]`,
    );
  }
});

test('Bundled unmodified original dumps paired with modified siblings still classify as Original ROM (Retail ROM)', () => {
  const originalCases: Array<{
    filename: string;
    context: Parameters<typeof classifyFileRole>[2];
  }> = [
    {
      filename: 'Salamander (Japan).zip',
      context: {
        genres: ['Hack'],
        title: 'Salamander - Enhanced',
        systemName: 'pc-engine',
        siblingFilenames: ['Salamander - Enhanced (Japan).zip', 'Salamander (Japan).zip'],
      },
    },
    {
      filename: 'Premier Manager 64 (Europe).7z',
      context: {
        genres: ['Hack'],
        title: 'Premier Manager 64',
        systemName: 'n64-roms',
        siblingFilenames: ['Premier Manager 64 (E) (NTSC Patched).7z', 'Premier Manager 64 (Europe).7z'],
      },
    },
    {
      filename: 'Airboarder 64 (Europe).7z',
      context: {
        genres: ['Hack'],
        title: 'Airboarder 64',
        systemName: 'n64-roms',
        siblingFilenames: ['Airboarder 64 (E) (NTSC Patched).7z', 'Airboarder 64 (Europe).7z'],
      },
    },
    {
      filename: 'Traverse - Starlight & Prairie (Japan).zip',
      context: {
        languages: ['English Patched', 'Japanese'],
        title: 'Traverse - Starlight & Prairie',
        systemName: 'snes-rom',
        siblingFilenames: [
          'Traverse - Starlight & Prairie (Japan).zip',
          'Traverse Starlight and Praire (English v1.0.0).zip',
          'Traverse Starlight and Praire (Brazilian Portuguese v1.0.0).zip',
        ],
      },
    },
    {
      filename: 'Away - Shuffle Dungeon (USA).7z',
      context: {
        genres: ['Undub'],
        title: 'Away - Shuffle Dungeon',
        systemName: 'nds-roms',
        siblingFilenames: ['Away - Shuffle Dungeon (USA).7z', 'Away - Shuffle Dungeon (UNDUB).7z'],
      },
    },
    {
      filename: 'Tetris (USA) (Unl).zip',
      context: {
        languages: ['Spanish Patched', 'Portuguese Patched'],
        title: 'Tetris',
        systemName: 'nes-roms',
        siblingFilenames: [
          'Tetris (USA) (Unl).zip',
          'Tetris (USA) (Unl) (Spanish v1.0).zip',
          'Tetris (USA) (Unl) (Portuguese v1.1).zip',
        ],
      },
    },
  ];

  for (const tc of originalCases) {
    const role = classifyFileRole(tc.filename, tc.filename, tc.context);
    assert.equal(role, 'Original ROM', `Expected "${tc.filename}" -> "Original ROM", got "${role}"`);
    const typeKeys = classifyFileRoleToTypeKeys(role, ['Hack', 'English Translation'], tc.context?.systemName);
    assert.deepEqual(typeKeys, ['retail'], `Original ROM "${tc.filename}" must map strictly to ['retail']`);
  }
});

test('All 11 curated release types and language codes classify accurately without cross-type false positives', () => {
  const matrix: Array<{
    filename: string;
    context?: Parameters<typeof classifyFileRole>[2];
    expectedRole: string;
    expectedTypeKey: string;
  }> = [
    // T+XX and explicit language translations
    {
      filename: 'Nine Hours, Nine Persons, Nine Doors (USA) (T+It v1.3 OniAle).zip',
      context: { genres: ['Hack'] },
      expectedRole: 'Italian Translation',
      expectedTypeKey: 'translation:italian',
    },
    {
      filename: 'Nine Hours, Nine Persons, Nine Doors (USA) (T+It v1.3 OniAle - FastText v1.0 NoOneee).zip',
      context: { genres: ['Hack'] },
      expectedRole: 'Italian Translation',
      expectedTypeKey: 'translation:italian',
    },
    {
      filename: 'Nine Hours, Nine Persons, Nine Doors (USA) (T+Ar 1.0a EternalDreamAR).zip',
      context: { genres: ['Hack'] },
      expectedRole: 'Arabic Translation',
      expectedTypeKey: 'translation:arabic',
    },
    {
      filename: 'Xenosaga I & II (Spanish v1.0.3).7z',
      context: { genres: ['Hack'] },
      expectedRole: 'Spanish Translation',
      expectedTypeKey: 'translation:spanish',
    },
    {
      filename: 'Traverse Starlight and Praire (Brazilian Portuguese v1.0.0).zip',
      context: { languages: ['English Patched'] },
      expectedRole: 'Portuguese Translation',
      expectedTypeKey: 'translation:portuguese',
    },
    {
      filename: 'Chrono Trigger (Japan) (T+Tr v1.0).sfc',
      context: { genres: ['Translation'] },
      expectedRole: 'Translation',
      expectedTypeKey: 'translation:other',
    },
    // False-positive guards for bare English words / title phrases
    {
      filename: 'Super Mario World - Graphics Polish (USA) (v1.2).zip',
      context: { genres: ['Hack'] },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'The Italian Job (USA) (Hard Mode v1.0).zip',
      context: { genres: ['Hack'] },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    {
      filename: 'NBA Jam 2026 Roster Update (USA).zip',
      context: { genres: ['Hack'] },
      expectedRole: 'Hack',
      expectedTypeKey: 'hack',
    },
    // Machine Translation, Undub, PSX2PSP, Homebrew/Indie/Doujin, Port, BIOS, Prototype, Bootleg, DLC
    {
      filename: 'Tales of Innocence (Japan) (Machine Translation v0.9).7z',
      context: { genres: ['Machine Translation'] },
      expectedRole: 'Machine Translation',
      expectedTypeKey: 'machine_translation',
    },
    {
      filename: 'Rhythm Heaven (USA)(Touchless v1.0)[undub v1.0].7z',
      context: { genres: ['Hack'] },
      expectedRole: 'Undub',
      expectedTypeKey: 'undub',
    },
    {
      filename: 'Mystical Ninja Starring Goemon (USA) (Undub).z64',
      context: { genres: ['Hack'] },
      expectedRole: 'Undub',
      expectedTypeKey: 'undub',
    },
    {
      filename: 'Xenogears (USA) (PSX2PSP Eboot).7z',
      context: { systemName: 'psp-roms' },
      expectedRole: 'PSX2PSP',
      expectedTypeKey: 'psx2psp',
    },
    {
      filename: 'Micro Mages (World) (Indie).zip',
      context: { genres: ['Indie'], systemName: 'nes-roms' },
      expectedRole: 'Indie',
      expectedTypeKey: 'homebrew',
    },
    {
      filename: 'Touhou Pocket (Japan) (Doujin).zip',
      context: { genres: ['Doujin'], systemName: 'gba-roms' },
      expectedRole: 'Doujin',
      expectedTypeKey: 'homebrew',
    },
    {
      filename: 'Super Mario 64 (USA) (Port).zip',
      context: { genres: ['Port'], systemName: 'vita-roms' },
      expectedRole: 'Port',
      expectedTypeKey: 'port',
    },
    {
      filename: 'scph1001-bios.zip',
      context: { genres: ['BIOS'], systemName: 'psx-roms' },
      expectedRole: 'BIOS',
      expectedTypeKey: 'bios',
    },
    {
      filename: 'EarthBound (USA) (Proto).zip',
      context: { genres: ['Prototype'], systemName: 'snes-rom' },
      expectedRole: 'Prototype',
      expectedTypeKey: 'demo_proto',
    },
    {
      filename: 'Ronaldinhos Soccer 64 (Brazil) (Pirate).7z',
      context: { genres: ['Hack'], systemName: 'n64-roms' },
      expectedRole: 'Bootleg',
      expectedTypeKey: 'bootleg',
    },
    {
      filename: 're-ost-v1.rar',
      context: { genres: ['Hack'], systemName: 'nds-roms' },
      expectedRole: 'DLC',
      expectedTypeKey: 'dlc',
    },
    {
      filename: 'Super Mario World (USA).zip',
      context: { genres: ['Platformer'], systemName: 'snes-rom' },
      expectedRole: 'ROM',
      expectedTypeKey: 'retail',
    },
  ];

  for (const tc of matrix) {
    const role = classifyFileRole(tc.filename, tc.filename, tc.context);
    assert.equal(role, tc.expectedRole, `Expected "${tc.filename}" -> "${tc.expectedRole}", got "${role}"`);
    const typeKeys = classifyFileRoleToTypeKeys(role, [tc.expectedRole], tc.context?.systemName);
    assert.ok(
      typeKeys.includes(tc.expectedTypeKey),
      `Expected typeKeys for "${tc.filename}" (role=${role}) to include "${tc.expectedTypeKey}", got [${typeKeys.join(', ')}]`,
    );
  }
});

test('doesCatalogReleaseMatchSyncRules uses concrete fileRoles when present so excluded-file-only releases stop looping', () => {
  const userPolicy = makeRulesConfig(['hack', 'translation:english', 'port', 'homebrew']);

  // Release tagged Hack + Spanish Translation, but its ONLY concrete file is Spanish Translation
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: 'nds-roms',
        releaseType: 'Hack',
        releaseTags: ['Hack', 'Spanish Translation'],
        fileRoles: ['Spanish Translation'],
      },
      userPolicy,
    ),
    false,
  );

  // Release tagged Hack + Undub, but its ONLY concrete files are Undub + Original ROM
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: 'nds-roms',
        releaseType: 'Hack',
        releaseTags: ['Hack', 'Undub'],
        fileRoles: ['Undub', 'Original ROM'],
      },
      userPolicy,
    ),
    false,
  );

  // Multi-file release with excluded Japan + Portuguese siblings AND one eligible English Translation
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: 'snes-rom',
        releaseType: 'English Translation',
        releaseTags: ['English Translation', 'Portuguese Translation'],
        fileRoles: ['Original ROM', 'Portuguese Translation', 'English Translation'],
      },
      userPolicy,
    ),
    true,
  );

  // Release with NO concrete fileRoles yet falls back cleanly to releaseTags
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: 'snes-rom',
        releaseType: 'Hack',
        releaseTags: ['Hack'],
        fileRoles: [],
      },
      userPolicy,
    ),
    true,
  );
});

test('isReleaseFullyMirroredForRules satisfies multi-file releases with excluded siblings and reacts when Sync Rules widen', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-mirror-check-'));
  try {
    const enPath = path.join(tmpDir, 'Traverse Starlight and Praire (English v1.0.0).zip');
    fs.writeFileSync(enPath, 'dummy-rom-bytes');

    const traverseItem: RepositoryItemRecord = {
      id: 42,
      remoteUrl: 'https://retrogametalk.com/repository/snes-rom/traverse-starlight-prairie/',
      remotePath: 'snes-rom/traverse-starlight-prairie',
      localPath: tmpDir,
      systemName: 'snes-rom',
      title: 'Traverse - Starlight & Prairie',
      releaseType: 'English Translation',
      releaseTags: ['English Translation', 'Portuguese Translation'],
      genres: ['RPG'],
      regions: ['Japan'],
      languages: ['English Patched', 'Japanese', 'Portuguese Patched'],
      sources: ['Romhacking.net'],
      publisher: null,
      developer: null,
      releaseYear: null,
      status: 'downloaded',
      filesCount: 1,
      fileSizeBytes: 15,
      hasMetadata: true,
      screenshotsCount: 0,
      installedAt: null,
      installedDeviceLabel: null,
      installedFileId: null,
      installedFilename: null,
      isFavorite: false,
      syncOverride: 'default',
      collectionIds: [],
      publishedAt: '2026-01-01T00:00:00.000Z',
      remoteUpdatedAt: '2026-01-01T00:00:00.000Z',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      downloadedAt: '2026-01-01T00:00:00.000Z',
      lastRunId: 1,
      errorMessage: null,
      wpPostId: 1001,
      wpPostType: 'snes-rom',
      coverLocalPath: null,
      metadata: {
        title: 'Traverse - Starlight & Prairie',
        subtitle: null,
        consoleName: 'snes-rom',
        publisher: null,
        releaseYear: null,
        downloadsCount: null,
        releasedAgo: null,
        updatedDate: null,
        specs: [],
        genres: ['RPG'],
        regions: ['Japan'],
        languages: ['English Patched', 'Japanese', 'Portuguese Patched'],
        sources: ['Romhacking.net'],
        formats: ['ZIP'],
        releaseTags: ['English Translation', 'Portuguese Translation'],
        descriptionHtml: '',
        descriptionText: '',
        coverUrl: null,
        coverLocalRelPath: null,
        screenshotUrls: [],
        screenshotLocalRelPaths: [],
        sourcePageUrl: 'https://retrogametalk.com/repository/snes-rom/traverse-starlight-prairie/',
        fetchedAt: '2026-01-01T00:00:00.000Z',
        downloadHints: [
          { filename: 'Traverse Starlight and Praire (English v1.0.0).zip', fileSize: '2 MB' },
          { filename: 'Traverse - Starlight & Prairie (Japan).zip', fileSize: '2 MB' },
          { filename: 'Traverse Starlight and Praire (Brazilian Portuguese v1.0.0).zip', fileSize: '2 MB' },
        ],
      },
      files: [
        {
          id: 1,
          releaseId: 42,
          remoteUrl: 'https://retrogametalk.com/download/1',
          downloadUrl: 'https://retrogametalk.com/download/1',
          remotePath: 'snes-rom/traverse-starlight-prairie/Traverse Starlight and Praire (English v1.0.0).zip',
          localPath: enPath,
          filename: 'Traverse Starlight and Praire (English v1.0.0).zip',
          displayLabel: 'Traverse Starlight and Praire (English v1.0.0).zip',
          fileRole: 'English Translation',
          fileSizeBytes: 15,
          status: 'downloaded',
          discoveredAt: '2026-01-01T00:00:00.000Z',
          downloadedAt: '2026-01-01T00:00:00.000Z',
          lastRunId: 1,
          errorMessage: null,
        },
      ],
    };

    // Policy allows Hack + English Translation: English file is verified, Japan/PT hints are excluded -> SATISFIED
    const narrowCheck = isReleaseFullyMirroredForRules(traverseItem, ['hack', 'translation:english']);
    assert.equal(narrowCheck.satisfied, true);
    assert.equal(narrowCheck.verifiedFilesCount, 1);

    // User widens Sync Rules to include Portuguese Translation -> NOT satisfied (must re-sync to grab PT file!)
    const widenedCheck = isReleaseFullyMirroredForRules(traverseItem, [
      'hack',
      'translation:english',
      'translation:portuguese',
    ]);
    assert.equal(widenedCheck.satisfied, false);

    // If the English file disappears from disk -> NOT satisfied
    fs.unlinkSync(enPath);
    const missingFileCheck = isReleaseFullyMirroredForRules(traverseItem, ['hack', 'translation:english']);
    assert.equal(missingFileCheck.satisfied, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SQLite migration v23 & persistDiscoveredReleaseDownloadHints repair legacy roles and prevent rule-sync loops', async () => {
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-v23-db-'));
  const prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDataDir;

  try {
    const dbMod = await import(`../src/server/db.ts?v23test=${Date.now()}`);
    dbMod.initDb();

    // Configure Sync Rules: Hacks + English Translations only (all consoles)
    dbMod.updateConfig({
      systemFilter: '',
      allowedReleaseTypes: ['hack', 'translation:english'],
    });

    // 1) Insert an available Hack-tagged release that has NO WP downloadHints initially (like Xenosaga I & II Spanish)
    const xenoUrl = 'https://retrogametalk.com/repository/nds-roms/xenosaga-i-ii-spanish/';
    dbMod.upsertCatalogRelease({
      remoteUrl: xenoUrl,
      remotePath: 'nds-roms/xenosaga-i-ii-spanish',
      localPath: path.join(tmpDataDir, 'nds-roms', 'xenosaga-i-ii-spanish'),
      systemName: 'nds-roms',
      title: 'Xenosaga I & II',
      status: 'available',
      metadata: {
        title: 'Xenosaga I & II',
        subtitle: null,
        consoleName: 'nds-roms',
        publisher: null,
        releaseYear: null,
        downloadsCount: null,
        releasedAgo: null,
        updatedDate: null,
        specs: [],
        genres: ['Hack'],
        regions: ['Japan'],
        languages: ['Spanish'],
        sources: [],
        formats: ['7Z'],
        releaseTags: ['Hack'],
        descriptionHtml: '',
        descriptionText: '',
        coverUrl: null,
        coverLocalRelPath: null,
        screenshotUrls: [],
        screenshotLocalRelPaths: [],
        sourcePageUrl: xenoUrl,
        fetchedAt: new Date().toISOString(),
      },
    });

    // Before page discovery, it matches because no downloadHints exist yet
    const beforeHints = dbMod.listCatalogReleasesForRuleSync(dbMod.getInternalConfig());
    assert.ok(beforeHints.matched.some((r: RepositoryItemRecord) => r.remoteUrl === xenoUrl));

    // After page discovery finds ONLY a Spanish Translation file and persists downloadHints:
    const persisted = dbMod.persistDiscoveredReleaseDownloadHints(xenoUrl, [
      { filename: 'Xenosaga I & II (Spanish v1.0.3).7z' },
    ]);
    assert.equal(persisted, true);

    // Next Full Sync & Monitor Preflight both exclude it cleanly -> zero infinite loop!
    const afterHints = dbMod.listCatalogReleasesForRuleSync(dbMod.getInternalConfig());
    assert.equal(
      afterHints.matched.some((r: RepositoryItemRecord) => r.remoteUrl === xenoUrl),
      false,
      'Spanish-only release must be excluded from rule sync once downloadHints are persisted',
    );
    const preflight = dbMod.computeSyncPreflightSummary();
    assert.equal(preflight.pendingDownloadCount, 0);
    assert.equal(preflight.excludedByRulesCount, 1);

    // 2) Verify deriveReleaseTags + evaluateReleaseTypeMatch consistency for Quest 64 French Vanilla
    const q64Role = classifyFileRole('Quest 64 French Vanilla (QoL) (v48).7z', '', {
      genres: ['Hack'],
      title: 'Quest 64 French Vanilla',
      systemName: 'n64-roms',
    });
    const q64Tags = deriveReleaseTags({ genres: ['Hack'], systemName: 'n64-roms' }, [q64Role]);
    assert.deepEqual(q64Tags, ['Hack']);
    const q64Match = evaluateReleaseTypeMatch(
      classifyFileRoleToTypeKeys(q64Role, q64Tags, 'n64-roms'),
      ['hack', 'translation:english'],
    );
    assert.equal(q64Match.allowed, true);
  } finally {
    if (prevDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = prevDataDir;
    }
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  }
});
