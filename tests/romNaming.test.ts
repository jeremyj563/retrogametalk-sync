import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILT_IN_NAMING_PREVIEW_SAMPLES,
  buildUpgradeMatchStem,
  canonicalRomNamingTypeOverridesJson,
  classifyRomNamingType,
  DEFAULT_ROM_NAMING_TEMPLATE,
  disambiguateCollidingRomFilenames,
  formatPreparedRomName,
  formatPreparedRomNameDetailed,
  LEGACY_ROM_NAMING_TEMPLATE,
  normalizeRomNamingTypeOverrides,
  ROM_NAMING_PRESETS,
  validateRomNamingTemplate,
  type RomNamingConfig,
} from '../src/shared/romNaming.ts';
import {
  insertNamingTokenAtSelection,
  shouldAutoExpandAdvancedNaming,
  summarizeNamingOptions,
} from '../src/shared/deviceExportUi.ts';

const HYBRID_CFG: RomNamingConfig = {
  romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
  romSanitizeFat32: true,
  romMaxFilenameLen: 0,
};

const LEGACY_CFG: RomNamingConfig = {
  romNamingTemplate: LEGACY_ROM_NAMING_TEMPLATE,
  romSanitizeFat32: true,
  romMaxFilenameLen: 0,
};

test('No-Intro + T-En hybrid default formats all 10 ROM types cleanly with status in () and patches in []', () => {
  // Retail ROM
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Chrono Trigger',
        systemName: 'snes-roms',
        regions: ['USA'],
        fileRole: 'ROM',
        releaseTags: ['Retail ROM'],
      },
      '.sfc',
      HYBRID_CFG,
    ),
    'Chrono Trigger (USA).sfc',
  );

  // Retail ROM with revision
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Super Mario World',
        systemName: 'snes-roms',
        regions: ['USA'],
        fileRole: 'ROM',
        innerFilename: 'Super Mario World (USA) (Rev 1).sfc',
      },
      '.sfc',
      HYBRID_CFG,
    ),
    'Super Mario World (USA) (Rev 1).sfc',
  );

  // Fan Translation (English & Spanish)
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Mother 3',
        systemName: 'gba-roms',
        regions: ['Japan'],
        languages: ['English'],
        fileRole: 'English Translation',
        releaseTags: ['English Translation'],
        archiveFilename: 'Mother_3_v1.3.zip',
      },
      '.gba',
      HYBRID_CFG,
    ),
    'Mother 3 (Japan) [T-En v1.3].gba',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Chrono Trigger',
        systemName: 'snes-roms',
        regions: ['USA'],
        languages: ['Spanish'],
        fileRole: 'Spanish Translation',
        releaseTags: ['Spanish Translation'],
        archiveFilename: 'CT_Spanish_v2.0.zip',
      },
      '.sfc',
      HYBRID_CFG,
    ),
    'Chrono Trigger (USA) [T-Es v2.0].sfc',
  );

  // Machine Translation (language-aware T-En MTL, T-Es MTL, and unknown-language fallback MTL)
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Bahamut Lagoon',
        systemName: 'snes-roms',
        regions: ['Japan'],
        languages: ['English'],
        fileRole: 'Machine Translation',
        releaseTags: ['Machine Translation'],
        archiveFilename: 'Bahamut_Lagoon_MTL_v1.0.zip',
      },
      '.sfc',
      HYBRID_CFG,
    ),
    'Bahamut Lagoon (Japan) [T-En MTL v1.0].sfc',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Treasure of the Rudras',
        systemName: 'snes-roms',
        regions: ['Japan'],
        languages: ['Spanish'],
        fileRole: 'Machine Translation',
        releaseTags: ['Machine Translation'],
      },
      '.sfc',
      HYBRID_CFG,
    ),
    'Treasure of the Rudras (Japan) [T-Es MTL].sfc',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Mystery RPG',
        systemName: 'snes-roms',
        regions: ['Japan'],
        fileRole: 'Machine Translation',
      },
      '.sfc',
      HYBRID_CFG,
    ),
    'Mystery RPG (Japan) [MTL].sfc',
  );

  // ROM Hack & Undub
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Super Mario World',
        systemName: 'snes-roms',
        regions: ['USA'],
        fileRole: 'Hack',
        archiveFilename: 'SMW_Hack_v1.42.zip',
      },
      '.sfc',
      HYBRID_CFG,
    ),
    'Super Mario World (USA) [Hack v1.42].sfc',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Final Fantasy X',
        systemName: 'ps2-isos',
        regions: ['USA'],
        fileRole: 'Undub',
        archiveFilename: 'FFX_Undub_v1.1.zip',
      },
      '.chd',
      HYBRID_CFG,
    ),
    'Final Fantasy X (USA) [Undub v1.1].chd',
  );

  // Status-channel types -> Parentheses ()
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Micro Mages',
        systemName: 'nes-roms',
        regions: ['World'],
        fileRole: 'Homebrew',
      },
      '.nes',
      HYBRID_CFG,
    ),
    'Micro Mages (World) (Homebrew).nes',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Micro Mages',
        systemName: 'nes-roms',
        regions: ['World'],
        fileRole: 'Homebrew',
        archiveFilename: 'Micro_Mages_v1.2.zip',
      },
      '.nes',
      HYBRID_CFG,
    ),
    'Micro Mages (World) (Homebrew v1.2).nes',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Celeste Classic',
        systemName: 'gba-roms',
        regions: ['World'],
        fileRole: 'Port',
      },
      '.gba',
      HYBRID_CFG,
    ),
    'Celeste Classic (World) (Port).gba',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Star Fox 2',
        systemName: 'snes-roms',
        regions: ['USA'],
        fileRole: 'Prototype',
      },
      '.sfc',
      HYBRID_CFG,
    ),
    'Star Fox 2 (USA) (Proto).sfc',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Metroid Prime',
        systemName: 'gamecube',
        regions: ['USA'],
        fileRole: 'Demo',
      },
      '.rvz',
      HYBRID_CFG,
    ),
    'Metroid Prime (USA) (Demo).rvz',
  );
  assert.equal(
    formatPreparedRomName(
      {
        title: 'Somari',
        systemName: 'nes-roms',
        regions: ['Asia'],
        fileRole: 'Bootleg',
      },
      '.nes',
      HYBRID_CFG,
    ),
    'Somari (Asia) (Unl).nes',
  );
});

