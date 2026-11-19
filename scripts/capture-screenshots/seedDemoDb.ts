import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  evaluateAchievements,
  recordAchievementCounter,
} from '../../src/server/achievements.ts';
import { runDatabaseMigrations } from '../../src/server/migrations.ts';
import {
  type StorageFolderMappingConfig,
  normalizeStorageFolderConfig,
} from '../../src/shared/storageFolderMappings.ts';
import type {
  ItemStatus,
  ReleaseMetadata,
  SystemIndexCursor,
} from '../../src/types.ts';
import {
  type DemoArtMotif,
  type DemoCoverSpec,
  renderDemoCoverPng,
  renderDemoScreenshotPng,
  writePngFile,
} from './demoArtwork.ts';

export interface SeedDemoOptions {
  /** Optional root directory. Defaults to a newly created OS temp folder. */
  rootDir?: string;
  /** Optional reference clock for deterministic timestamps in tests/CI. */
  now?: Date;
}

export interface SeedDemoResult {
  rootDir: string;
  dataDir: string;
  downloadDir: string;
  dbPath: string;
  schemaVersion: number;
  featuredItemId: number;
  featuredItemTitle: string;
  seededSystems: string[];
  seededReleases: number;
  seededRuns: number;
  unlockedTrophies: number;
}

interface ConsoleTheme {
  slug: string;
  displayLabel: string;
  shortLabel: string;
  eraTag: string;
  extension: string;
  palette: DemoCoverSpec['palette'];
}

const CONSOLE_THEMES: Record<string, ConsoleTheme> = {
  snes: {
    slug: 'snes',
    displayLabel: 'Super Nintendo',
    shortLabel: 'SNES',
    eraTag: '16-BIT',
    extension: '.sfc',
    palette: {
      headerBg: [52, 34, 92],
      headerAccent: [164, 128, 255],
      skyTop: [18, 16, 52],
      skyBottom: [68, 34, 108],
      accent: [120, 232, 168],
      highlight: [255, 208, 96],
    },
  },
  gba: {
    slug: 'gba',
    displayLabel: 'Game Boy Advance',
    shortLabel: 'GBA',
    eraTag: '32-BIT',
    extension: '.gba',
    palette: {
      headerBg: [34, 42, 112],
      headerAccent: [110, 178, 255],
      skyTop: [12, 24, 58],
      skyBottom: [42, 74, 134],
      accent: [76, 224, 208],
      highlight: [255, 198, 92],
    },
  },
  psx: {
    slug: 'psx',
    displayLabel: 'PlayStation',
    shortLabel: 'PS1',
    eraTag: '32-BIT',
    extension: '.chd',
    palette: {
      headerBg: [28, 34, 44],
      headerAccent: [242, 92, 92],
      skyTop: [14, 18, 32],
      skyBottom: [64, 24, 52],
      accent: [86, 212, 255],
      highlight: [255, 132, 110],
    },
  },
  n64: {
    slug: 'n64',
    displayLabel: 'Nintendo 64',
    shortLabel: 'N64',
    eraTag: '64-BIT',
    extension: '.z64',
    palette: {
      headerBg: [24, 58, 108],
      headerAccent: [255, 206, 68],
      skyTop: [10, 26, 62],
      skyBottom: [34, 86, 132],
      accent: [72, 232, 132],
      highlight: [255, 214, 78],
    },
  },
  genesis: {
    slug: 'genesis',
    displayLabel: 'Sega Genesis',
    shortLabel: 'GENESIS',
    eraTag: '16-BIT',
    extension: '.md',
    palette: {
      headerBg: [24, 24, 30],
      headerAccent: [244, 76, 98],
      skyTop: [16, 14, 28],
      skyBottom: [84, 22, 48],
      accent: [255, 96, 128],
      highlight: [255, 208, 104],
    },
  },
  saturn: {
    slug: 'saturn',
    displayLabel: 'Sega Saturn',
    shortLabel: 'SATURN',
    eraTag: '32-BIT',
    extension: '.chd',
    palette: {
      headerBg: [32, 46, 64],
      headerAccent: [88, 220, 245],
      skyTop: [12, 22, 42],
      skyBottom: [30, 68, 102],
      accent: [96, 236, 255],
      highlight: [245, 222, 120],
    },
  },
  dreamcast: {
    slug: 'dreamcast',
    displayLabel: 'Sega Dreamcast',
    shortLabel: 'DC',
    eraTag: '128-BIT',
    extension: '.chd',
    palette: {
      headerBg: [44, 36, 32],
      headerAccent: [255, 138, 64],
      skyTop: [18, 24, 48],
      skyBottom: [92, 52, 44],
      accent: [255, 152, 76],
      highlight: [255, 232, 148],
    },
  },
  psp: {
    slug: 'psp',
    displayLabel: 'PlayStation Portable',
    shortLabel: 'PSP',
    eraTag: 'UMD',
    extension: '.cso',
    palette: {
      headerBg: [20, 34, 42],
      headerAccent: [64, 230, 190],
      skyTop: [10, 22, 34],
      skyBottom: [24, 72, 86],
      accent: [72, 238, 198],
      highlight: [192, 248, 255],
    },
  },
  nds: {
    slug: 'nds',
    displayLabel: 'Nintendo DS',
    shortLabel: 'NDS',
    eraTag: 'DUAL',
    extension: '.nds',
    palette: {
      headerBg: [34, 48, 56],
      headerAccent: [112, 235, 142],
      skyTop: [14, 28, 36],
      skyBottom: [34, 82, 74],
      accent: [118, 242, 154],
      highlight: [255, 226, 124],
    },
  },
  nes: {
    slug: 'nes',
    displayLabel: 'Nintendo NES',
    shortLabel: 'NES',
    eraTag: '8-BIT',
    extension: '.nes',
    palette: {
      headerBg: [38, 36, 40],
      headerAccent: [236, 84, 72],
      skyTop: [18, 16, 30],
      skyBottom: [72, 28, 36],
      accent: [248, 112, 88],
      highlight: [255, 222, 122],
    },
  },
  gamecube: {
    slug: 'gamecube',
    displayLabel: 'Nintendo GameCube',
    shortLabel: 'NGC',
    eraTag: '128-BIT',
    extension: '.rvz',
    palette: {
      headerBg: [48, 36, 98],
      headerAccent: [164, 142, 255],
      skyTop: [18, 16, 48],
      skyBottom: [58, 44, 122],
      accent: [152, 138, 255],
      highlight: [128, 242, 220],
    },
  },
  gbc: {
    slug: 'gbc',
    displayLabel: 'Game Boy Color',
    shortLabel: 'GBC',
    eraTag: '8-BIT',
    extension: '.gbc',
    palette: {
      headerBg: [34, 58, 40],
      headerAccent: [156, 224, 76],
      skyTop: [14, 34, 24],
      skyBottom: [42, 92, 56],
      accent: [162, 236, 84],
      highlight: [255, 234, 118],
    },
  },
};

