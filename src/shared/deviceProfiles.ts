import {
  normalizeStorageFolderConfig,
  type StorageFolderMappingConfig,
} from './storageFolderMappings.ts';
import type {
  DeviceColorKey,
  DeviceIconKey,
  DeviceRomNamingOverrides,
  ReleaseDeviceInstallRecord,
  RepositoryItemRecord,
  StorageDeviceProfile,
} from '../types.ts';

export const DEVICE_MARKER_FILENAME = '.rgt-device.json';
export const DEVICE_MARKER_SCHEMA_VERSION = 1;
export const DEVICE_MARKER_MAX_BYTES = 4096;

export const DEVICE_ICON_KEYS: readonly DeviceIconKey[] = [
  'handheld',
  'vertical',
  'clamshell',
  'sdcard',
  'console',
  'desktop',
  'drive',
] as const;

export const DEVICE_COLOR_KEYS: readonly DeviceColorKey[] = [
  'phosphor',
  'amber',
  'cyan',
  'crimson',
  'violet',
  'slate',
] as const;

const DEVICE_ICON_SET = new Set<string>(DEVICE_ICON_KEYS);
const DEVICE_COLOR_SET = new Set<string>(DEVICE_COLOR_KEYS);

export interface DeviceMarkerPayload {
  schemaVersion: 1;
  deviceId: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DeviceUninstallTargetRecord {
  id: number;
  title: string;
  systemName: string;
  releaseTags: string[];
  installedFilename: string | null;
  fallbackFilename: string | null;
  installedPaths: string[];
}

export function sanitizeDeviceIconKey(raw: unknown, fallback: DeviceIconKey = 'handheld'): DeviceIconKey {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().toLowerCase();
  return DEVICE_ICON_SET.has(trimmed) ? (trimmed as DeviceIconKey) : fallback;
}

export function sanitizeDeviceColorKey(raw: unknown, fallback: DeviceColorKey = 'phosphor'): DeviceColorKey {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().toLowerCase();
  return DEVICE_COLOR_SET.has(trimmed) ? (trimmed as DeviceColorKey) : fallback;
}

export function sanitizeIsoTimestamp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 48) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Generates a globally unique, URL-safe hardware-pinned device profile ID (`dev_<uuid>`).
 */
export function generateUuidDeviceProfileId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') {
    return `dev_${g.crypto.randomUUID().toLowerCase()}`;
  }
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `dev_${Date.now().toString(36)}_${rand()}${rand()}`;
}

/**
 * Suggests a sensible default form-factor icon based on volume label or detected firmware layout.
 */
export function guessDefaultDeviceIcon(
  volumeLabel: string,
  detectedLayoutLabel?: string | null,
): DeviceIconKey {
  const haystack = `${volumeLabel || ''} ${detectedLayoutLabel || ''}`
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  if (/\b(miyoo|pocket|analogue|game\s?boy|gb|gbc|trimui\s*brick|rg35xx\s*plus|rg40xxv|vertical)\b/.test(haystack)) {
    return 'vertical';
  }
  if (/\b(3ds|nds|ds|flip|sp|clamshell|rg35xxsp|retroid\s*flip|gba\s*sp)\b/.test(haystack)) {
    return 'clamshell';
  }
  if (/\b(mister|fpga|retropie|batocera|recalbox|emuelec|kodi|console|shield|apple\s*tv|pi\b)\b/.test(haystack)) {
    return 'console';
  }
  if (/\b(everdrive|ez-?flash|flashcart|sdcard|sd\s*card|microsd|tf\s*card)\b/.test(haystack)) {
    return 'sdcard';
  }
  if (/\b(desktop|mac|linux|windows|pc|nas|server|home|documents|retroarch)\b/.test(haystack)) {
    return 'desktop';
  }
  if (/\b(deck|odin|retroid|anbernic|rg\d|amber|jelos|rocknix|arkos|muos|onion|handheld|psp|vita|switch|ally|legion|trimui|powkiddy|minui)\b/.test(haystack)) {
    return 'handheld';
  }
  return 'handheld';
}