test('compound releases combine status parentheses and patch brackets without duplicating version', () => {
  const result = formatPreparedRomNameDetailed(
    {
      title: 'EarthBound Beginnings',
      systemName: 'nes-roms',
      regions: ['Japan'],
      languages: ['English'],
      releaseTags: ['Prototype', 'English Translation'],
      archiveFilename: 'EB0_Proto_T-En_v1.1.zip',
    },
    '.nes',
    HYBRID_CFG,
  );
  assert.equal(result.filename, 'EarthBound Beginnings (Japan) (Proto) [T-En v1.1].nes');
  assert.equal(result.statusTag, 'Proto');
  assert.equal(result.modTag, 'T-En');
  assert.equal(result.version, 'v1.1');
});

test('legacy brackets, clean handheld, and original presets remain supported', () => {
  const protoCtx = {
    title: 'Star Fox 2',
    systemName: 'snes-roms',
    regions: ['USA'],
    fileRole: 'Prototype',
    innerFilename: 'starfox2_proto.sfc',
  };

  assert.equal(
    formatPreparedRomName(protoCtx, '.sfc', LEGACY_CFG),
    'Star Fox 2 (USA) [Proto].sfc',
  );

  const handheldPreset = ROM_NAMING_PRESETS.find((p) => p.id === 'clean-handheld')!;
  assert.equal(
    formatPreparedRomName(protoCtx, '.sfc', {
      romNamingTemplate: handheldPreset.template,
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    }),
    'Star Fox 2 (Proto).sfc',
  );

  const origPreset = ROM_NAMING_PRESETS.find((p) => p.id === 'original')!;
  assert.equal(
    formatPreparedRomName(protoCtx, '.sfc', {
      romNamingTemplate: origPreset.template,
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    }),
    'starfox2_proto.sfc',
  );
});