interface DemoReleaseBlueprint {
  slug: string;
  system: keyof typeof CONSOLE_THEMES;
  title: string;
  subtitle: string;
  publisher: string;
  developer: string;
  year: string;
  genres: string[];
  regions: string[];
  languages: string[];
  sources: string[];
  releaseTags: string[];
  status: ItemStatus;
  installedDevice?: string;
  sizeMb: number;
  motif: DemoArtMotif;
  description: string;
  featured?: boolean;
  extraFiles?: { label: string; suffix: string; role: string; sizeMb: number }[];
}

const DEMO_RELEASES: DemoReleaseBlueprint[] = [
  {
    slug: 'chrono-vanguard-dx',
    system: 'snes',
    title: 'Chrono Vanguard DX',
    subtitle: 'English Translation v2.4 + MSU-1 Patch',
    publisher: 'Astra Softworks',
    developer: 'Pixel Forge Tokyo',
    year: '1995',
    genres: ['RPG', 'Adventure'],
    regions: ['Japan', 'USA'],
    languages: ['English', 'Japanese'],
    sources: ['Fan Translation', 'No-Intro'],
    releaseTags: ['Translation', 'Hack'],
    status: 'downloaded',
    installedDevice: 'Analogue Pocket SD',
    sizeMb: 6.4,
    motif: 'rpg_citadel',
    featured: true,
    description:
      'Complete English script localization and quality-of-life re-balance for the beloved 16-bit time-traveling JRPG. Includes proportional variable-width dialogue fonts, restored orchestral audio hooks, and verified clean checksums for original hardware and FPGA cores.',
    extraFiles: [
      { label: 'Main ROM (v2.4 English)', suffix: '(En v2.4).zip', role: 'Translation', sizeMb: 4.2 },
      { label: 'Widescreen HUD Patch', suffix: '(Widescreen Hack).zip', role: 'Hack', sizeMb: 2.2 },
    ],
  },
  {
    slug: 'starblade-zero-64',
    system: 'n64',
    title: 'Starblade Zero 64',
    subtitle: '60FPS Expansion Pak Edition',
    publisher: 'Nova Interactive',
    developer: 'VectorWorks 64',
    year: '1998',
    genres: ['Shooter', 'Action'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    releaseTags: ['Retail ROM', 'Hack'],
    status: 'downloaded',
    installedDevice: 'MiSTer FPGA',
    sizeMb: 32.8,
    motif: 'starfighter',
    description:
      'High-speed orbital rail shooter featuring locked 60FPS Expansion Pak optimization, widescreen 16:9 viewport support, and crisp vertex lighting across 12 branching asteroid sectors.',
  },
  {
    slug: 'solstice-tactics-advance',
    system: 'gba',
    title: 'Solstice Tactics Advance',
    subtitle: 'Rebalanced Class Edition',
    publisher: 'Sunburst Games',
    developer: 'Halcyon Handheld',
    year: '2003',
    genres: ['Strategy', 'RPG'],
    regions: ['USA', 'Europe'],
    languages: ['English', 'French', 'Spanish'],
    sources: ['No-Intro'],
    releaseTags: ['Retail ROM'],
    status: 'downloaded',
    installedDevice: 'Analogue Pocket SD',
    sizeMb: 16.2,
    motif: 'crystal_peak',
    description:
      'Isometric turn-based tactical campaign featuring 36 customizable job classes, dynamic weather terrain modifiers, and quick-suspend battery SRAM persistence.',
  },
  {
    slug: 'aether-blade-crimson-moon',
    system: 'psx',
    title: 'Aether Blade: Crimson Moon',
    subtitle: 'Complete English Dub + Subtitles',
    publisher: 'Eclipse Entertainment',
    developer: 'Red Moon Studio',
    year: '1997',
    genres: ['Action', 'Adventure'],
    regions: ['Japan', 'USA'],
    languages: ['English'],
    sources: ['Redump', 'Fan Translation'],
    releaseTags: ['Translation'],
    status: 'downloaded',
    installedDevice: 'Retroid Pocket 5',
    sizeMb: 412.5,
    motif: 'dungeon_orb',
    description:
      'Gothic side-scrolling action-exploration classic preserved in lossless CHD format with restored Japanese voice acting, crisp English subtitles, and zero disc-seek stutter.',
  },
  {
    slug: 'cyber-drifter-2099',
    system: 'genesis',
    title: 'Cyber Drifter 2099',
    subtitle: 'FM Synth Overdrive',
    publisher: 'MegaByte Arcade',
    developer: 'Blast Processing Lab',
    year: '1993',
    genres: ['Racing', 'Arcade'],
    regions: ['USA', 'Japan'],
    languages: ['English'],
    sources: ['Homebrew', 'No-Intro'],
    releaseTags: ['Homebrew'],
    status: 'downloaded',
    installedDevice: 'MiSTer FPGA',
    sizeMb: 4.1,
    motif: 'cyber_highway',
    description:
      'Brand-new 16-bit super-scaler highway racer engineered for real hardware with 6-button controller support, blazing YM2612 FM synth soundtrack, and split-screen time attack.',
  },
  {
    slug: 'nebula-striker-iii',
    system: 'saturn',
    title: 'Nebula Striker III',
    subtitle: 'Arcade Perfect 1MB RAM Cart',
    publisher: 'Orbit Digital',
    developer: 'Cosmos Arcade',
    year: '1996',
    genres: ['Shooter', 'Arcade'],
    regions: ['Japan'],
    languages: ['English', 'Japanese'],
    sources: ['Redump', 'Fan Translation'],
    releaseTags: ['Translation', 'Retail ROM'],
    status: 'downloaded',
    sizeMb: 348.0,
    motif: 'starfighter',
    description:
      'Vertical bullet-hell shmup with native TATE screen rotation, zero slowdown with the 1MB RAM cartridge, and complete English menu translation.',
  },
  {
    slug: 'hyper-outrun-gt',
    system: 'dreamcast',
    title: 'Hyper Outrun GT',
    subtitle: 'VGA 480p Wide-Screen Edition',
    publisher: 'Horizon Works',
    developer: 'Velocity AM',
    year: '2000',
    genres: ['Racing', 'Arcade'],
    regions: ['USA', 'Europe'],
    languages: ['English'],
    sources: ['Redump'],
    releaseTags: ['Retail ROM'],
    status: 'downloaded',
    installedDevice: 'Retroid Pocket 5',
    sizeMb: 584.2,
    motif: 'cyber_highway',
    description:
      'Sun-drenched coastal arcade drift racer preserved in clean GD-ROM CHD format with native 480p VGA output and VMU ghost replay telemetry.',
  },
  {
    slug: 'iron-valkyrie-ex',
    system: 'psp',
    title: 'Iron Valkyrie EX',
    subtitle: 'Dual-Analog Remastered Patch',
    publisher: 'Vanguard Portable',
    developer: 'Aegis Works',
    year: '2008',
    genres: ['Action', 'Mecha'],
    regions: ['Japan', 'USA'],
    languages: ['English'],
    sources: ['Redump', 'Fan Translation'],
    releaseTags: ['Translation', 'Hack'],
    status: 'downloaded',
    sizeMb: 628.6,
    motif: 'mecha_horizon',
    description:
      'High-mobility orbital mecha combat action game patched for right-stick camera control and high-bitrate UI textures on modern handhelds.',
  },
  {
    slug: 'emerald-labyrinth-reforged',
    system: 'nds',
    title: 'Emerald Labyrinth: Reforged',
    subtitle: 'Cartography Edition',
    publisher: 'Compass Interactive',
    developer: 'Guild Studio',
    year: '2009',
    genres: ['RPG', 'Dungeon Crawler'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    releaseTags: ['Retail ROM'],
    status: 'downloaded',
    installedDevice: 'Retroid Pocket 5',
    sizeMb: 64.5,
    motif: 'dungeon_orb',
    description:
      'First-person grid-based dungeon crawler with dual-screen auto-mapping enhancements and balanced late-game boss encounters.',
  },
  {
    slug: 'phantom-castle-symphony',
    system: 'nes',
    title: 'Phantom Castle Symphony',
    subtitle: 'MMC5 Color & Audio Upgrade',
    publisher: 'RetroCraft Guild',
    developer: '8-Bit Alchemists',
    year: '1991',
    genres: ['Platformer', 'Action'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    releaseTags: ['Hack'],
    status: 'downloaded',
    sizeMb: 0.78,
    motif: 'rpg_citadel',
    description:
      'Classic 8-bit gothic platformer upgraded with zero sprite flicker, expanded MMC5 pulse channels, and responsive mid-air stair controls.',
  },
  {
    slug: 'prism-quest-skyward',
    system: 'gbc',
    title: 'Prism Quest: Skyward',
    subtitle: 'DX Full-Color Restoration',
    publisher: 'Pocket Dreamers',
    developer: 'Chroma Pixel',
    year: '1999',
    genres: ['Adventure', 'Puzzle'],
    regions: ['USA', 'Europe'],
    languages: ['English'],
    sources: ['No-Intro'],
    releaseTags: ['Retail ROM', 'Hack'],
    status: 'downloaded',
    sizeMb: 2.1,
    motif: 'crystal_peak',
    description:
      'Hand-crafted top-down pocket adventure featuring vibrant 56-color palettes, charming chiptune melodies, and 8 interlocking sky temples.',
  },
  {
    slug: 'mecha-frontier-zero',
    system: 'gamecube',
    title: 'Mecha Frontier Zero',
    subtitle: 'Progressive Scan 480p Clean Rip',
    publisher: 'Titan Interactive',
    developer: 'CubeForge',
    year: '2004',
    genres: ['Action', 'Strategy'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['Redump'],
    releaseTags: ['Retail ROM'],
    status: 'downloaded',
    sizeMb: 892.4,
    motif: 'mecha_horizon',
    description:
      'Squad-based mech command action title preserved in lossless RVZ format with instant loading and 4-player split-screen skirmish mode.',
  },
  {
    slug: 'pixel-odyssey-95',
    system: 'snes',
    title: 'Pixel Odyssey 95',
    subtitle: 'Director Cut Deluxe',
    publisher: 'Starlight Soft',
    developer: 'Mode7 Collective',
    year: '1995',
    genres: ['Platformer', 'Adventure'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    releaseTags: ['Retail ROM'],
    status: 'downloaded',
    sizeMb: 4.5,
    motif: 'crystal_peak',
    description:
      'Colorful Mode-7 action platformer celebrating golden-age 16-bit parallax scrolling and tight precision jumping.',
  },
  {
    slug: 'solaris-drift-rally',
    system: 'psx',
    title: 'Solaris Drift Rally',
    subtitle: 'NeGcon Analog Edition',
    publisher: 'Apex Motorsport',
    developer: 'PolyTrack 98',
    year: '1998',
    genres: ['Racing', 'Sports'],
    regions: ['Europe', 'USA'],
    languages: ['English', 'German'],
    sources: ['Redump'],
    releaseTags: ['Retail ROM'],
    status: 'available',
    sizeMb: 318.4,
    motif: 'cyber_highway',
    description:
      'Technical rally racer spanning midnight mountain passes, gravel hairpins, and coastal dusk stages with tactile drift physics.',
  },
  {
    slug: 'crystal-echoes-portable',
    system: 'gba',
    title: 'Crystal Echoes Portable',
    subtitle: 'Color & Sound Restoration',
    publisher: 'Lumina Works',
    developer: 'Crystalline',
    year: '2004',
    genres: ['RPG', 'Adventure'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    releaseTags: ['Hack'],
    status: 'downloaded',
    sizeMb: 16.0,
    motif: 'dungeon_orb',
    description:
      'Restores rich non-washed-out OLED color curves and uncompressed SNES-grade audio samples to this sweeping handheld fantasy epic.',
  },
  {
    slug: 'astral-wing-fighters',
    system: 'genesis',
    title: 'Astral Wing Fighters',
    subtitle: '6-Button Arcade Port',
    publisher: 'Thunderbolt Games',
    developer: 'Hyperion 16',
    year: '1994',
    genres: ['Shooter', 'Arcade'],
    regions: ['Japan', 'USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    releaseTags: ['Port'],
    status: 'available',
    sizeMb: 3.4,
    motif: 'starfighter',
    description:
      'Horizontal starfighter shoot-em-up with multi-layer parallax nebulae, selectable weapon pods, and boss rush challenge mode.',
  },
  {
    slug: 'shadow-keep-directors-cut',
    system: 'n64',
    title: 'Shadow Keep: Director Cut',
    subtitle: 'English Fan Translation',
    publisher: 'Obsidian Crown',
    developer: 'N64 Preservation Team',
    year: '1999',
    genres: ['RPG', 'Dungeon Crawler'],
    regions: ['Japan'],
    languages: ['English', 'Japanese'],
    sources: ['Fan Translation'],
    releaseTags: ['Translation'],
    status: 'available',
    sizeMb: 48.0,
    motif: 'rpg_citadel',
    description:
      'Previously Japan-exclusive dark fantasy action RPG faithfully translated into English with restored lore codex entries.',
  },
  {
    slug: 'turbo-circuit-dx',
    system: 'gba',
    title: 'Turbo Circuit DX',
    subtitle: 'Community Track Pack',
    publisher: 'Circuit Labs',
    developer: 'Pocket Boost',
    year: '2002',
    genres: ['Racing', 'Arcade'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['Homebrew'],
    releaseTags: ['Homebrew'],
    status: 'downloaded',
    sizeMb: 8.4,
    motif: 'cyber_highway',
    description:
      'Mode-7 inspired futuristic antigravity circuit racer featuring 24 community-built tracks and ghost lap saving.',
  },
  {
    slug: 'starfall-chronicles',
    system: 'psp',
    title: 'Starfall Chronicles',
    subtitle: 'Undub + 60FPS Patch',
    publisher: 'Celestial Soft',
    developer: 'Aether Studio',
    year: '2010',
    genres: ['RPG', 'Strategy'],
    regions: ['USA', 'Japan'],
    languages: ['English', 'Japanese'],
    sources: ['Redump', 'Fan Translation'],
    releaseTags: ['Translation'],
    status: 'available',
    sizeMb: 710.0,
    motif: 'crystal_peak',
    description:
      'Expansive sci-fi strategy RPG combining crisp sprite animation with orchestrated starship fleet battles.',
  },
  {
    slug: 'neon-grid-runner',
    system: 'dreamcast',
    title: 'Neon Grid Runner',
    subtitle: 'Indie 2025 Homebrew Edition',
    publisher: 'Vector Arcade',
    developer: 'SynthForge',
    year: '2025',
    genres: ['Action', 'Arcade'],
    regions: ['World'],
    languages: ['English'],
    sources: ['Homebrew'],
    releaseTags: ['Homebrew', 'Port'],
    status: 'downloaded',
    sizeMb: 196.0,
    motif: 'mecha_horizon',
    description:
      'Modern indie Dreamcast arcade action release pushing crisp 60fps cel-shaded visuals and full arcade stick support.',
  },
];

function createMinimalValidZipBuffer(entryName: string, content: string): Buffer {
  // Valid single-file uncompressed (store) ZIP archive so archive inspection / disk metrics stay valid
  const nameBuf = Buffer.from(entryName, 'utf8');
  const dataBuf = Buffer.from(content, 'utf8');
  let crc = 0xffffffff;
  for (let i = 0; i < dataBuf.length; i += 1) {
    crc ^= dataBuf[i];
    for (let b = 0; b < 8; b += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  crc = (crc ^ 0xffffffff) >>> 0;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8); // store
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralOffset = localHeader.length + nameBuf.length + dataBuf.length;
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(dataBuf.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralSize = centralHeader.length + nameBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, nameBuf, dataBuf, centralHeader, nameBuf, eocd]);
}

function buildDemoStorageFolderConfig(): StorageFolderMappingConfig {
  return normalizeStorageFolderConfig({
    useRomTypeSubfolders: true,
    romTypeSubfolders: {
      retail: 'Retail',
      hacks: 'Hacks',
      translations: 'Translations',
      homebrew: 'Homebrew',
      ports: 'Ports',
      prototypes: 'Prototypes',
      other: 'Other',
    },
    systemOverrides: {
      snes: { folderName: 'SFC', useRomTypeSubfolders: 'enabled' },
      gba: { folderName: 'GBA', useRomTypeSubfolders: 'enabled' },
      psx: { folderName: 'PS', useRomTypeSubfolders: 'inherit' },
      genesis: { folderName: 'MD', useRomTypeSubfolders: 'enabled' },
      n64: { folderName: 'N64', useRomTypeSubfolders: 'inherit' },
      gbc: { folderName: 'GBC', useRomTypeSubfolders: 'inherit' },
    },
  });
}

export function seedDemoEnvironment(options: SeedDemoOptions = {}): SeedDemoResult {
  const rootDir = options.rootDir
    ? path.resolve(options.rootDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-sync-preview-'));
  const dataDir = path.join(rootDir, '.rgt-data');
  const downloadDir = path.join(rootDir, 'repository');
  const dbPath = path.join(dataDir, 'scraper.db');
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  try {
    const migrationReport = runDatabaseMigrations(db, {
      dataDir,
      defaultDownloadDir: downloadDir,
    });

    const systemSlugs = Object.keys(CONSOLE_THEMES);
    const systemIndexState: Record<string, SystemIndexCursor> = {};
    for (const slug of systemSlugs) {
      const countForSlug = DEMO_RELEASES.filter((r) => r.system === slug).length;
      systemIndexState[slug] = {
        lastIndexedAt: new Date(now.getTime() - 25 * 60 * 1000).toISOString(),
        totalWpPosts: countForSlug,
        totalPages: 1,
        pagesIndexed: 1,
        fullyIndexed: true,
        scope: 'full',
      };
    }

    const storageFolderConfig = buildDemoStorageFolderConfig();

    // Insert scraper_config id=1 with hasCompletedLogin=true (last_authenticated_at populated)
    // and empty password_enc so the booted demo server never attempts live external login.
    db.prepare(`
      INSERT INTO scraper_config (
        id, base_url, login_url, username, password_enc, download_dir,
        cron_schedule, schedule_enabled, base_delay_ms, min_delay_ms, max_delay_ms,
        backoff_multiplier, max_retries, max_concurrency,
        download_chunk_concurrency, download_chunk_min_size_mb,
        request_timeout_ms, user_agent, system_filter,
        allowed_release_types_json, discovered_systems_json,
        last_watermark_at, last_authenticated_at,
        rom_naming_template, rom_sanitize_fat32, rom_max_filename_len,
        storage_folder_config_json, auto_download_new_releases,
        system_index_state_json, updated_at
      ) VALUES (
        1, ?, ?, ?, '', ?,
        '0 */6 * * *', 1, 1200, 600, 30000,
        1.8, 4, 2,
        3, 16,
        30000, ?, '',
        ?, ?,
        ?, ?,
        '{title}{regionParen}{tagBracket}', 1, 128,
        ?, 1,
        ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        download_dir = excluded.download_dir,
        discovered_systems_json = excluded.discovered_systems_json,
        storage_folder_config_json = excluded.storage_folder_config_json,
        system_index_state_json = excluded.system_index_state_json,
        last_authenticated_at = excluded.last_authenticated_at,
        updated_at = excluded.updated_at
    `).run(
      'https://retrogametalk.com/repo/',
      'https://retrogametalk.com/login/',
      'archivist_demo',
      downloadDir,
      'RetroGameTalkSync/PreviewCapture',
      JSON.stringify(['Retail ROM', 'Hack', 'Translation', 'Homebrew', 'Port']),
      JSON.stringify(systemSlugs),
      new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      new Date(now.getTime() - 18 * 60 * 1000).toISOString(),
      JSON.stringify(storageFolderConfig),
      JSON.stringify(systemIndexState),
      nowIso,
    );

    // Seed 14 historical sync runs across the past 14 days for rich D3 & Telemetry Deck charts
    const runIds: number[] = [];
    const insertRunStmt = db.prepare(`
      INSERT INTO sync_runs (
        trigger_type, mode, dry_run, status, started_at, finished_at,
        pages_crawled, new_found, downloaded_count, skipped_count, failed_count,
        bytes_downloaded, rate_limit_hits, avg_delay_ms, error_summary
      ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    for (let dayOffset = 13; dayOffset >= 0; dayOffset -= 1) {
      const started = new Date(now.getTime() - (dayOffset * 24 + 4) * 60 * 60 * 1000);
      const durationMin = 6 + ((13 - dayOffset) % 5) * 3;
      const finished = new Date(started.getTime() + durationMin * 60 * 1000);
      const trigger = dayOffset % 3 === 0 ? 'manual' : 'scheduled';
      const mode = dayOffset === 13 ? 'full' : 'incremental';
      const pagesCrawled = mode === 'full' ? 28 : 4 + (dayOffset % 6);
      const newFound = mode === 'full' ? 14 : 1 + ((13 - dayOffset) % 4);
      const downloadedCount = Math.max(1, newFound);
      const skippedCount = 4 + (dayOffset % 7);
      const bytesDownloaded = Math.round((140 + ((13 - dayOffset) * 58) % 520) * 1024 * 1024);
      const rateLimitHits = dayOffset === 9 || dayOffset === 4 ? 1 : 0;
      const avgDelayMs = 820 + (dayOffset % 5) * 115 + rateLimitHits * 340;

      const info = insertRunStmt.run(
        trigger,
        mode,
        'completed',
        started.toISOString(),
        finished.toISOString(),
        pagesCrawled,
        newFound,
        downloadedCount,
        skippedCount,
        0,
        bytesDownloaded,
        rateLimitHits,
        avgDelayMs,
      );
      runIds.push(Number(info.lastInsertRowid));
    }

    const latestRunId = runIds[runIds.length - 1];

    // Seed releases, local crisp PNG covers/screenshots, and ROM files
    const insertReleaseStmt = db.prepare(`
      INSERT INTO catalog_releases (
        remote_url, wp_post_id, wp_post_type, remote_path, local_path, system_name,
        release_type, release_tags_json, title, file_size_bytes, size_is_estimated,
        published_at, remote_updated_at, status, error_message, last_run_id,
        discovered_at, downloaded_at, publisher, developer, release_year,
        genres_json, regions_json, languages_json, sources_json,
        cover_local_path, screenshots_json, metadata_json,
        installed_at, installed_device_label
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, NULL, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
    `);

    const insertFileStmt = db.prepare(`
      INSERT INTO catalog_release_files (
        release_id, remote_url, download_url, remote_path, local_path,
        filename, display_label, file_role, file_size_bytes, status,
        error_message, last_run_id, discovered_at, downloaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `);

    let featuredItemId = 1;
    let featuredItemTitle = DEMO_RELEASES[0].title;

    DEMO_RELEASES.forEach((bp, idx) => {
      const theme = CONSOLE_THEMES[bp.system];
      const releaseDir = path.join(downloadDir, bp.system, bp.slug);
      fs.mkdirSync(releaseDir, { recursive: true });

      // Write crisp local cover PNG inside releaseDir/cover.png
      const coverAbsPath = path.join(releaseDir, 'cover.png');
      const coverBytes = renderDemoCoverPng({
        title: bp.title,
        consoleLabel: theme.shortLabel,
        eraTag: theme.eraTag,
        genreTag: bp.genres[0] || 'CLASSIC',
        regionTag: bp.regions[0]?.slice(0, 3).toUpperCase() || 'USA',
        palette: theme.palette,
        motif: bp.motif,
        seed: 1000 + idx * 73,
      });
      writePngFile(coverAbsPath, coverBytes);

      // Generate 3 distinct widescreen gameplay screenshots for the first 8 releases (always for featured)
      const screenshotRelPaths: string[] = [];
      const screenshotAbsPaths: string[] = [];
      if (idx < 8 || bp.featured) {
        const shotsDir = path.join(releaseDir, 'screenshots');
        fs.mkdirSync(shotsDir, { recursive: true });
        for (let sIdx = 0; sIdx < 3; sIdx += 1) {
          const filename = `${String(sIdx + 1).padStart(2, '0')}.png`;
          const shotAbs = path.join(shotsDir, filename);
          const shotBytes = renderDemoScreenshotPng({
            title: bp.title,
            consoleLabel: theme.displayLabel,
            sceneIndex: sIdx,
            motif: bp.motif,
            palette: theme.palette,
            seed: 2000 + idx * 97,
          });
          writePngFile(shotAbs, shotBytes);
          screenshotRelPaths.push(`screenshots/${filename}`);
          screenshotAbsPaths.push(shotAbs);
        }
      }

      const daysAgo = idx % 14;
      const publishedAt = new Date(now.getTime() - (daysAgo + 1) * 24 * 60 * 60 * 1000).toISOString();
      const discoveredAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
      const downloadedAt =
        bp.status === 'downloaded'
          ? new Date(now.getTime() - Math.max(0, daysAgo - 0.2) * 24 * 60 * 60 * 1000).toISOString()
          : null;
      const installedAt =
        bp.status === 'downloaded' && bp.installedDevice
          ? new Date(now.getTime() - Math.max(0, daysAgo - 0.1) * 24 * 60 * 60 * 1000).toISOString()
          : null;

      const totalBytes = Math.round(bp.sizeMb * 1024 * 1024);
      const remoteUrl = `https://retrogametalk.com/repo/${bp.system}/${bp.slug}/`;
      const remotePath = `/${bp.system}/${bp.slug}/`;

      const metadata: ReleaseMetadata = {
        wpPostId: 90000 + idx,
        wpPostType: `${bp.system}_rom`,
        title: bp.title,
        subtitle: bp.subtitle,
        consoleName: theme.displayLabel,
        publisher: bp.publisher,
        developer: bp.developer,
        releaseYear: bp.year,
        genres: bp.genres,
        regions: bp.regions,
        languages: bp.languages,
        sources: bp.sources,
        formats: [theme.extension.replace('.', '').toUpperCase(), 'ZIP'],
        releaseTags: bp.releaseTags,
        downloadsCount: String(1280 + idx * 340),
        releasedAgo: `${daysAgo + 1}d ago`,
        updatedDate: publishedAt.slice(0, 10),
        publishedAt,
        remoteUpdatedAt: publishedAt,
        specs: [
          { label: 'Console', value: theme.displayLabel },
          { label: 'Format', value: `${theme.extension.toUpperCase()} Archive` },
          { label: 'CRC Verified', value: 'No-Intro / Redump Match' },
          { label: 'Regions', value: bp.regions.join(', ') },
        ],
        descriptionHtml: `<p>${bp.description}</p><ul><li>Verified local archival checksum and clean folder layout</li><li>Ready for direct browser export to SD cards and handheld devices</li></ul>`,
        descriptionText: bp.description,
        coverUrl: null,
        coverLocalRelPath: 'cover.png',
        screenshotUrls: [],
        screenshotLocalRelPaths: screenshotRelPaths,
        screenshotsFullResVersion: 2,
        detailHydrated: true,
        sourcePageUrl: remoteUrl,
        fetchedAt: nowIso,
      };

      const runId = runIds[Math.min(runIds.length - 1, idx % runIds.length)];
      const insertInfo = insertReleaseStmt.run(
        remoteUrl,
        90000 + idx,
        `${bp.system}_rom`,
        remotePath,
        releaseDir,
        bp.system,
        bp.releaseTags[0] || 'Retail ROM',
        JSON.stringify(bp.releaseTags),
        bp.title,
        totalBytes,
        bp.status === 'available' ? 1 : 0,
        publishedAt,
        publishedAt,
        bp.status,
        runId,
        discoveredAt,
        downloadedAt,
        bp.publisher,
        bp.developer,
        bp.year,
        JSON.stringify(bp.genres),
        JSON.stringify(bp.regions),
        JSON.stringify(bp.languages),
        JSON.stringify(bp.sources),
        coverAbsPath,
        JSON.stringify(screenshotAbsPaths),
        JSON.stringify(metadata),
        installedAt,
        bp.installedDevice ?? null,
      );

      const releaseId = Number(insertInfo.lastInsertRowid);
      if (bp.featured) {
        featuredItemId = releaseId;
        featuredItemTitle = bp.title;
      }

      const fileSpecs =
        bp.extraFiles && bp.extraFiles.length > 0
          ? bp.extraFiles
          : [
              {
                label: `${bp.title} (${bp.regions[0] || 'USA'})`,
                suffix: `(${bp.regions[0] || 'USA'}).zip`,
                role: bp.releaseTags[0] || 'Retail ROM',
                sizeMb: bp.sizeMb,
              },
            ];

      fileSpecs.forEach((fSpec, fIdx) => {
        const filename = `${bp.title} ${fSpec.suffix}`;
        const fileAbsPath = path.join(releaseDir, filename);
        const fileBytes = Math.round(fSpec.sizeMb * 1024 * 1024);

        if (bp.status === 'downloaded') {
          const romInsideZip = `${bp.title} (${bp.regions[0] || 'USA'})${theme.extension}`;
          fs.writeFileSync(
            fileAbsPath,
            createMinimalValidZipBuffer(romInsideZip, `RetroGameTalk Sync Demo Archive: ${bp.title}`),
          );
        }

        insertFileStmt.run(
          releaseId,
          `${remoteUrl}download/${fIdx + 1}/`,
          `${remoteUrl}download/${fIdx + 1}/`,
          `${remotePath}${filename}`,
          fileAbsPath,
          filename,
          fSpec.label,
          fSpec.role,
          fileBytes,
          bp.status === 'downloaded' ? 'downloaded' : 'available',
          runId,
          discoveredAt,
          downloadedAt,
        );
      });
    });

    // Seed crisp recent activity logs for the Sync Overview Activity Log panel
    const demoLogs: { level: string; message: string; detail: string | null; minsAgo: number }[] = [
      {
        level: 'info',
        message: 'Incremental sync run initialized across 12 indexed consoles',
        detail: 'Chunked HTTP Range enabled (3 chunks >= 16 MiB) · Max workers: 2',
        minsAgo: 18,
      },
      {
        level: 'download',
        message: 'Mirrored Chrono Vanguard DX (En v2.4).zip (SNES)',
        detail: '4.2 MiB verified · Saved cover + 3 full-res screenshots locally',
        minsAgo: 14,
      },
      {
        level: 'download',
        message: 'Mirrored Aether Blade: Crimson Moon (PS1)',
        detail: '412.5 MiB via 3 parallel chunks · Avg throughput 18.4 MB/s',
        minsAgo: 9,
      },
      {
        level: 'info',
        message: 'Exported 3 verified ROMs to Analogue Pocket SD (SFC / GBA)',
        detail: 'FAT32 naming filter active · Auto-stripped .txt/.nfo clutter',
        minsAgo: 6,
      },
      {
        level: 'throttle',
        message: 'Adaptive AIMD pacer smoothed burst delay to 940 ms',
        detail: '0 retries required · Politeness guard nominal',
        minsAgo: 3,
      },
      {
        level: 'download',
        message: 'Streaming Starblade Zero 64 (60FPS Expansion Edition)',
        detail: 'Multi-chunk transfer active · Checksum verification queued',
        minsAgo: 1,
      },
    ];

    const insertLogStmt = db.prepare(`
      INSERT INTO activity_logs (run_id, level, message, detail, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const log of demoLogs) {
      insertLogStmt.run(
        latestRunId,
        log.level,
        log.message,
        log.detail,
        new Date(now.getTime() - log.minsAgo * 60 * 1000).toISOString(),
      );
    }

    // Seed realistic achievement counters & run silent baseline evaluation so header Trophy Case
    // displays an authentic Operator Rank without popping noisy toasts on load.
    recordAchievementCounter('sd_export_completed', 3, 'set', db);
    recordAchievementCounter('sd_export_roms', 12, 'set', db);
    recordAchievementCounter('crt_studio_tweaked', 4, 'set', db);
    recordAchievementCounter('catalog_grid_viewed', 1, 'set', db);
    recordAchievementCounter('detail_drawer_opened', 6, 'set', db);

    evaluateAchievements({ silent: true, db });
    db.prepare('UPDATE achievements_state SET seen = 1 WHERE unlocked_at IS NOT NULL').run();

    const unlockedRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM achievements_state WHERE unlocked_at IS NOT NULL')
      .get() as { cnt: number };

    // Flush WAL to main SQLite file before spawning the demo server process
    db.pragma('wal_checkpoint(TRUNCATE)');

    return {
      rootDir,
      dataDir,
      downloadDir,
      dbPath,
      schemaVersion: migrationReport.currentVersion,
      featuredItemId,
      featuredItemTitle,
      seededSystems: systemSlugs,
      seededReleases: DEMO_RELEASES.length,
      seededRuns: runIds.length,
      unlockedTrophies: Number(unlockedRow.cnt || 0),
    };
  } finally {
    db.close();
  }
}
