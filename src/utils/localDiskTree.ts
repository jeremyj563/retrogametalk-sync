import type { FsTreeNode } from '../types';
import { isBrowsableArchiveName } from '../shared/archiveTree';

export type DiskTreeSortField = 'name' | 'size' | 'modified';
export type DiskTreeSortDir = 'asc' | 'desc';

export type DiskEntryKind = 'directory' | 'archive' | 'rom' | 'disc' | 'patch' | 'doc' | 'other';

export interface DiskEntryClassification {
  kind: DiskEntryKind;
  label: string;
  browsableArchive: boolean;
}

export interface DiskTreeSummary {
  folderCount: number;
  fileCount: number;
  totalFileBytes: number;
  totalChildEntries: number;
}

const ROM_EXTENSIONS: Record<string, string> = {
  '.sfc': 'SNES ROM',
  '.smc': 'SNES ROM',
  '.nes': 'NES ROM',
  '.fds': 'FDS ROM',
  '.gba': 'GBA ROM',
  '.gbc': 'GBC ROM',
  '.gb': 'Game Boy ROM',
  '.nds': 'DS ROM',
  '.n64': 'N64 ROM',
  '.z64': 'N64 ROM',
  '.v64': 'N64 ROM',
  '.md': 'Genesis ROM',
  '.gen': 'Genesis ROM',
  '.smd': 'Genesis ROM',
  '.sms': 'Master System ROM',
  '.gg': 'Game Gear ROM',
  '.32x': '32X ROM',
  '.sg': 'SG-1000 ROM',
  '.pce': 'PC Engine ROM',
  '.ws': 'WonderSwan ROM',
  '.wsc': 'WonderSwan ROM',
  '.ngp': 'NGP ROM',
  '.ngc': 'NGP Color ROM',
  '.a26': 'Atari 2600 ROM',
  '.a52': 'Atari 5200 ROM',
  '.a78': 'Atari 7800 ROM',
  '.rom': 'ROM',
  '.mx1': 'MSX ROM',
  '.mx2': 'MSX ROM',
  '.col': 'ColecoVision ROM',
  '.int': 'Intellivision ROM',
  '.lnx': 'Lynx ROM',
  '.vb': 'Virtual Boy ROM',
};

const DISC_EXTENSIONS = new Set([
  '.chd',
  '.iso',
  '.cue',
  '.bin',
  '.img',
  '.mdf',
  '.mds',
  '.pbp',
  '.cso',
  '.rvz',
  '.gcm',
  '.wbfs',
  '.gdi',
  '.cdi',
]);

const PATCH_EXTENSIONS = new Set([
  '.ips',
  '.bps',
  '.ups',
  '.xdelta',
  '.vcdiff',
  '.ppf',
  '.aps',
  '.rup',
]);

const DOC_EXTENSIONS = new Set(['.txt', '.nfo', '.md', '.rtf', '.pdf', '.diz', '.log', '.html', '.htm']);

export function getFileExtensionLower(filename: string): string {
  const leaf = filename.split('/').pop() || filename;
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0 || dot === leaf.length - 1) return '';
  return leaf.slice(dot).toLowerCase();
}

export function classifyDiskEntry(node: FsTreeNode): DiskEntryClassification {
  if (node.type === 'directory') {
    const count = node.childrenCount ?? 0;
    return {
      kind: 'directory',
      label: `${count.toLocaleString()} ${count === 1 ? 'item' : 'items'}`,
      browsableArchive: false,
    };
  }

  const browsableArchive = Boolean(node.isArchive) || isBrowsableArchiveName(node.name);
  if (browsableArchive) {
    const fmt =
      node.archiveFormat && node.archiveFormat !== 'raw'
        ? node.archiveFormat.toUpperCase()
        : getFileExtensionLower(node.name).replace(/^\./, '').toUpperCase();
    return {
      kind: 'archive',
      label: fmt ? `${fmt} archive` : 'Archive',
      browsableArchive: true,
    };
  }

  const ext = getFileExtensionLower(node.name);
  if (ROM_EXTENSIONS[ext]) {
    return { kind: 'rom', label: ROM_EXTENSIONS[ext], browsableArchive: false };
  }
  if (DISC_EXTENSIONS.has(ext)) {
    return { kind: 'disc', label: `${ext.slice(1).toUpperCase()} disc`, browsableArchive: false };
  }
  if (PATCH_EXTENSIONS.has(ext)) {
    return { kind: 'patch', label: `${ext.slice(1).toUpperCase()} patch`, browsableArchive: false };
  }
  if (DOC_EXTENSIONS.has(ext)) {
    return { kind: 'doc', label: ext === '.pdf' ? 'PDF document' : 'Text document', browsableArchive: false };
  }
  return {
    kind: 'other',
    label: ext ? `${ext.slice(1).toUpperCase()} file` : 'File',
    browsableArchive: false,
  };
}

export function getParentDiskPath(relativePath: string): string | null {
  const trimmed = relativePath.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? '' : trimmed.slice(0, idx);
}

export function isAncestorDiskPath(candidateAncestor: string, currentPath: string): boolean {
  const ancestor = candidateAncestor.replace(/^\/+|\/+$/g, '');
  const current = currentPath.replace(/^\/+|\/+$/g, '');
  if (ancestor === current) return false;
  if (ancestor === '') return current.length > 0;
  return current.startsWith(`${ancestor}/`);
}

export function resolveDiskNavigationScrollTop(params: {
  fromPath: string;
  toPath: string;
  savedScrollByPath: ReadonlyMap<string, number>;
}): number {
  const { fromPath, toPath, savedScrollByPath } = params;
  // Navigating up to an ancestor restores the saved scroll offset in that parent folder;
  // drilling into a child or sibling always starts cleanly at the top (0).
  if (isAncestorDiskPath(toPath, fromPath)) {
    const saved = savedScrollByPath.get(toPath);
    if (typeof saved === 'number' && Number.isFinite(saved) && saved > 0) {
      return saved;
    }
  }
  return 0;
}

export function summarizeDiskTreeNodes(nodes: readonly FsTreeNode[]): DiskTreeSummary {
  let folderCount = 0;
  let fileCount = 0;
  let totalFileBytes = 0;
  let totalChildEntries = 0;

  for (const node of nodes) {
    if (node.type === 'directory') {
      folderCount += 1;
      totalChildEntries += node.childrenCount ?? 0;
    } else {
      fileCount += 1;
      totalFileBytes += Math.max(0, node.sizeBytes || 0);
    }
  }

  return { folderCount, fileCount, totalFileBytes, totalChildEntries };
}

export function sortDiskTreeNodes(
  nodes: readonly FsTreeNode[],
  field: DiskTreeSortField,
  dir: DiskTreeSortDir,
): FsTreeNode[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    // Keep directories grouped ahead of files for predictable filesystem navigation
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }

    if (field === 'size') {
      const aMetric = a.type === 'directory' ? (a.childrenCount ?? 0) : a.sizeBytes;
      const bMetric = b.type === 'directory' ? (b.childrenCount ?? 0) : b.sizeBytes;
      if (aMetric !== bMetric) {
        return (aMetric - bMetric) * factor;
      }
    } else if (field === 'modified') {
      const aMs = Date.parse(a.modifiedAt) || 0;
      const bMs = Date.parse(b.modifiedAt) || 0;
      if (aMs !== bMs) {
        return (aMs - bMs) * factor;
      }
    }

    const nameCmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return field === 'name' ? nameCmp * factor : nameCmp;
  });
}
