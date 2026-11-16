export type DevicePresetId = 'everdrive' | 'mister' | 'onion' | 'analogue' | 'ode' | 'custom';

export interface DevicePresetDefinition {
  id: DevicePresetId;
  name: string;
  description: string;
  folderMap: Record<string, string>;
  discSubfolderMode: 'per_game' | 'flat';
}

export const DEVICE_PRESETS: Record<DevicePresetId, DevicePresetDefinition> = {
  everdrive: {
    id: 'everdrive',
    name: 'EverDrive / FXPAK / Flash Cart',
    description: 'Clean top-level console folders (NES, SNES, GBA, GENESIS, N64, PCE)',
    discSubfolderMode: 'per_game',
    folderMap: {
      'nes-roms': 'NES',
      'fds-roms': 'FDS',
      'famicom_disk_system': 'FDS',
      'snes-roms': 'SNES',
      'snes-rom': 'SNES',
      'n64-roms': 'N64',
      'gb-roms': 'GB',
      'gameboy-roms': 'GB',
      'gbc-roms': 'GBC',
      'gameboy-color-roms': 'GBC',
      'gba-roms': 'GBA',
      'genesis-roms': 'GENESIS',
      'megadrive-roms': 'GENESIS',
      'sega_genesis_roms': 'GENESIS',
      'sega-cd-iso': 'MEGA-CD',
      'sega_cd_isos': 'MEGA-CD',
      '32x-roms': '32X',
      'sega_32x_roms': '32X',
      'sms-roms': 'SMS',
      'sms_roms': 'SMS',
      'gg-roms': 'GG',
      'game-gear': 'GG',
      'pc-engine-roms': 'PCE',
      'turbografx-16': 'PCE',
      'turbografx-16-roms': 'PCE',
      'pce-cd-iso': 'PCE-CD',
      'turbografx-cd': 'PCE-CD',
      'nds-roms': 'NDS',
      'ngp-roms': 'NGP',
      'neo-geo-pocket': 'NGP',
      'ws-roms': 'WS',
      'wonderswan': 'WS',
      'msx-roms': 'MSX',
      'atari-2600-roms': 'ATARI2600',
      'atari-7800-roms': 'ATARI7800',
    },
  },
  mister: {
    id: 'mister',
    name: 'MiSTer FPGA',
    description: 'Standard MiSTer /games/<Core> directory hierarchy',
    discSubfolderMode: 'per_game',
    folderMap: {
      'nes-roms': 'games/NES',
      'fds-roms': 'games/NES',
      'famicom_disk_system': 'games/NES',
      'snes-roms': 'games/SNES',
      'snes-rom': 'games/SNES',
      'n64-roms': 'games/N64',
      'gb-roms': 'games/GAMEBOY',
      'gameboy-roms': 'games/GAMEBOY',
      'gbc-roms': 'games/GAMEBOY2P',
      'gameboy-color-roms': 'games/GAMEBOY2P',
      'gba-roms': 'games/GBA',
      'genesis-roms': 'games/Genesis',
      'sega_genesis_roms': 'games/Genesis',
      'sega-cd-iso': 'games/MegaCD',
      'sega_cd_isos': 'games/MegaCD',
      '32x-roms': 'games/S32X',
      'sega_32x_roms': 'games/S32X',
      'sms-roms': 'games/SMS',
      'sms_roms': 'games/SMS',
      'gg-roms': 'games/SMS',
      'game-gear': 'games/SMS',
      'pc-engine-roms': 'games/TGFX16',
      'turbografx-16': 'games/TGFX16',
      'pce-cd-iso': 'games/TGFX16-CD',
      'turbografx-cd': 'games/TGFX16-CD',
      'psx-iso': 'games/PSX',
      'ps1-iso': 'games/PSX',
      'saturn-iso': 'games/Saturn',
      'sega_saturn_isos': 'games/Saturn',
      'neogeo-roms': 'games/NeoGeo',
      'neo-geo-cd': 'games/NeoGeo',
      'wonderswan': 'games/WonderSwan',
      'msx-roms': 'games/MSX',
    },
  },
  onion: {
    id: 'onion',
    name: 'OnionOS / Miyoo / Handhelds',
    description: 'Standard handheld Roms/<SHORT> layout (FC, SFC, GBA, MD, PS)',
    discSubfolderMode: 'per_game',
    folderMap: {
      'nes-roms': 'Roms/FC',
      'fds-roms': 'Roms/FDS',
      'famicom_disk_system': 'Roms/FDS',
      'snes-roms': 'Roms/SFC',
      'snes-rom': 'Roms/SFC',
      'gb-roms': 'Roms/GB',
      'gameboy-roms': 'Roms/GB',
      'gbc-roms': 'Roms/GBC',
      'gameboy-color-roms': 'Roms/GBC',
      'gba-roms': 'Roms/GBA',
      'genesis-roms': 'Roms/MD',
      'sega_genesis_roms': 'Roms/MD',
      'sega-cd-iso': 'Roms/SEGACD',
      'sega_cd_isos': 'Roms/SEGACD',
      '32x-roms': 'Roms/THIRTYTWOX',
      'sega_32x_roms': 'Roms/THIRTYTWOX',
      'sms-roms': 'Roms/MS',
      'sms_roms': 'Roms/MS',
      'gg-roms': 'Roms/GG',
      'game-gear': 'Roms/GG',
      'pc-engine-roms': 'Roms/PCE',
      'turbografx-16': 'Roms/PCE',
      'pce-cd-iso': 'Roms/PCECD',
      'turbografx-cd': 'Roms/PCECD',
      'psx-iso': 'Roms/PS',
      'ps1-iso': 'Roms/PS',
      'nds-roms': 'Roms/NDS',
      'ngp-roms': 'Roms/NGP',
      'neo-geo-pocket': 'Roms/NGP',
      'neo-geo-cd': 'Roms/NEOCD',
      'ws-roms': 'Roms/WS',
      'wonderswan': 'Roms/WS',
      'msx-roms': 'Roms/MSX',
    },
  },
  analogue: {
    id: 'analogue',
    name: 'Analogue Pocket (openFPGA)',
    description: 'Maps to Assets/<core>/common folders on Pocket SD cards',
    discSubfolderMode: 'per_game',
    folderMap: {
      'nes-roms': 'Assets/nes/common',
      'snes-roms': 'Assets/snes/common',
      'snes-rom': 'Assets/snes/common',
      'gb-roms': 'Assets/gb/common',
      'gameboy-roms': 'Assets/gb/common',
      'gbc-roms': 'Assets/gbc/common',
      'gameboy-color-roms': 'Assets/gbc/common',
      'gba-roms': 'Assets/gba/common',
      'genesis-roms': 'Assets/genesis/common',
      'sega_genesis_roms': 'Assets/genesis/common',
      'sms-roms': 'Assets/sms/common',
      'sms_roms': 'Assets/sms/common',
      'gg-roms': 'Assets/gg/common',
      'game-gear': 'Assets/gg/common',
      'pc-engine-roms': 'Assets/pce/common',
      'turbografx-16': 'Assets/pce/common',
      'pce-cd-iso': 'Assets/pcecd/common',
      'turbografx-cd': 'Assets/pcecd/common',
      'neogeo-roms': 'Assets/ng/common',
      'wonderswan': 'Assets/wonderswan/common',
    },
  },
  ode: {
    id: 'ode',
    name: 'Optical Disc Emulator (ODE)',
    description: 'Dedicated ODE folders with automatic per-game BIN/CUE & GDI subfolders',
    discSubfolderMode: 'per_game',
    folderMap: {
      'saturn-iso': 'SATURN',
      'sega_saturn_isos': 'SATURN',
      'dreamcast-iso': 'DREAMCAST',
      'dc-iso': 'DREAMCAST',
      'psx-iso': 'PSX',
      'ps1-iso': 'PSX',
      'sega-cd-iso': 'SEGACD',
      'sega_cd_isos': 'SEGACD',
      'pce-cd-iso': 'PCECD',
      'turbografx-cd': 'PCECD',
      'neo-geo-cd': 'NEOCD',
      'gamecube-iso': 'games',
      'gamecube': 'games',
      'wii-iso': 'wbfs',
      '3do-iso': '3DO',
      'pc-fx': 'PCFX',
    },
  },
  custom: {
    id: 'custom',
    name: 'Custom Folder Mapping',
    description: 'Use your own per-system folder paths relative to the mounted storage root',
    discSubfolderMode: 'per_game',
    folderMap: {},
  },
};

export function resolveSystemFolderForDevice(
  systemName: string,
  presetId: string,
  customMap: Record<string, string> = {},
): string {
  const key = systemName.trim().toLowerCase();
  if (customMap[key] !== undefined && customMap[key].trim() !== '') {
    return customMap[key].trim().replace(/^\/+|\/+$/g, '');
  }
  if (customMap[systemName] !== undefined && customMap[systemName].trim() !== '') {
    return customMap[systemName].trim().replace(/^\/+|\/+$/g, '');
  }

  const preset = DEVICE_PRESETS[(presetId as DevicePresetId) || 'everdrive'] || DEVICE_PRESETS.everdrive;
  if (preset.folderMap[key]) {
    return preset.folderMap[key];
  }

  // Sensible fallback: "snes-rom" -> "SNES", "dreamcast-iso" -> "DREAMCAST"
  const fallback = systemName
    .replace(/[-_](?:roms?|isos?|games|files)$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .toUpperCase();
  return fallback || 'ROMS';
}
