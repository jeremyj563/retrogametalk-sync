import { buildUpgradeMatchStem } from '../shared/romNaming';
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

export function isFileSystemAccessSupported(): { supported: boolean; reason?: string } {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'Browser environment required.' };
  }
  const win = window as unknown as { showDirectoryPicker?: unknown };
  if (typeof win.showDirectoryPicker !== 'function') {
    return {
      supported: false,
      reason: 'Direct storage device folder access requires Chrome, Edge, or another Chromium browser. Use Prepared ROM download in Firefox/Safari.',
    };
  }
  return { supported: true };
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
    scan.exactNames.delete(removedOldName);
    scan.exactNamesLower.delete(removedOldName.toLowerCase());
    const oldIdx = scan.entries.findIndex((e) => e.name.toLowerCase() === removedOldName.toLowerCase());
    if (oldIdx >= 0) scan.entries.splice(oldIdx, 1);
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

export async function streamHttpPayloadToSdFile(
  url: string,
  dirHandle: SdDirectoryHandle,
  filename: string,
  options?: {
    signal?: AbortSignal;
    hadExistingFile?: boolean;
    onDebug?: (message: string, detail?: string) => void;
  },
): Promise<number> {
  const signal = options?.signal;
  const onDebug = options?.onDebug;
  if (signal?.aborted) {
    throw new DOMException('Installation canceled by user.', 'AbortError');
  }

  onDebug?.(`Extracting & streaming "${filename}"`, url);

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

  let written = 0;
  try {
    if (res.body) {
      const reader = res.body.getReader();
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
          await writable.write(value);
          written += value.byteLength;
        }
      }
      await writable.close();
      onDebug?.(`Wrote "${filename}" (${written} bytes)`);
      return written;
    }

    const buf = await res.arrayBuffer();
    if (signal?.aborted) {
      throw new DOMException('Installation canceled by user.', 'AbortError');
    }
    await writable.write(buf);
    written = buf.byteLength;
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