const GENERIC_STORAGE_FOLDER_NAMES = new Set<string>([
  'roms',
  'rom',
  'games',
  'game',
  'emulation',
  'easyroms',
  'sdcard',
  'sd_card',
  'sd card',
  'sd-card',
  'sd',
  'microsd',
  'micro_sd',
  'micro sd',
  'tf1',
  'tf2',
  'tf1-int',
  'tf2-ext',
  'tf1_int',
  'tf2_ext',
  'no name',
  'noname',
  'no_name',
  'untitled',
  'removable',
  'removable disk',
  'usb',
  'usb drive',
  'flash',
  'storage',
  'storage device',
  'external',
  'data',
  'media',
  'share',
  'files',
  'downloads',
  'retro',
  'retrogaming',
  'arcade',
  'console',
  'consoles',
  'systems',
  'library',
  'bios',
]);

/**
 * Returns true when a browser-reported directory handle name is a generic ROM folder,
 * unnamed FAT32 volume, or bare Windows drive letter rather than a meaningful device label.
 */
export function isGenericStorageFolderName(rawName: string | null | undefined): boolean {
  const trimmed = (rawName || '').trim();
  if (!trimmed) return true;
  // Bare drive letter or root slash (e.g., "E:", "E:\\", "/")
  if (/^[a-zA-Z]:?[\\/]?$/.test(trimmed) || trimmed === '/') {
    return true;
  }
  const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
  return GENERIC_STORAGE_FOLDER_NAMES.has(normalized);
}

const MUOS_DEVICE_DISPLAY_MAP: Record<string, string> = {
  'rg35xx-sp': 'Anbernic RG35XX SP',
  'rg35xxsp': 'Anbernic RG35XX SP',
  'rg35xx-h': 'Anbernic RG35XX H',
  'rg35xxh': 'Anbernic RG35XX H',
  'rg35xx-plus': 'Anbernic RG35XX Plus',
  'rg35xxplus': 'Anbernic RG35XX Plus',
  'rg35xx-2024': 'Anbernic RG35XX (2024)',
  'rg35xx2024': 'Anbernic RG35XX (2024)',
  'rg40xx-v': 'Anbernic RG40XX V',
  'rg40xxv': 'Anbernic RG40XX V',
  'rg40xx-h': 'Anbernic RG40XX H',
  'rg40xxh': 'Anbernic RG40XX H',
  'rg28xx': 'Anbernic RG28XX',
  'rgcube-xx': 'Anbernic RG CubeXX',
  'rgcubexx': 'Anbernic RG CubeXX',
  'rg34xx': 'Anbernic RG34XX',
  'rg34xx-sp': 'Anbernic RG34XX SP',
  'trimui-brick': 'Trimui Brick',
  'trimui-smart-pro': 'Trimui Smart Pro',
  'tui-brick': 'Trimui Brick',
  'tui-spoon': 'Trimui Smart Pro',
  'rgb30': 'Powkiddy RGB30',
};

export function formatMuosDeviceId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const firstLine = raw.split(/\r?\n/)[0]?.trim() || '';
  if (!firstLine || firstLine.length > 64) return null;
  const key = firstLine.toLowerCase().replace(/\s+/g, '-');
  if (MUOS_DEVICE_DISPLAY_MAP[key]) {
    return MUOS_DEVICE_DISPLAY_MAP[key];
  }
  const cleaned = firstLine.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || isGenericStorageFolderName(cleaned)) return null;
  return cleaned
    .split(' ')
    .map((part) => (/^(rg\d|rp\d|gba|nds|3ds|psp|psv|gb|gbc|sfc|nes|snes|n64)$/i.test(part)
      ? part.toUpperCase()
      : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
    .slice(0, 80);
}

/**
 * Extracts a custom Windows/FAT32 `label=...` entry from an `autorun.inf` file if present.
 */
export function parseAutorunInfLabel(rawText: string | null | undefined): string | null {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    const match = /^label\s*=\s*(.+)$/i.exec(trimmed);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, '').trim();
    if (value && !isGenericStorageFolderName(value)) {
      return value.slice(0, 80);
    }
  }
  return null;
}

const DEFAULT_FIRMWARE_HOSTNAMES = new Set([
  'batocera',
  'recalbox',
  'knulli',
  'rocknix',
  'jelos',
  'amberelec',
  'arkos',
  'localhost',
  'retropie',
]);

/**
 * Extracts a custom `system.hostname=...` value from `batocera.conf` / `recalbox.conf`.
 */