test('optional per-type template overrides apply selectively while untouched types inherit global template', () => {
  const cfg: RomNamingConfig = {
    romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
    romNamingTypeOverrides: normalizeRomNamingTypeOverrides({
      homebrew: '{title}{statusParen}',
      translation: '{title} [{mod} {version}]',
      unknown_type_ignored: '{title}',
    }),
    romSanitizeFat32: true,
    romMaxFilenameLen: 0,
  };

  // Homebrew uses its override (region omitted)
  const hb = formatPreparedRomNameDetailed(
    {
      title: 'Micro Mages',
      systemName: 'nes-roms',
      regions: ['World'],
      fileRole: 'Homebrew',
    },
    '.nes',
    cfg,
  );
  assert.equal(hb.usedOverride, true);
  assert.equal(hb.filename, 'Micro Mages (Homebrew).nes');

  // Translation uses its override
  const tr = formatPreparedRomNameDetailed(
    {
      title: 'Mother 3',
      systemName: 'gba-roms',
      regions: ['Japan'],
      fileRole: 'English Translation',
      archiveFilename: 'Mother3_v1.3.zip',
    },
    '.gba',
    cfg,
  );
  assert.equal(tr.usedOverride, true);
  assert.equal(tr.filename, 'Mother 3 [T-En v1.3].gba');

  // Hack inherits global hybrid template
  const hack = formatPreparedRomNameDetailed(
    {
      title: 'Super Mario World',
      systemName: 'snes-roms',
      regions: ['USA'],
      fileRole: 'Hack',
      archiveFilename: 'SMW_v1.42.zip',
    },
    '.sfc',
    cfg,
  );
  assert.equal(hack.usedOverride, false);
  assert.equal(hack.filename, 'Super Mario World (USA) [Hack v1.42].sfc');

  // Canonical JSON ordering is deterministic regardless of key insertion order
  assert.equal(
    canonicalRomNamingTypeOverridesJson({ translation: '{title}', homebrew: '{title}' }),
    canonicalRomNamingTypeOverridesJson({ homebrew: '{title}', translation: '{title}' }),
  );
});

test('validateRomNamingTemplate flags unknown tokens, unbalanced delimiters, and missing title/origName', () => {
  assert.equal(validateRomNamingTemplate(DEFAULT_ROM_NAMING_TEMPLATE).valid, true);
  assert.equal(validateRomNamingTemplate(DEFAULT_ROM_NAMING_TEMPLATE).issues.length, 0);

  const typo = validateRomNamingTemplate('{titl}{regionParen}');
  assert.equal(typo.valid, false);
  assert.ok(typo.issues.some((i) => i.severity === 'error' && i.message.includes('{titl}')));

  const unclosedBrace = validateRomNamingTemplate('{title{regionParen}');
  assert.equal(unclosedBrace.valid, false);
  assert.ok(unclosedBrace.issues.some((i) => i.message.includes('curly brace')));

  const missingTitle = validateRomNamingTemplate('{regionParen}{modBracket}');
  assert.equal(missingTitle.valid, true);
  assert.ok(missingTitle.issues.some((i) => i.severity === 'warning'));
});

test('detailed formatting reports FAT32 sanitization and max-length truncation telemetry accurately', () => {
  const zeldaSample = BUILT_IN_NAMING_PREVIEW_SAMPLES.find((s) => s.typeKey === 'retail')!;
  assert.equal(classifyRomNamingType(zeldaSample.context), 'retail');

  const sanitized = formatPreparedRomNameDetailed(
    zeldaSample.context,
    zeldaSample.extension,
    {
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    },
  );
  assert.equal(sanitized.wasSanitized, true);
  assert.equal(sanitized.wasTruncated, false);
  assert.equal(sanitized.filename, 'The Legend of Zelda - A Link to the Past (USA).sfc');

  const truncated = formatPreparedRomNameDetailed(
    zeldaSample.context,
    zeldaSample.extension,
    {
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: true,
      romMaxFilenameLen: 28,
    },
  );
  assert.equal(truncated.wasTruncated, true);
  assert.ok(truncated.charLength <= 28);
  assert.ok(truncated.filename.endsWith('.sfc'));
});

