export type ArchiveFormatKind = 'zip' | '7z' | 'rar' | 'tar' | 'raw';

export type ArchiveEntryCategory = 'rom' | 'disc' | 'patch' | 'doc' | 'archive' | 'other';

export interface ArchiveBrowseEntry {
  path: string;
  name: string;
  sizeBytes: number;
  extension: string;
  category: ArchiveEntryCategory;
  previewableText: boolean;
}

export interface ArchiveBrowseListing {
  sourceFilename: string;
  archiveFormat: ArchiveFormatKind;
  archiveSizeBytes: number;
  totalFiles: number;
  totalUncompressedBytes: number;
  entries: ArchiveBrowseEntry[];
}

export interface ArchiveTextPreviewResult {
  entryPath: string;
  filename: string;
  text: string;
  truncated: boolean;
  bytesRead: number;
}

export interface ArchiveDirectoryFolder {
  name: string;
  path: string;
  fileCount: number;
  totalBytes: number;
}

export interface ArchiveBreadcrumb {
  label: string;
  path: string;
}

export interface ArchiveDirectoryView {
  currentPath: string;
  parentPath: string | null;
  breadcrumbs: ArchiveBreadcrumb[];
  folders: ArchiveDirectoryFolder[];
  files: ArchiveBrowseEntry[];
}

const BROWSABLE_ARCHIVE_REGEX = /\.(zip|7z|rar|tar|tgz|tar\.gz|tar\.xz)$/i;

export function isBrowsableArchiveName(filename: string | null | undefined): boolean {
  if (!filename) return false;
  return BROWSABLE_ARCHIVE_REGEX.test(filename.trim());
}

export function normalizeArchiveSubpath(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    .join('/');
}

export function listArchiveDirectoryAtPath(
  entries: readonly ArchiveBrowseEntry[],
  rawSubpath = '',
): ArchiveDirectoryView {
  const currentPath = normalizeArchiveSubpath(rawSubpath);
  const prefix = currentPath ? `${currentPath}/` : '';

  const folderMap = new Map<string, ArchiveDirectoryFolder>();
  const files: ArchiveBrowseEntry[] = [];

  for (const entry of entries) {
    const normalizedPath = normalizeArchiveSubpath(entry.path);
    if (!normalizedPath) continue;
    if (prefix && !normalizedPath.startsWith(prefix)) continue;

    const remainder = prefix ? normalizedPath.slice(prefix.length) : normalizedPath;
    if (!remainder) continue;

    const slashIdx = remainder.indexOf('/');
    if (slashIdx < 0) {
      files.push({
        ...entry,
        path: normalizedPath,
        name: entry.name || remainder,
      });
    } else {
      const folderName = remainder.slice(0, slashIdx);
      const folderPath = prefix ? `${prefix}${folderName}` : folderName;
      const existing = folderMap.get(folderName);
      if (existing) {
        existing.fileCount += 1;
        existing.totalBytes += entry.sizeBytes;
      } else {
        folderMap.set(folderName, {
          name: folderName,
          path: folderPath,
          fileCount: 1,
          totalBytes: entry.sizeBytes,
        });
      }
    }
  }

  const folders = Array.from(folderMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
  files.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );

  const segments = currentPath ? currentPath.split('/') : [];
  const breadcrumbs: ArchiveBreadcrumb[] = segments.map((seg, idx) => ({
    label: seg,
    path: segments.slice(0, idx + 1).join('/'),
  }));

  const parentPath =
    segments.length === 0
      ? null
      : segments.length === 1
        ? ''
        : segments.slice(0, -1).join('/');

  return {
    currentPath,
    parentPath,
    breadcrumbs,
    folders,
    files,
  };
}

export function filterArchiveEntries(
  entries: readonly ArchiveBrowseEntry[],
  query: string,
): ArchiveBrowseEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) ||
        entry.path.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        entry.extension.toLowerCase().includes(q),
    )
    .sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true }),
    );
}