export function parseHostnameFromConf(rawText: string | null | undefined): string | null {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const match = /^system\.hostname\s*=\s*(.+)$/i.exec(trimmed);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, '').trim();
    if (
      value &&
      !DEFAULT_FIRMWARE_HOSTNAMES.has(value.toLowerCase()) &&
      !isGenericStorageFolderName(value)
    ) {
      return value.slice(0, 80);
    }
  }
  return null;
}

export interface DeviceIdentityProbeHints {
  /** Explicit device/volume label read from on-card metadata (autorun.inf, muOS device.txt, hostname). */
  explicitLabel: string | null;
  /** Human-friendly source for explicitLabel (e.g. "autorun.inf", "muOS device config"). */
  explicitLabelSource: string | null;
  /** Detected firmware or hardware ecosystem signature (e.g. "Miyoo Mini (OnionOS)", "Analogue Pocket"). */
  firmwareLabel: string | null;
}

export interface ResolvedSuggestedDeviceIdentity {
  suggestedName: string;
  detectedHintLabel: string | null;
  detectedHintSource: string | null;
  isGenericFolderName: boolean;
  suggestedIconKey: DeviceIconKey;
}

/**
 * Resolves the best default device name and form-factor icon when mounting an unrecognized folder:
 * 1. Explicit device/volume label from card metadata (`autorun.inf`, muOS `device.txt`, custom hostname)
 * 2. Non-generic mounted volume/folder label (e.g., `/Volumes/MIYOO_MINI` -> `MIYOO_MINI`)
 * 3. Detected firmware/hardware layout signature (e.g., `Miyoo Mini (OnionOS)`, `Analogue Pocket`)
 * 4. Empty string when only a generic folder name (`Roms`, `SDCARD`, `E:`) was exposed so the user
 *    can immediately type their device label without erasing `"Roms"`.
 */
export function resolveSuggestedDeviceIdentity(input: {
  volumeLabel: string;
  probeHints?: DeviceIdentityProbeHints | null;
}): ResolvedSuggestedDeviceIdentity {
  const volumeLabel = (input.volumeLabel || '').trim();
  const isGenericFolderName = isGenericStorageFolderName(volumeLabel);
  const explicitLabel = input.probeHints?.explicitLabel?.trim() || null;
  const firmwareLabel = input.probeHints?.firmwareLabel?.trim() || null;

  let suggestedName = '';
  let detectedHintLabel: string | null = null;
  let detectedHintSource: string | null = null;

  if (explicitLabel) {
    suggestedName = explicitLabel;
    detectedHintLabel = explicitLabel;
    detectedHintSource = input.probeHints?.explicitLabelSource || 'card metadata';
  } else if (!isGenericFolderName) {
    suggestedName = volumeLabel;
    if (firmwareLabel) {
      detectedHintLabel = firmwareLabel;
      detectedHintSource = 'detected layout';
    }
  } else if (firmwareLabel) {
    suggestedName = firmwareLabel;
    detectedHintLabel = firmwareLabel;
    detectedHintSource = 'detected layout';
  }

  const suggestedIconKey = guessDefaultDeviceIcon(
    suggestedName || volumeLabel,
    firmwareLabel || explicitLabel,
  );

  return {
    suggestedName,
    detectedHintLabel,
    detectedHintSource,
    isGenericFolderName,
    suggestedIconKey,
  };
}

/**
 * Parses and strictly validates an untrusted `.rgt-device.json` marker file read from removable media.
 * Rejects oversized payloads, non-objects, unknown schema versions, and unsafe device IDs.
 */