test('buildUpgradeMatchStem matches across legacy [Proto] and hybrid (Proto) conventions without clobbering retail', () => {
  const legacyProto = buildUpgradeMatchStem('Star Fox 2 (USA) [Proto v0.9].sfc');
  const hybridProto = buildUpgradeMatchStem('Star Fox 2 (USA) (Proto v1.0).sfc');
  const retail = buildUpgradeMatchStem('Star Fox 2 (USA).sfc');

  assert.equal(legacyProto.stem, hybridProto.stem);
  assert.equal(legacyProto.role, 'proto');
  assert.equal(hybridProto.role, 'proto');
  assert.equal(retail.stem, hybridProto.stem);
  assert.equal(retail.role, null);

  // Legacy [MTL v0.9] upgrades cleanly to language-aware [T-En MTL v1.0]
  const legacyMtl = buildUpgradeMatchStem('Bahamut Lagoon (Japan) [MTL v0.9].sfc');
  const hybridMtl = buildUpgradeMatchStem('Bahamut Lagoon (Japan) [T-En MTL v1.0].sfc');
  assert.equal(legacyMtl.stem, hybridMtl.stem);
  assert.equal(legacyMtl.role, hybridMtl.role);

  // Standard hack upgrade still matches
  const hackOld = buildUpgradeMatchStem('Super Mario World (USA) [Hack v1.3].sfc');
  const hackNew = buildUpgradeMatchStem('Super Mario World (USA) [Hack v1.42].sfc');
  assert.equal(hackOld.stem, hackNew.stem);
  assert.equal(hackOld.role, 'hack');
  assert.equal(hackNew.role, 'hack');
});

test('cursor-aware insertNamingTokenAtSelection and override disclosure summaries work accurately', () => {
  const inserted = insertNamingTokenAtSelection('{title}{modBracket}', '{statusParen}', 7, 7);
  assert.equal(inserted.value, '{title}{statusParen}{modBracket}');
  assert.equal(inserted.caret, 7 + '{statusParen}'.length);

  // Replaces highlighted selection cleanly
  const replaced = insertNamingTokenAtSelection('{title}{tagBracket}', '{modBracket}', 7, 19);
  assert.equal(replaced.value, '{title}{modBracket}');
  assert.equal(replaced.caret, 7 + '{modBracket}'.length);

  assert.equal(
    shouldAutoExpandAdvancedNaming({
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romNamingTypeOverrides: { homebrew: '{title}{statusParen}' },
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    }),
    true,
  );
  assert.equal(
    summarizeNamingOptions({
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romNamingTypeOverrides: { homebrew: '{title}{statusParen}', port: '{title}' },
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    }),
    'FAT32 safe · Unlimited length · 2 type overrides',
  );
});

test('disambiguateCollidingRomFilenames preserves base edition and appends unique variant tags', () => {
  // Exact scenario: Castlevania: Blood Moon with base v1.0 ROM and [Improved Controls v3.1] variant
  const baseFormatted = formatPreparedRomName(
    {
      title: 'Castlevania: Blood Moon',
      systemName: 'nes-roms',
      regions: ['USA'],
      fileRole: 'Hack',
      archiveFilename: 'Castlevania - Blood Moon (v1.0).zip',
      innerFilename: 'Castlevania - Blood Moon (v1.0).nes',
    },
    '.nes',
    HYBRID_CFG,
  );
  const variantFormatted = formatPreparedRomName(
    {
      title: 'Castlevania: Blood Moon',
      systemName: 'nes-roms',
      regions: ['USA'],
      fileRole: 'Hack',
      archiveFilename: 'Castlevania - Blood Moon (v1.0)[Improved Controls v3.1].zip',
      innerFilename: 'Castlevania - Blood Moon (v1.0)[Improved Controls v3.1].nes',
    },
    '.nes',
    HYBRID_CFG,
  );
  assert.equal(baseFormatted, 'Castlevania - Blood Moon (USA) [Hack v1.0].nes');
  assert.equal(variantFormatted, 'Castlevania - Blood Moon (USA) [Hack v1.0].nes');

  const resolved = disambiguateCollidingRomFilenames(
    [
      {
        suggestedFilename: variantFormatted,
        extension: '.nes',
        innerPath: 'Castlevania - Blood Moon (v1.0)[Improved Controls v3.1].nes',
        archiveFilename: 'Castlevania - Blood Moon (v1.0)[Improved Controls v3.1].zip',
        displayLabel: 'Castlevania - Blood Moon (v1.0)[Improved Controls v3.1].nes',
      },
      {
        suggestedFilename: baseFormatted,
        extension: '.nes',
        innerPath: 'Castlevania - Blood Moon (v1.0).nes',
        archiveFilename: 'Castlevania - Blood Moon (v1.0).zip',
        displayLabel: 'Castlevania - Blood Moon (v1.0).nes',
      },
    ],
    HYBRID_CFG,
  );

  assert.deepEqual(resolved, [
    'Castlevania - Blood Moon (USA) [Hack v1.0] [Improved Controls v3.1].nes',
    'Castlevania - Blood Moon (USA) [Hack v1.0].nes',
  ]);

  // Verify buildUpgradeMatchStem treats the variant as a distinct role so neither clobbers or
  // falsely flags the other as already installed on an SD card.
  const variantStem = buildUpgradeMatchStem(resolved[0]);
  const baseStem = buildUpgradeMatchStem(resolved[1]);
  assert.equal(variantStem.stem, baseStem.stem);
  assert.notEqual(variantStem.role, baseStem.role);
});

