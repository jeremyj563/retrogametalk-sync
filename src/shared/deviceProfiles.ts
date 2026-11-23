import {
  normalizeStorageFolderConfig,
  type StorageFolderMappingConfig,
} from './storageFolderMappings.ts';
import type {
  DeviceRomNamingOverrides,
  ReleaseDeviceInstallRecord,
  RepositoryItemRecord,
} from '../types.ts';

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
 * Strictly blocks traversal segments (`..`, `.`), drive prefixes, backslashes, and null bytes
 * so uninstall operations can never escape or delete the mounted root directory.
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
  return segments.join('/');
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