export function parseDeviceMarkerJson(rawText: string): DeviceMarkerPayload | null {
  if (typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  if (!trimmed || trimmed.length > DEVICE_MARKER_MAX_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== DEVICE_MARKER_SCHEMA_VERSION) {
    return null;
  }

  const deviceId = sanitizeDeviceProfileId(obj.deviceId);
  if (!deviceId) return null;

  const payload: DeviceMarkerPayload = {
    schemaVersion: DEVICE_MARKER_SCHEMA_VERSION,
    deviceId,
  };

  if (typeof obj.name === 'string' && obj.name.trim()) {
    payload.name = obj.name.trim().slice(0, 80);
  }
  const createdAt = sanitizeIsoTimestamp(obj.createdAt);
  if (createdAt) payload.createdAt = createdAt;
  const updatedAt = sanitizeIsoTimestamp(obj.updatedAt);
  if (updatedAt) payload.updatedAt = updatedAt;

  return payload;
}

/**
 * Serializes a clean, compact `.rgt-device.json` marker file for stamping at a mounted storage root.
 */
export function serializeDeviceMarkerJson(input: {
  deviceId: string;
  name?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}): string {
  const cleanId = sanitizeDeviceProfileId(input.deviceId);
  if (!cleanId) {
    throw new Error('Cannot serialize device marker with invalid deviceId');
  }
  const now = new Date().toISOString();
  const payload: DeviceMarkerPayload = {
    schemaVersion: DEVICE_MARKER_SCHEMA_VERSION,
    deviceId: cleanId,
    ...(input.name?.trim() ? { name: input.name.trim().slice(0, 80) } : {}),
    createdAt: sanitizeIsoTimestamp(input.createdAt) || now,
    updatedAt: sanitizeIsoTimestamp(input.updatedAt) || now,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * Sorts a fleet of saved storage device profiles predictably for 10+ device workflows:
 * Currently mounted first -> Non-archived before archived -> Pinned first -> Most recently mounted -> Name ASC.
 */
export function sortDeviceProfilesForFleet(
  profiles: readonly StorageDeviceProfile[],
  activeDeviceId?: string | null,
): StorageDeviceProfile[] {
  const activeId = (activeDeviceId || '').trim();
  return [...profiles].sort((a, b) => {
    const aMounted = activeId && a.id === activeId ? 1 : 0;
    const bMounted = activeId && b.id === activeId ? 1 : 0;
    if (aMounted !== bMounted) return bMounted - aMounted;

    const aArchived = a.isArchived ? 1 : 0;
    const bArchived = b.isArchived ? 1 : 0;
    if (aArchived !== bArchived) return aArchived - bArchived;

    const aPinned = a.isPinned ? 1 : 0;
    const bPinned = b.isPinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;

    const aRecent = a.lastMountedAt || a.updatedAt || a.createdAt || '';
    const bRecent = b.lastMountedAt || b.updatedAt || b.createdAt || '';
    const timeCmp = bRecent.localeCompare(aRecent);
    if (timeCmp !== 0) return timeCmp;

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/**
 * Generates a deterministic, URL-safe device profile ID from a volume label.
 * Keeps IDs readable and stable across backfills while rejecting unsafe characters.
 */
export function makeStableDeviceProfileId(volumeLabel: string): string {
  const slug = volumeLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `dev-${slug || 'storage'}`;
}

/**
 * Validates a user/client-supplied device profile ID to a strict safe charset.
 */
export function sanitizeDeviceProfileId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Normalizes a relative path stored for an installed ROM/folder on a mounted storage device.
 * Strictly blocks traversal segments (`..`, `.`), drive prefixes, backslashes, null bytes,
 * and the protected `.rgt-device.json` root marker file so uninstall operations can never
 * escape the mounted root or erase hardware device identity.
 */
export function sanitizeInstalledRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.replace(/\\/g, '/').trim();
  if (!normalized || normalized.includes('\0') || normalized.length > 512) return null;
  if (/^[a-zA-Z]:/.test(normalized)) return null;

  const segments = normalized
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || seg.includes('\0')) {
      return null;
    }
  }
  const joined = segments.join('/');
  if (joined.toLowerCase() === DEVICE_MARKER_FILENAME.toLowerCase()) {
    return null;
  }
  return joined;
}

export function sanitizeInstalledPathsList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const clean = sanitizeInstalledRelativePath(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= 64) break;
  }
  return result;
}

export function normalizeDeviceRomNaming(raw: unknown): DeviceRomNamingOverrides | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: DeviceRomNamingOverrides = {};
  let hasAny = false;

  if (typeof obj.romNamingTemplate === 'string' && obj.romNamingTemplate.trim()) {
    out.romNamingTemplate = obj.romNamingTemplate.trim().slice(0, 200);
    hasAny = true;
  }
  if (typeof obj.romSanitizeFat32 === 'boolean') {
    out.romSanitizeFat32 = obj.romSanitizeFat32;
    hasAny = true;
  }
  if (typeof obj.romMaxFilenameLen === 'number' && Number.isFinite(obj.romMaxFilenameLen)) {
    out.romMaxFilenameLen = Math.max(0, Math.min(255, Math.round(obj.romMaxFilenameLen)));
    hasAny = true;
  }

  return hasAny ? out : null;
}

