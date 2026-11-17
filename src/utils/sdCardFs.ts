import { buildUpgradeMatchStem } from '../shared/romNaming';

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