test('disambiguateCollidingRomFilenames handles sibling bracket variants, multi-disc sets, folder names, max length, and numeric fallback', () => {
  // Two bracketed variants
  assert.deepEqual(
    disambiguateCollidingRomFilenames(
      [
        {
          suggestedFilename: 'Super Metroid (USA) [Hack v1.2].sfc',
          extension: '.sfc',
          innerPath: 'Super Metroid [Redux + FastROM].sfc',
        },
        {
          suggestedFilename: 'Super Metroid (USA) [Hack v1.2].sfc',
          extension: '.sfc',
          innerPath: 'Super Metroid [Redux + MSU-1].sfc',
        },
      ],
      HYBRID_CFG,
    ),
    [
      'Super Metroid (USA) [Hack v1.2] [Redux + FastROM].sfc',
      'Super Metroid (USA) [Hack v1.2] [Redux + MSU-1].sfc',
    ],
  );

  // Multi-disc parenthetical tags preserve parentheses
  assert.deepEqual(
    disambiguateCollidingRomFilenames(
      [
        {
          suggestedFilename: 'Final Fantasy VII (USA).chd',
          extension: '.chd',
          innerPath: 'Final Fantasy VII (USA) (Disc 1).chd',
        },
        {
          suggestedFilename: 'Final Fantasy VII (USA).chd',
          extension: '.chd',
          innerPath: 'Final Fantasy VII (USA) (Disc 2).chd',
        },
      ],
      HYBRID_CFG,
    ),
    ['Final Fantasy VII (USA) (Disc 1).chd', 'Final Fantasy VII (USA) (Disc 2).chd'],
  );

  // Folder differentiator when basenames are identical
  assert.deepEqual(
    disambiguateCollidingRomFilenames(
      [
        {
          suggestedFilename: 'Mega Man 2 (USA) [Hack].nes',
          extension: '.nes',
          innerPath: 'EasyMode/Mega Man 2.nes',
        },
        {
          suggestedFilename: 'Mega Man 2 (USA) [Hack].nes',
          extension: '.nes',
          innerPath: 'HardMode/Mega Man 2.nes',
        },
      ],
      HYBRID_CFG,
    ),
    ['Mega Man 2 (USA) [Hack] (EasyMode).nes', 'Mega Man 2 (USA) [Hack] (HardMode).nes'],
  );

  // Max filename length trims base stem while keeping unique suffix intact
  const maxLenResolved = disambiguateCollidingRomFilenames(
    [
      {
        suggestedFilename: 'Castlevania - Blood Moon (USA) [Hack v1.0].nes',
        extension: '.nes',
        innerPath: 'Castlevania - Blood Moon (v1.0)[Improved Controls v3.1].nes',
      },
      {
        suggestedFilename: 'Castlevania - Blood Moon (USA) [Hack v1.0].nes',
        extension: '.nes',
        innerPath: 'Castlevania - Blood Moon (v1.0).nes',
      },
    ],
    { romSanitizeFat32: true, romMaxFilenameLen: 52 },
  );
  assert.ok(maxLenResolved[0].length <= 52);
  assert.ok(maxLenResolved[1].length <= 52);
  assert.notEqual(maxLenResolved[0].toLowerCase(), maxLenResolved[1].toLowerCase());
  assert.ok(maxLenResolved[0].includes('[Improved Controls v3.1]'));

  // Identical indistinguishable siblings fall back to (2)
  assert.deepEqual(
    disambiguateCollidingRomFilenames(
      [
        { suggestedFilename: 'Mystery Game (USA).nes', extension: '.nes', innerPath: 'game.nes' },
        { suggestedFilename: 'Mystery Game (USA).nes', extension: '.nes', innerPath: 'game.nes' },
      ],
      HYBRID_CFG,
    ),
    ['Mystery Game (USA).nes', 'Mystery Game (USA) (2).nes'],
  );
});