/**
 * Merges a saved per-device folder config on top of the global config so each handheld profile
 * can maintain independent folder overrides without losing global defaults for untouched systems.
 */
export function mergeProfileFolderConfig(
  globalConfig: StorageFolderMappingConfig | null | undefined,
  profileConfig: StorageFolderMappingConfig | null | undefined,
): StorageFolderMappingConfig {
  const base = normalizeStorageFolderConfig(globalConfig);
  if (!profileConfig) return base;
  const override = normalizeStorageFolderConfig(profileConfig);
  return {
    typeSubfoldersEnabled: override.typeSubfoldersEnabled,
    globalTypeSubfolders: {
      ...base.globalTypeSubfolders,
      ...override.globalTypeSubfolders,
    },
    systemFolders: {
      ...base.systemFolders,
      ...override.systemFolders,
    },
    systemTypeOverrides: {
      ...base.systemTypeOverrides,
      ...override.systemTypeOverrides,
    },
  };
}

/**
 * Finds the per-device install record matching the currently mounted device (by profile ID first,
 * then falling back to case-insensitive volume/display name match).
 */
export function findItemInstallForDevice(
  item: Pick<
    RepositoryItemRecord,
    'deviceInstalls' | 'installedAt' | 'installedDeviceLabel' | 'installedFileId' | 'installedFilename'
  >,
  activeDeviceId: string | null | undefined,
  mountedDeviceName: string | null | undefined,
): ReleaseDeviceInstallRecord | null {
  const installs = item.deviceInstalls || [];
  const trimmedId = (activeDeviceId || '').trim();
  const trimmedName = (mountedDeviceName || '').trim().toLowerCase();

  if (trimmedId) {
    const byId = installs.find((inst) => inst.deviceId === trimmedId);
    if (byId) return byId;
  }

  if (trimmedName) {
    const byLabel = installs.find(
      (inst) =>
        inst.deviceName.trim().toLowerCase() === trimmedName ||
        inst.volumeLabel.trim().toLowerCase() === trimmedName,
    );
    if (byLabel) return byLabel;
  }

  // Legacy fallback when deviceInstalls isn't hydrated yet
  if (installs.length === 0 && item.installedAt && trimmedName) {
    const legacyLabel = (item.installedDeviceLabel || '').trim().toLowerCase();
    if (!legacyLabel || legacyLabel === trimmedName) {
      return {
        releaseId: 0,
        deviceId: trimmedId || makeStableDeviceProfileId(mountedDeviceName || 'storage'),
        deviceName: mountedDeviceName || item.installedDeviceLabel || 'Storage Device',
        volumeLabel: mountedDeviceName || item.installedDeviceLabel || 'Storage Device',
        installedAt: item.installedAt,
        installedFileId: item.installedFileId ?? null,
        installedFilename: item.installedFilename ?? null,
        installedPaths: [],
      };
    }
  }

  return null;
}

/**
 * Formats a concise human-readable badge summary for a game's installed devices.
 */
export function formatInstalledDevicesBadge(
  item: Pick<RepositoryItemRecord, 'deviceInstalls' | 'installedAt' | 'installedDeviceLabel'>,
): {
  label: string;
  tooltip: string;
  deviceNames: string[];
} | null {
  const installs = item.deviceInstalls || [];
  if (installs.length > 0) {
    const names = installs.map((d) => d.deviceName || d.volumeLabel);
    const label =
      names.length === 1
        ? `Installed · ${names[0]}`
        : `Installed · ${names[0]} +${names.length - 1}`;
    const tooltip = `Installed on ${names.join(', ')}`;
    return { label, tooltip, deviceNames: names };
  }
  if (item.installedAt) {
    const name = item.installedDeviceLabel?.trim() || null;
    return {
      label: name ? `Installed · ${name}` : 'Installed',
      tooltip: name ? `Installed to ${name}` : 'Installed to storage device',
      deviceNames: name ? [name] : [],
    };
  }
  return null;
}
