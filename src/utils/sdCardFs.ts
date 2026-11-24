import {
  buildUpgradeMatchStem,
  sanitizeFat32Filename,
  stripKnownFileExtension,
} from '../shared/romNaming';
import {
  DEVICE_MARKER_FILENAME,
  DEVICE_MARKER_MAX_BYTES,
  formatMuosDeviceId,
  parseAutorunInfLabel,
  parseDeviceMarkerJson,
  parseHostnameFromConf,
  sanitizeInstalledRelativePath,
  serializeDeviceMarkerJson,
  type DeviceIdentityProbeHints,
  type DeviceMarkerPayload,
} from '../shared/deviceProfiles';
import {
  IGNORED_SCAN_DIRECTORY_NAMES,
  type ScannedDirNode,
} from '../shared/storageAutoConfig';

export interface SdDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<SdDirectoryHandle | SdFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<SdDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<SdFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  isSameEntry?: (other: SdDirectoryHandle) => Promise<boolean>;
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
}

export interface SdFileWritableStream extends WritableStream<Uint8Array> {
  write(data: Uint8Array | ArrayBuffer | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface SdFileHandle {
  kind: 'file';
  name: string;
  createWritable(options?: { keepExistingData?: boolean }): Promise<SdFileWritableStream>;
  getFile(): Promise<File>;
}

export interface SdScanFolderResult {
  exactNames: Set<string>;
  exactNamesLower: Map<string, string>;
  entries: { name: string; kind: 'file' | 'directory'; stemInfo: ReturnType<typeof buildUpgradeMatchStem> }[];
}

export interface ScanStorageTreeOptions {
  maxDepth?: number;
  maxDirectories?: number;
  maxSampleFilesPerDir?: number;
  signal?: AbortSignal;
  onProgress?: (progress: { directoriesScanned: number; currentPath: string }) => void;
}

export type FileSystemAccessSupportCode =
  | 'supported'
  | 'insecure_context'
  | 'unsupported_browser';

export interface FileSystemAccessSupportResult {
  supported: boolean;
  code: FileSystemAccessSupportCode;
  origin?: string;
  reason?: string;
}

export function evaluateFileSystemAccessSupport(env: {
  hasWindow: boolean;
  isSecureContext?: boolean;
  hasDirectoryPicker: boolean;
  origin?: string;
}): FileSystemAccessSupportResult {
  if (!env.hasWindow) {
    return {
      supported: false,
      code: 'unsupported_browser',
      reason: 'Browser environment required.',
    };
  }
  if (env.hasDirectoryPicker) {
    return {
      supported: true,
      code: 'supported',
      origin: env.origin,
    };
  }
  if (env.isSecureContext === false) {
    const originHint = env.origin && env.origin !== 'null' ? env.origin : 'this URL';
    return {
      supported: false,
      code: 'insecure_context',
      origin: env.origin,
      reason: `Chrome hides direct folder access on plain HTTP (${originHint}). Serve over HTTPS or add ${originHint} to chrome://flags/#unsafely-treat-insecure-origin-as-secure and relaunch.`,
    };
  }
  return {
    supported: false,
    code: 'unsupported_browser',
    origin: env.origin,
    reason:
      'Direct storage device folder access requires Chrome, Edge, or another Chromium browser. Use Prepared ROM download in Firefox/Safari.',
  };
}

export function isFileSystemAccessSupported(): FileSystemAccessSupportResult {
  if (typeof window === 'undefined') {
    return evaluateFileSystemAccessSupport({
      hasWindow: false,
      hasDirectoryPicker: false,
    });
  }
  const win = window as unknown as {
    showDirectoryPicker?: unknown;
    isSecureContext?: boolean;
    location?: { origin?: string };
  };
  return evaluateFileSystemAccessSupport({
    hasWindow: true,
    isSecureContext: win.isSecureContext,
    hasDirectoryPicker: typeof win.showDirectoryPicker === 'function',
    origin: win.location?.origin,
  });
}

export async function pickSdCardRootDirectory(): Promise<SdDirectoryHandle> {
  const win = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<SdDirectoryHandle>;
  };
  if (typeof win.showDirectoryPicker !== 'function') {
    throw new Error('This browser does not support File System Access API (showDirectoryPicker).');
  }
  return win.showDirectoryPicker({ mode: 'readwrite', id: 'rgt-sync-sd-card' });
}

function isNotFoundError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'NotFoundError') return true;
  const errName = (err as { name?: string } | null)?.name;
  return errName === 'NotFoundError';
}

export async function resolveOrCreateSubdirectory(
  rootHandle: SdDirectoryHandle,
  relativePath: string,
  create: boolean,
  onDebug?: (message: string, detail?: string) => void,
): Promise<SdDirectoryHandle | null> {
  const segments = relativePath
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..');

  let current = rootHandle;
  for (const seg of segments) {
    try {
      current = await current.getDirectoryHandle(seg, { create });
    } catch (err) {
      if (!create && isNotFoundError(err)) {
        // Case-insensitive directory lookup fallback for case-sensitive mounts (e.g. Linux / FAT casing variance)
        const segLower = seg.toLowerCase();
        let matchedDir: SdDirectoryHandle | null = null;
        try {
          for await (const entry of current.values()) {
            if (entry.kind === 'directory' && entry.name.toLowerCase() === segLower) {
              matchedDir = entry;
              break;
            }
          }
        } catch {
          matchedDir = null;
        }
        if (matchedDir) {
          current = matchedDir;
          continue;
        }
      }
      const detail =
        err instanceof DOMException
          ? `${err.name}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      onDebug?.(
        `Failed ${create ? 'creating' : 'resolving'} subdirectory segment "${seg}" under "${relativePath}"`,
        detail,
      );
      return null;
    }
  }
  return current;
}

export async function scanTargetFolder(
  rootHandle: SdDirectoryHandle,
  relativeFolder: string,
): Promise<SdScanFolderResult> {
  const exactNames = new Set<string>();
  const exactNamesLower = new Map<string, string>();
  const entries: SdScanFolderResult['entries'] = [];

  const dir = await resolveOrCreateSubdirectory(rootHandle, relativeFolder, false);
  if (!dir) {
    return { exactNames, exactNamesLower, entries };
  }

  for await (const entry of dir.values()) {
    if (entry.name.trim().toLowerCase() === DEVICE_MARKER_FILENAME.toLowerCase()) {
      continue;
    }
    exactNames.add(entry.name);
    exactNamesLower.set(entry.name.toLowerCase(), entry.name);
    entries.push({
      name: entry.name,
      kind: entry.kind,
      stemInfo: buildUpgradeMatchStem(entry.name),
    });
  }

  return { exactNames, exactNamesLower, entries };
}

export interface ReadDeviceMarkerResult {
  found: boolean;
  marker: DeviceMarkerPayload | null;
  reason?: 'not_found' | 'oversized' | 'invalid' | 'error';
  error?: string;
}

/**
 * Reads and strictly validates `.rgt-device.json` from the root of a mounted storage handle.
 * Enforces a hard 4 KB file size cap and returns a clean structured result without throwing.
 */
export async function readDeviceMarkerFromSdCard(
  rootHandle: SdDirectoryHandle,
): Promise<ReadDeviceMarkerResult> {
  try {
    const fileHandle = await rootHandle.getFileHandle(DEVICE_MARKER_FILENAME, { create: false });
    const file = await fileHandle.getFile();
    if (typeof file.size === 'number' && file.size > DEVICE_MARKER_MAX_BYTES) {
      return {
        found: false,
        marker: null,
        reason: 'oversized',
        error: `${DEVICE_MARKER_FILENAME} exceeds ${DEVICE_MARKER_MAX_BYTES} byte safety limit`,
      };
    }
    const text =
      typeof file.text === 'function'
        ? await file.text()
        : await new Response(file).text();
    const marker = parseDeviceMarkerJson(text);
    if (!marker) {
      return {
        found: false,
        marker: null,
        reason: 'invalid',
        error: `${DEVICE_MARKER_FILENAME} is malformed or unsupported`,
      };
    }
    return { found: true, marker };
  } catch (err) {
    const errName = (err as { name?: string } | null)?.name;
    if ((err instanceof DOMException && err.name === 'NotFoundError') || errName === 'NotFoundError') {
      return { found: false, marker: null, reason: 'not_found' };
    }
    return {
      found: false,
      marker: null,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface WriteDeviceMarkerResult {
  ok: boolean;
  readOnly: boolean;
  updatedAt: string | null;
  error?: string;
}

/**
 * Writes or updates the hidden `.rgt-device.json` marker at the mounted storage root.
 * Degrades gracefully on read-only media or denied write permission without failing the mount.
 */
export async function writeDeviceMarkerToSdCard(
  rootHandle: SdDirectoryHandle,
  payload: {
    deviceId: string;
    name?: string | null;
    createdAt?: string | null;
  },
): Promise<WriteDeviceMarkerResult> {
  const updatedAt = new Date().toISOString();
  let serialized: string;
  try {
    serialized = serializeDeviceMarkerJson({
      deviceId: payload.deviceId,
      name: payload.name,
      createdAt: payload.createdAt,
      updatedAt,
    });
  } catch (err) {
    return {
      ok: false,
      readOnly: false,
      updatedAt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let writable: SdFileWritableStream | null = null;
  try {
    const fileHandle = await rootHandle.getFileHandle(DEVICE_MARKER_FILENAME, { create: true });
    writable = await fileHandle.createWritable({ keepExistingData: false });
    await writable.write(serialized);
    await writable.close();
    return { ok: true, readOnly: false, updatedAt };
  } catch (err) {
    if (writable) {
      try {
        await writable.abort();
      } catch {
        // Ignore secondary abort failure
      }
    }
    const errName = (err as { name?: string } | null)?.name || '';
    const msg = err instanceof Error ? err.message : String(err);
    const readOnly =
      errName === 'NotAllowedError' ||
      errName === 'NoModificationAllowedError' ||
      errName === 'SecurityError' ||
      /read[- ]?only|permission|denied|not allowed/i.test(msg);
    return {
      ok: false,
      readOnly,
      updatedAt: null,
      error: msg,
    };
  }
}

const PROBE_TEXT_MAX_BYTES = 16 * 1024;

async function readSmallTextFileFromSdCard(
  rootHandle: SdDirectoryHandle,
  relativePath: string,
): Promise<string | null> {
  try {
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    let dir = rootHandle;
    for (let i = 0; i < segments.length - 1; i += 1) {
      dir = await dir.getDirectoryHandle(segments[i], { create: false });
    }
    const fileHandle = await dir.getFileHandle(segments[segments.length - 1], { create: false });
    const file = await fileHandle.getFile();
    if (typeof file.size === 'number' && file.size > PROBE_TEXT_MAX_BYTES) {
      return null;
    }
    return typeof file.text === 'function' ? await file.text() : await new Response(file).text();
  } catch {
    return null;
  }
}

/**
 * Performs a fast, bounded root-level probe of a mounted storage handle to discover
 * device/volume labels (e.g. `autorun.inf` label, muOS `device.txt`, custom Batocera/Recalbox
 * hostnames) and well-known handheld/FPGA/flashcart firmware signatures.
 * Never scans deep ROM trees and never throws.
 */
export async function probeDeviceIdentityHintsFromSdCard(
  rootHandle: SdDirectoryHandle,
): Promise<DeviceIdentityProbeHints> {
  const rootDirs = new Map<string, string>();
  const rootFiles = new Map<string, string>();

  try {
    let seen = 0;
    for await (const entry of rootHandle.values()) {
      const lower = entry.name.trim().toLowerCase();
      if (entry.kind === 'directory') {
        rootDirs.set(lower, entry.name);
      } else {
        rootFiles.set(lower, entry.name);
      }
      seen += 1;
      if (seen >= 200) break;
    }
  } catch {
    return { explicitLabel: null, explicitLabelSource: null, firmwareLabel: null };
  }

  let explicitLabel: string | null = null;
  let explicitLabelSource: string | null = null;
  let firmwareLabel: string | null = null;

  // 1. Check Windows/FAT32 `autorun.inf` explicit volume label
  const autorunName = rootFiles.get('autorun.inf');
  if (autorunName) {
    const text = await readSmallTextFileFromSdCard(rootHandle, autorunName);
    const label = parseAutorunInfLabel(text);
    if (label) {
      explicitLabel = label;
      explicitLabelSource = 'autorun.inf';
    }
  }

  // 2. Check muOS device model identifier (`MUOS/info/config/device.txt` or `MUOS/info/device.txt`)
  const muosDir = rootDirs.get('muos');
  if (muosDir) {
    firmwareLabel = 'muOS Handheld';
    if (!explicitLabel) {
      const deviceTxt =
        (await readSmallTextFileFromSdCard(rootHandle, `${muosDir}/info/config/device.txt`)) ||
        (await readSmallTextFileFromSdCard(rootHandle, `${muosDir}/info/device.txt`));
      const formatted = formatMuosDeviceId(deviceTxt);
      if (formatted) {
        explicitLabel = formatted;
        explicitLabelSource = 'muOS device config';
      }
    }
  }

  // 3. Check Batocera / KNULLI / Recalbox hostname config
  const confCandidates: { path: string; defaultFirmware: string }[] = [];
  if (rootFiles.has('batocera.conf')) {
    confCandidates.push({ path: rootFiles.get('batocera.conf')!, defaultFirmware: 'Batocera / KNULLI' });
  }
  if (rootFiles.has('recalbox.conf')) {
    confCandidates.push({ path: rootFiles.get('recalbox.conf')!, defaultFirmware: 'Recalbox' });
  }
  const systemDir = rootDirs.get('system');
  if (systemDir) {
    confCandidates.push({ path: `${systemDir}/batocera.conf`, defaultFirmware: 'Batocera / KNULLI' });
    confCandidates.push({ path: `${systemDir}/recalbox.conf`, defaultFirmware: 'Recalbox' });
  }
  for (const cand of confCandidates) {
    const confText = await readSmallTextFileFromSdCard(rootHandle, cand.path);
    if (!confText) continue;
    if (!firmwareLabel) firmwareLabel = cand.defaultFirmware;
    if (!explicitLabel) {
      const hostname = parseHostnameFromConf(confText);
      if (hostname) {
        explicitLabel = hostname;
        explicitLabelSource = cand.path.split('/').pop() || 'firmware config';
      }
    }
    break;
  }

  // 4. Well-known handheld, FPGA, and flashcart directory signatures
  if (!firmwareLabel) {
    const hasRoms = rootDirs.has('roms');
    if (rootDirs.has('.tmp_update') || (rootDirs.has('miyoo') && (hasRoms || rootDirs.has('emu')))) {
      firmwareLabel = 'Miyoo Mini (OnionOS)';
    } else if (rootDirs.has('cfw') && hasRoms) {
      firmwareLabel = 'RG35XX (GarlicOS)';
    } else if (rootDirs.has('platforms') && rootDirs.has('cores') && rootDirs.has('assets')) {
      firmwareLabel = 'Analogue Pocket';
    } else if (rootFiles.has('mister.ini') || (rootDirs.has('games') && rootDirs.has('_console'))) {
      firmwareLabel = 'MiSTer FPGA';
    } else if (rootDirs.has('sd2snes') || rootDirs.has('fxpak')) {
      firmwareLabel = 'FXPAK Pro / SD2SNES';
    } else if (rootDirs.has('edn8')) {
      firmwareLabel = 'EverDrive N8';
    } else if (rootDirs.has('edgb')) {
      firmwareLabel = 'EverDrive-GB';
    } else if (rootDirs.has('edgba')) {
      firmwareLabel = 'EverDrive-GBA';
    } else if (rootDirs.has('ed64')) {
      firmwareLabel = 'EverDrive-64';
    } else if (rootDirs.has('mega') || rootDirs.has('megasd')) {
      firmwareLabel = 'Mega EverDrive';
    } else if (rootFiles.has('minui.zip') || (rootDirs.has('.system') && hasRoms)) {
      firmwareLabel = 'MinUI Handheld';
    } else if (rootDirs.has('es-de') || rootDirs.has('emulation')) {
      firmwareLabel = 'ES-DE / EmuDeck';
    }
  }

  return { explicitLabel, explicitLabelSource, firmwareLabel };
}

function extractFileExtension(filename: string): string {
  const trimmed = filename.trim();
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === trimmed.length - 1) return '';
  return trimmed.slice(dotIdx + 1).toLowerCase();
}

/**
 * Walks a user-selected FileSystemDirectoryHandle in bounded breadth-first order to build
 * a lightweight directory tree snapshot for Export Device Auto-Configure.
 * Prunes hidden/OS/media/save folders and caps per-directory file sampling so large SD cards
 * finish quickly and remain responsive.
 */
export async function scanStorageDirectoryTree(
  rootHandle: SdDirectoryHandle,
  options: ScanStorageTreeOptions = {},
): Promise<ScannedDirNode[]> {
  const maxDepth = Math.max(1, options.maxDepth ?? 4);
  const maxDirectories = Math.max(20, options.maxDirectories ?? 600);
  const maxSampleFilesPerDir = Math.max(8, options.maxSampleFilesPerDir ?? 48);
  const { signal, onProgress } = options;

  const nodes: ScannedDirNode[] = [];
  const queue: Array<{
    handle: SdDirectoryHandle;
    relativePath: string;
    name: string;
    depth: number;
  }> = [{ handle: rootHandle, relativePath: '', name: rootHandle.name || 'Storage Device', depth: 0 }];

  let lastProgressAt = 0;

  while (queue.length > 0 && nodes.length < maxDirectories) {
    if (signal?.aborted) {
      throw new DOMException('Directory scan canceled by user.', 'AbortError');
    }

    const current = queue.shift()!;
    const childDirs: string[] = [];
    const childHandles: Array<{ name: string; handle: SdDirectoryHandle }> = [];
    const sampleExtensions: string[] = [];
    let fileCount = 0;

    try {
      for await (const entry of current.handle.values()) {
        if (signal?.aborted) {
          throw new DOMException('Directory scan canceled by user.', 'AbortError');
        }
        const entryName = entry.name.trim();
        if (!entryName || entryName.startsWith('.')) continue;

        if (entry.kind === 'directory') {
          childDirs.push(entryName);
          const lowerName = entryName.toLowerCase();
          if (current.depth < maxDepth && !IGNORED_SCAN_DIRECTORY_NAMES.has(lowerName)) {
            childHandles.push({ name: entryName, handle: entry });
          }
        } else if (entry.kind === 'file') {
          fileCount += 1;
          if (sampleExtensions.length < maxSampleFilesPerDir) {
            const ext = extractFileExtension(entryName);
            if (ext) sampleExtensions.push(ext);
          }
          // Generous safety cap against pathological directories while still scanning
          // all normal ROM collections completely so child subfolders are never missed
          if (fileCount >= 25000) {
            break;
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      // Skip unreadable subdirectories cleanly while continuing scan
    }

    nodes.push({
      relativePath: current.relativePath,
      name: current.name,
      depth: current.depth,
      childDirs,
      sampleExtensions,
      fileCount,
    });

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (onProgress && (nodes.length === 1 || now - lastProgressAt >= 80)) {
      lastProgressAt = now;
      onProgress({
        directoriesScanned: nodes.length,
        currentPath: current.relativePath || current.name,
      });
    }

    if (current.depth < maxDepth) {
      for (const child of childHandles) {
        if (nodes.length + queue.length >= maxDirectories) break;
        const childRelPath = current.relativePath
          ? `${current.relativePath}/${child.name}`
          : child.name;
        queue.push({
          handle: child.handle,
          relativePath: childRelPath,
          name: child.name,
          depth: current.depth + 1,
        });
      }
    }
  }

  onProgress?.({
    directoriesScanned: nodes.length,
    currentPath: '',
  });

  return nodes;
}

export function registerWrittenEntryInScan(
  scan: SdScanFolderResult,
  name: string,
  kind: 'file' | 'directory',
  removedOldName?: string | null,
): void {
  if (removedOldName) {
    unregisterEntryInScan(scan, removedOldName);
  }
  const lower = name.toLowerCase();
  if (!scan.exactNamesLower.has(lower)) {
    scan.exactNames.add(name);
    scan.exactNamesLower.set(lower, name);
    scan.entries.push({
      name,
      kind,
      stemInfo: buildUpgradeMatchStem(name),
    });
  }
}

export function unregisterEntryInScan(
  scan: SdScanFolderResult | undefined,
  name: string,
): void {
  if (!scan || !name) return;
  const lower = name.toLowerCase();
  const actual = scan.exactNamesLower.get(lower) ?? name;
  scan.exactNames.delete(actual);
  scan.exactNames.delete(name);
  scan.exactNamesLower.delete(lower);
  const idx = scan.entries.findIndex((e) => e.name.toLowerCase() === lower);
  if (idx >= 0) scan.entries.splice(idx, 1);
}

export interface SdRemovePathResult {
  status: 'removed' | 'not_found' | 'invalid' | 'error';
  path: string;
  error?: string;
}

/**
 * Safely deletes a single relative file or subfolder strictly inside the mounted storage root.
 * Never traverses upward (`..`), never touches root itself, and never accesses the local mirror.
 */
export async function removeRelativePathFromSdCard(
  rootHandle: SdDirectoryHandle,
  relativePath: string,
  onDebug?: (message: string, detail?: string) => void,
): Promise<SdRemovePathResult> {
  const clean = sanitizeInstalledRelativePath(relativePath);
  if (!clean) {
    return {
      status: 'invalid',
      path: relativePath,
      error: 'Refused to remove unsafe or empty relative path',
    };
  }

  const segments = clean.split('/');
  const leafName = segments[segments.length - 1];
  const parentRel = segments.slice(0, -1).join('/');

  let parentDir: SdDirectoryHandle | null = rootHandle;
  if (parentRel) {
    parentDir = await resolveOrCreateSubdirectory(rootHandle, parentRel, false, onDebug);
    if (!parentDir) {
      return { status: 'not_found', path: clean };
    }
  }

  try {
    await parentDir.removeEntry(leafName, { recursive: true });
    onDebug?.(`Removed "${clean}" from mounted device`);
    return { status: 'removed', path: clean };
  } catch (err) {
    if (isNotFoundError(err)) {
      // Case-insensitive leaf lookup fallback on case-sensitive filesystems
      const leafLower = leafName.toLowerCase();
      let actualEntryName: string | null = null;
      try {
        for await (const entry of parentDir.values()) {
          if (entry.name.toLowerCase() === leafLower) {
            actualEntryName = entry.name;
            break;
          }
        }
      } catch {
        actualEntryName = null;
      }
      if (actualEntryName && actualEntryName !== leafName) {
        try {
          await parentDir.removeEntry(actualEntryName, { recursive: true });
          const actualPath = parentRel ? `${parentRel}/${actualEntryName}` : actualEntryName;
          onDebug?.(`Removed "${actualPath}" (case-insensitive match for "${clean}") from mounted device`);
          return { status: 'removed', path: actualPath };
        } catch (retryErr) {
          if (isNotFoundError(retryErr)) {
            return { status: 'not_found', path: clean };
          }
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          onDebug?.(`Failed removing "${clean}" from mounted device`, retryMsg);
          return { status: 'error', path: clean, error: retryMsg };
        }
      }
      return { status: 'not_found', path: clean };
    }
    const msg = err instanceof Error ? err.message : String(err);
    onDebug?.(`Failed removing "${clean}" from mounted device`, msg);
    return { status: 'error', path: clean, error: msg };
  }
}

function normalizeLooseRomStem(value: string): string {
  return value
    .toLowerCase()
    .replace(/[:_\-\u2013\u2014.,!'"/\\()[\]&+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLeadingTitleCore(filename: string): string {
  const withoutExt = stripKnownFileExtension(filename.trim());
  const beforeDecorators = withoutExt.split(/[([\]]/)[0] || withoutExt;
  return normalizeLooseRomStem(beforeDecorators);
}

/**
 * Matches on-disk ROM entries inside a pre-scanned folder against one or more candidate names
 * (recorded filename, archive filename, FAT32-sanitized variants, and optional title fallback).
 * Uses strict priority tiers so unambiguous matches are found without risking collateral deletions.
 */
export function findMatchingRomEntriesInScan(
  scan: SdScanFolderResult,
  candidateNames: Array<string | null | undefined>,
  options?: { titleFallback?: string | null },
): string[] {
  if (!scan || scan.entries.length === 0) {
    return [];
  }

  const expandedCandidates: string[] = [];
  const seenCandidates = new Set<string>();
  const addCandidate = (raw: string | null | undefined) => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return;
    const variants = [
      trimmed,
      sanitizeFat32Filename(trimmed, 0, true),
      sanitizeFat32Filename(trimmed, 0, false),
    ];
    for (const variant of variants) {
      const clean = variant.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (!seenCandidates.has(key)) {
        seenCandidates.add(key);
        expandedCandidates.push(clean);
      }
    }
  };

  for (const name of candidateNames) {
    addCandidate(name);
  }

  // Tier 1: Case-insensitive exact filename match (raw or FAT32-sanitized)
  const tier1 = new Set<string>();
  for (const cand of expandedCandidates) {
    const exact = scan.exactNamesLower.get(cand.toLowerCase());
    if (exact) tier1.add(exact);
  }
  if (tier1.size > 0) {
    return Array.from(tier1);
  }

  // Tier 2: Case-insensitive exact base-name match ignoring known ROM/archive extension (.zip vs .sfc)
  const desiredBaseNames = new Set<string>();
  for (const cand of expandedCandidates) {
    const base = stripKnownFileExtension(cand).trim().toLowerCase();
    if (base) desiredBaseNames.add(base);
  }
  if (desiredBaseNames.size > 0) {
    const tier2 = new Set<string>();
    for (const entry of scan.entries) {
      const entryBase = stripKnownFileExtension(entry.name).trim().toLowerCase();
      if (entryBase && desiredBaseNames.has(entryBase)) {
        tier2.add(entry.name);
      }
    }
    if (tier2.size > 0) {
      return Array.from(tier2);
    }
  }

  // Tier 3: Structured upgrade stem + role match (with unique-match relaxation when candidate role is null)
  const desiredStems = expandedCandidates
    .map((cand) => buildUpgradeMatchStem(cand))
    .filter((info) => Boolean(info.stem));

  const tier3ExactRole = new Set<string>();
  for (const desired of desiredStems) {
    for (const entry of scan.entries) {
      if (entry.stemInfo.stem !== desired.stem) continue;
      if ((entry.stemInfo.role || null) !== (desired.role || null)) continue;
      tier3ExactRole.add(entry.name);
    }
  }
  if (tier3ExactRole.size > 0) {
    return Array.from(tier3ExactRole);
  }

  const tier3RoleAgnostic = new Set<string>();
  for (const desired of desiredStems) {
    if (desired.role !== null) continue;
    const matches = scan.entries.filter((entry) => entry.stemInfo.stem === desired.stem);
    if (matches.length === 1) {
      tier3RoleAgnostic.add(matches[0].name);
    }
  }
  if (tier3RoleAgnostic.size > 0) {
    return Array.from(tier3RoleAgnostic);
  }

  // Tier 4: Loose punctuation-normalized stem match (handles ":" -> " - ", "_" vs spaces, etc.)
  const tier4ExactRole = new Set<string>();
  const tier4RoleAgnostic = new Set<string>();
  for (const desired of desiredStems) {
    const desiredLoose = normalizeLooseRomStem(desired.stem);
    if (desiredLoose.length < 4) continue;
    const exactRoleMatches: string[] = [];
    const anyRoleMatches: string[] = [];
    for (const entry of scan.entries) {
      const entryLoose = normalizeLooseRomStem(entry.stemInfo.stem);
      if (entryLoose !== desiredLoose) continue;
      anyRoleMatches.push(entry.name);
      if ((entry.stemInfo.role || null) === (desired.role || null)) {
        exactRoleMatches.push(entry.name);
      }
    }
    for (const name of exactRoleMatches) {
      tier4ExactRole.add(name);
    }
    if (desired.role === null && anyRoleMatches.length === 1) {
      tier4RoleAgnostic.add(anyRoleMatches[0]);
    }
  }
  if (tier4ExactRole.size > 0) {
    return Array.from(tier4ExactRole);
  }
  if (tier4RoleAgnostic.size > 0) {
    return Array.from(tier4RoleAgnostic);
  }

  // Tier 5: Title-core unique match for legacy installs whose archive name differed from the templated ROM filename
  const cleanTitle = (options?.titleFallback || '').trim();
  if (cleanTitle) {
    const desiredTitleCore = extractLeadingTitleCore(sanitizeFat32Filename(cleanTitle, 0, false));
    if (desiredTitleCore.length >= 4) {
      const titleMatches = scan.entries.filter(
        (entry) => extractLeadingTitleCore(entry.name) === desiredTitleCore,
      );
      if (titleMatches.length === 1) {
        return [titleMatches[0].name];
      }
    }
  }

  return [];
}

/**
 * Fallback removal for legacy installs that predate `installedPaths` tracking or moved folders:
 * scans (or reuses a cached scan of) the resolved target folder and removes matching ROM(s).
 */
export async function removeStemFallbackFromSdCard(
  rootHandle: SdDirectoryHandle,
  folderRel: string,
  installedFilename: string | null | undefined,
  onDebug?: (message: string, detail?: string) => void,
  options?: {
    additionalCandidateNames?: Array<string | null | undefined>;
    titleFallback?: string | null;
    cachedScan?: SdScanFolderResult;
  },
): Promise<{ removedPaths: string[]; errors: string[]; scan?: SdScanFolderResult }> {
  const removedPaths: string[] = [];
  const errors: string[] = [];
  const cleanFolder = sanitizeInstalledRelativePath(folderRel);
  const candidates = [installedFilename, ...(options?.additionalCandidateNames || [])].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  if (!cleanFolder || (candidates.length === 0 && !(options?.titleFallback || '').trim())) {
    return { removedPaths, errors, scan: options?.cachedScan };
  }

  const scan = options?.cachedScan ?? (await scanTargetFolder(rootHandle, cleanFolder));
  const matchedNames = findMatchingRomEntriesInScan(scan, candidates, {
    titleFallback: options?.titleFallback,
  });

  for (const name of matchedNames) {
    const relPath = `${cleanFolder}/${name}`;
    const res = await removeRelativePathFromSdCard(rootHandle, relPath, onDebug);
    if (res.status === 'removed') {
      removedPaths.push(res.path);
      unregisterEntryInScan(scan, name);
      const removedLeaf = res.path.split('/').pop();
      if (removedLeaf && removedLeaf !== name) {
        unregisterEntryInScan(scan, removedLeaf);
      }
    } else if (res.status === 'error' && res.error) {
      errors.push(`${relPath}: ${res.error}`);
    }
  }

  return { removedPaths, errors, scan };
}

export function findUpgradeCandidateOnCard(
  targetName: string,
  scan: SdScanFolderResult | undefined,
): { exactMatch: boolean; olderEntryName: string | null } {
  if (!scan) {
    return { exactMatch: false, olderEntryName: null };
  }

  const lower = targetName.toLowerCase();
  if (scan.exactNamesLower.has(lower)) {
    return { exactMatch: true, olderEntryName: null };
  }

  const desired = buildUpgradeMatchStem(targetName);
  if (!desired.stem) {
    return { exactMatch: false, olderEntryName: null };
  }

  for (const existing of scan.entries) {
    if (existing.stemInfo.stem !== desired.stem) continue;
    // Match same role category (e.g., Hack vs Hack, T-En vs T-En) or both retail
    if ((existing.stemInfo.role || null) !== (desired.role || null)) continue;
    if (existing.name.toLowerCase() !== lower) {
      return { exactMatch: false, olderEntryName: existing.name };
    }
  }

  return { exactMatch: false, olderEntryName: null };
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

export type SdStreamStage = 'extracting' | 'writing' | 'finalizing';

export interface SdStreamProgressUpdate {
  bytesWritten: number;
  totalBytes: number | null;
  bytesPerSec: number | null;
}

export async function streamHttpPayloadToSdFile(
  url: string,
  dirHandle: SdDirectoryHandle,
  filename: string,
  options?: {
    signal?: AbortSignal;
    hadExistingFile?: boolean;
    expectedBytes?: number | null;
    onStage?: (stage: SdStreamStage) => void;
    onProgress?: (progress: SdStreamProgressUpdate) => void;
    onDebug?: (message: string, detail?: string) => void;
  },
): Promise<number> {
  const signal = options?.signal;
  const onDebug = options?.onDebug;
  const onStage = options?.onStage;
  const onProgress = options?.onProgress;
  if (signal?.aborted) {
    throw new DOMException('Installation canceled by user.', 'AbortError');
  }

  onDebug?.(`Extracting & streaming "${filename}"`, url);
  onStage?.('extracting');

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (fetchErr) {
    if (isAbortError(fetchErr)) throw fetchErr;
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    onDebug?.(`HTTP fetch error for "${filename}"`, `${msg} · ${url}`);
    throw new Error(`Network fetch failed for "${filename}": ${msg}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let cleanErr = errText;
    try {
      const parsed = JSON.parse(errText) as { error?: string };
      if (parsed?.error) cleanErr = parsed.error;
    } catch {
      // Keep raw text when not JSON
    }
    onDebug?.(`HTTP ${res.status} extracting "${filename}"`, cleanErr || url);
    throw new Error(cleanErr || `Extraction failed (HTTP ${res.status})`);
  }

  const rawContentLength = Number(res.headers.get('content-length'));
  const totalBytes =
    Number.isFinite(rawContentLength) && rawContentLength > 0
      ? rawContentLength
      : options?.expectedBytes && options.expectedBytes > 0
        ? options.expectedBytes
        : null;

  let existedBefore = Boolean(options?.hadExistingFile);
  if (!existedBefore) {
    try {
      await dirHandle.getFileHandle(filename, { create: false });
      existedBefore = true;
    } catch {
      existedBefore = false;
    }
  }

  let fileHandle: SdFileHandle;
  try {
    fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  } catch (handleErr) {
    const msg =
      handleErr instanceof DOMException
        ? `${handleErr.name}: ${handleErr.message}`
        : handleErr instanceof Error
          ? handleErr.message
          : String(handleErr);
    onDebug?.(`Failed opening destination file handle "${filename}"`, msg);
    throw new Error(`Cannot create file "${filename}" on device: ${msg}`);
  }

  let writable: SdFileWritableStream;
  try {
    writable = await fileHandle.createWritable({ keepExistingData: false });
  } catch (writableErr) {
    const msg =
      writableErr instanceof DOMException
        ? `${writableErr.name}: ${writableErr.message}`
        : writableErr instanceof Error
          ? writableErr.message
          : String(writableErr);
    onDebug?.(`Failed creating writable stream for "${filename}"`, msg);
    throw new Error(`Cannot open write stream for "${filename}": ${msg}`);
  }

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let written = 0;
  try {
    if (res.body) {
      const reader = res.body.getReader();
      let startedWritingAt = 0;
      let lastProgressAt = 0;
      let sampleWindowStartAt = 0;
      let sampleWindowStartBytes = 0;
      let smoothedSpeed: number | null = null;
      let reportedWritingStage = false;

      while (true) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => undefined);
          throw new DOMException('Installation canceled by user.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (signal?.aborted) {
            await reader.cancel().catch(() => undefined);
            throw new DOMException('Installation canceled by user.', 'AbortError');
          }
          const tNow = nowMs();
          if (!reportedWritingStage) {
            reportedWritingStage = true;
            startedWritingAt = tNow;
            sampleWindowStartAt = tNow;
            sampleWindowStartBytes = 0;
            onStage?.('writing');
          }
          await writable.write(value);
          written += value.byteLength;

          const afterWrite = nowMs();
          const shouldEmit = lastProgressAt === 0 || afterWrite - lastProgressAt >= 100;
          if (shouldEmit && onProgress) {
            lastProgressAt = afterWrite;
            const windowMs = afterWrite - sampleWindowStartAt;
            const totalElapsedMs = afterWrite - startedWritingAt;
            if (windowMs >= 250) {
              const instant = ((written - sampleWindowStartBytes) * 1000) / windowMs;
              smoothedSpeed =
                smoothedSpeed === null ? instant : smoothedSpeed * 0.55 + instant * 0.45;
              sampleWindowStartAt = afterWrite;
              sampleWindowStartBytes = written;
            } else if (smoothedSpeed === null && totalElapsedMs >= 100) {
              smoothedSpeed = (written * 1000) / totalElapsedMs;
            }
            onProgress({
              bytesWritten: written,
              totalBytes,
              bytesPerSec:
                smoothedSpeed !== null && Number.isFinite(smoothedSpeed) && smoothedSpeed > 0
                  ? Math.round(smoothedSpeed)
                  : null,
            });
          }
        }
      }
      onProgress?.({
        bytesWritten: written,
        totalBytes: totalBytes ?? written,
        bytesPerSec:
          smoothedSpeed !== null && Number.isFinite(smoothedSpeed) && smoothedSpeed > 0
            ? Math.round(smoothedSpeed)
            : null,
      });
      onStage?.('finalizing');
      await writable.close();
      onDebug?.(`Wrote "${filename}" (${written} bytes)`);
      return written;
    }

    onStage?.('writing');
    const buf = await res.arrayBuffer();
    if (signal?.aborted) {
      throw new DOMException('Installation canceled by user.', 'AbortError');
    }
    await writable.write(buf);
    written = buf.byteLength;
    onProgress?.({
      bytesWritten: written,
      totalBytes: totalBytes ?? written,
      bytesPerSec: null,
    });
    onStage?.('finalizing');
    await writable.close();
    onDebug?.(`Wrote "${filename}" (${written} bytes)`);
    return written;
  } catch (err) {
    if (!isAbortError(err)) {
      const msg =
        err instanceof DOMException
          ? `${err.name}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      onDebug?.(`Stream write error on "${filename}" after ${written} bytes`, msg);
    }
    try {
      if (typeof writable.abort === 'function') {
        await writable.abort();
      } else {
        await writable.close();
      }
    } catch {
      // Ignore secondary abort/close error
    }
    // Remove newly created 0-byte placeholder file if the transfer aborted or failed before closing
    if (!existedBefore) {
      try {
        await dirHandle.removeEntry(filename);
      } catch (cleanupErr) {
        onDebug?.(
          `Failed removing incomplete file "${filename}"`,
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        );
      }
    }
    throw err;
  }
}
