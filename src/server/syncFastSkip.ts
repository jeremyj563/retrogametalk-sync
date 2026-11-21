import fs from 'node:fs';
import path from 'node:path';
import {
  classifyFileRoleToTypeKeys,
  evaluateReleaseTypeMatch,
} from '../shared/releaseTypeFilter.ts';
import { classifyFileRole, deriveReleaseTags } from './releaseTags.ts';
import type { DiscoveredRelease, WpPostMetadata } from './rgtClient.ts';
import type { ReleaseFileRecord, RepositoryItemRecord } from './types.ts';

export type FileExistsChecker = (localPath: string) => boolean;

export function defaultFileExistsWithBytes(localPath: string): boolean {
  if (!localPath) return false;
  try {
    return fs.existsSync(localPath) && fs.statSync(localPath).size > 0;
  } catch {
    return false;
  }
}

export function normalizeFilenameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ');
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export type ReleaseFastSkipReason =
  | 'already_downloaded'
  | 'not_in_catalog'
  | 'status_not_downloaded'
  | 'no_recorded_files'
  | 'has_non_downloaded_file'
  | 'missing_on_disk'
  | 'upstream_modified'
  | 'no_stored_timestamp'
  | 'new_eligible_hint';

export interface ReleaseFastSkipInput {
  existing: RepositoryItemRecord | null;
  post: WpPostMetadata;
  systemSlug: string;
  allowedReleaseTypes: readonly string[];
  fileExistsWithBytes?: FileExistsChecker;
}

export interface ReleaseFastSkipResult {
  skip: boolean;
  reason: ReleaseFastSkipReason;
  verifiedFilesCount: number;
}

/**
 * Level 1 fast-skip evaluator (runs BEFORE fetching a release's HTML page).
 *
 * Safely skips fetching HTML & dynamic download links when:
 * 1. The release is already marked `downloaded` in SQLite with at least one recorded file.
 * 2. Every recorded file is `downloaded`/`skipped` and still exists on disk with `size > 0`.
 * 3. Upstream WordPress `modifiedGmt` is not newer than our stored timestamp.
 * 4. All policy-eligible `downloadHints` from WP ACF are already present among recorded files
 *    (so widening Sync Rules release-type filters or upstream file additions still trigger a scrape).
 */
export function evaluateReleaseFastSkip(input: ReleaseFastSkipInput): ReleaseFastSkipResult {
  const { existing, post, systemSlug, allowedReleaseTypes } = input;
  const checkDisk = input.fileExistsWithBytes ?? defaultFileExistsWithBytes;

  if (!existing) {
    return { skip: false, reason: 'not_in_catalog', verifiedFilesCount: 0 };
  }

  if (existing.status !== 'downloaded') {
    return { skip: false, reason: 'status_not_downloaded', verifiedFilesCount: 0 };
  }

  const files = existing.files || [];
  if (files.length === 0) {
    return { skip: false, reason: 'no_recorded_files', verifiedFilesCount: 0 };
  }

  for (const file of files) {
    if (file.status !== 'downloaded' && file.status !== 'skipped') {
      return { skip: false, reason: 'has_non_downloaded_file', verifiedFilesCount: 0 };
    }
    if (!file.localPath || !checkDisk(file.localPath)) {
      return { skip: false, reason: 'missing_on_disk', verifiedFilesCount: 0 };
    }
  }

  // Upstream timestamp check (1-second tolerance for ISO rounding)
  const incomingMs = parseIsoMs(post.modifiedGmt) ?? parseIsoMs(post.dateGmt);
  const storedRemoteMs = parseIsoMs(existing.remoteUpdatedAt);
  const storedDownloadedMs = parseIsoMs(existing.downloadedAt);

  if (incomingMs !== null) {
    if (storedRemoteMs !== null) {
      if (incomingMs > storedRemoteMs + 1000) {
        return { skip: false, reason: 'upstream_modified', verifiedFilesCount: 0 };
      }
    } else if (storedDownloadedMs !== null) {
      if (incomingMs > storedDownloadedMs + 1000) {
        return { skip: false, reason: 'upstream_modified', verifiedFilesCount: 0 };
      }
    } else {
      return { skip: false, reason: 'no_stored_timestamp', verifiedFilesCount: 0 };
    }
  }

  // Verify every policy-eligible WP download hint is already covered by downloaded files
  const hints = post.downloadHints || [];
  if (hints.length > 0) {
    const downloadedKeys = new Set<string>();
    for (const file of files) {
      if (file.filename) {
        downloadedKeys.add(normalizeFilenameKey(file.filename));
      }
      if (file.localPath) {
        downloadedKeys.add(normalizeFilenameKey(path.basename(file.localPath)));
      }
    }

    const hasTypeFilter = allowedReleaseTypes.length > 0;
    const mutableAllowedTypes = [...allowedReleaseTypes];
    const siblingFilenames = Array.from(
      new Set([
        ...hints.map((h) => (h.filename || '').trim()).filter(Boolean),
        ...files.map((f) => (f.filename || '').trim()).filter(Boolean),
      ]),
    );
    const hintRoles = hints.map((h) =>
      classifyFileRole(h.filename, h.filename, {
        genres: post.genres,
        languages: post.languages,
        sources: post.sources,
        title: post.title || undefined,
        systemName: systemSlug,
        siblingFilenames,
      }),
    );
    const baseMetaTags = deriveReleaseTags(
      {
        genres: post.genres,
        languages: post.languages,
        sources: post.sources,
        systemName: systemSlug,
      },
      hintRoles,
    );

    for (let i = 0; i < hints.length; i += 1) {
      const hint = hints[i];
      const hintName = (hint.filename || '').trim();
      if (!hintName) continue;

      if (hasTypeFilter) {
        const fileTypeKeys = classifyFileRoleToTypeKeys(hintRoles[i], baseMetaTags, systemSlug);
        const match = evaluateReleaseTypeMatch(fileTypeKeys, mutableAllowedTypes);
        if (!match.allowed) {
          continue;
        }
      }

      if (!downloadedKeys.has(normalizeFilenameKey(hintName))) {
        return { skip: false, reason: 'new_eligible_hint', verifiedFilesCount: 0 };
      }
    }
  }

  return {
    skip: true,
    reason: 'already_downloaded',
    verifiedFilesCount: files.length,
  };
}

/**
 * Index-First Full Sync fast-skip evaluator for cataloged SQLite releases.
 *
 * Returns true when a release has already mirrored every policy-eligible file on disk
 * (ignoring sibling files/hints that are excluded by the active Release Type filter),
 * AND every policy-eligible `downloadHint` is already covered on disk (so widening
 * Sync Rules immediately detects newly-eligible files without re-fetching unchanged pages).
 */
export function isReleaseFullyMirroredForRules(
  item: RepositoryItemRecord,
  allowedReleaseTypes: readonly string[],
  fileExistsWithBytes: FileExistsChecker = defaultFileExistsWithBytes,
): {
  satisfied: boolean;
  verifiedFilesCount: number;
} {
  if (item.status === 'skipped') {
    return { satisfied: true, verifiedFilesCount: Math.max(1, (item.files || []).length) };
  }

  const files = item.files || [];
  if (files.length === 0) {
    return { satisfied: false, verifiedFilesCount: 0 };
  }

  const hasTypeFilter = allowedReleaseTypes.length > 0;
  const mutableAllowedTypes = [...allowedReleaseTypes];
  const hints = item.metadata?.downloadHints || [];
  const siblingFilenames = Array.from(
    new Set([
      ...files.map((f) => (f.filename || '').trim()).filter(Boolean),
      ...hints.map((h) => (h.filename || '').trim()).filter(Boolean),
    ]),
  );

  const ctx = {
    genres: item.genres,
    languages: item.languages,
    sources: item.sources,
    title: item.title,
    systemName: item.systemName,
    siblingFilenames,
  };

  const fileRoles = files.map((f) => classifyFileRole(f.filename, f.displayLabel || f.filename, ctx));
  const hintRoles = hints.map((h) => classifyFileRole(h.filename, h.filename, ctx));
  const baseMetaTags = deriveReleaseTags(
    {
      genres: item.genres,
      languages: item.languages,
      sources: item.sources,
      systemName: item.systemName,
    },
    [...fileRoles, ...hintRoles],
  );

  let verifiedEligibleCount = 0;
  const verifiedDownloadKeys = new Set<string>();

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const isVerifiedOnDisk =
      (file.status === 'downloaded' || file.status === 'skipped') &&
      Boolean(file.localPath) &&
      fileExistsWithBytes(file.localPath);

    if (isVerifiedOnDisk) {
      if (file.filename) {
        verifiedDownloadKeys.add(normalizeFilenameKey(file.filename));
      }
      if (file.localPath) {
        verifiedDownloadKeys.add(normalizeFilenameKey(path.basename(file.localPath)));
      }
    }

    let isEligible = true;
    if (hasTypeFilter) {
      const fileTypeKeys = classifyFileRoleToTypeKeys(fileRoles[i], baseMetaTags, item.systemName);
      isEligible = evaluateReleaseTypeMatch(fileTypeKeys, mutableAllowedTypes).allowed;
    }

    if (!isEligible) {
      continue;
    }

    if (!isVerifiedOnDisk) {
      return { satisfied: false, verifiedFilesCount: 0 };
    }
    verifiedEligibleCount += 1;
  }

  // Verify every policy-eligible download hint is already covered by a verified on-disk file
  let eligibleHintsCount = 0;
  for (let i = 0; i < hints.length; i += 1) {
    const hintName = (hints[i].filename || '').trim();
    if (!hintName) continue;

    if (hasTypeFilter) {
      const hintTypeKeys = classifyFileRoleToTypeKeys(hintRoles[i], baseMetaTags, item.systemName);
      if (!evaluateReleaseTypeMatch(hintTypeKeys, mutableAllowedTypes).allowed) {
        continue;
      }
    }

    eligibleHintsCount += 1;
    if (!verifiedDownloadKeys.has(normalizeFilenameKey(hintName))) {
      return { satisfied: false, verifiedFilesCount: 0 };
    }
  }

  if (verifiedEligibleCount === 0 && eligibleHintsCount === 0) {
    // No eligible files or hints exist under current Sync Rules
    return { satisfied: hasTypeFilter, verifiedFilesCount: 0 };
  }

  return {
    satisfied: verifiedEligibleCount > 0,
    verifiedFilesCount: verifiedEligibleCount,
  };
}

export interface PartitionedReleaseFiles {
  alreadyDownloaded: { release: DiscoveredRelease; existingFile: ReleaseFileRecord }[];
  toDownload: DiscoveredRelease[];
}

/**
 * Level 2 file-level pre-check (runs inside processDiscoveredReleasePage when a release page
 * IS inspected, e.g., after an upstream update, partial download, or HTML fallback crawl).
 *
 * Separates files already marked `downloaded` in SQLite and verified on disk from files that
 * actually need to be downloaded—avoiding `downloading` status flicker, dummy worker slots,
 * and repetitive `[info]` verification logs.
 */
export function partitionAlreadyDownloadedFiles(
  existingFiles: readonly ReleaseFileRecord[],
  eligibleReleases: readonly DiscoveredRelease[],
  resolveExpectedLocalPath: (rel: DiscoveredRelease) => string,
  fileExistsWithBytes: FileExistsChecker = defaultFileExistsWithBytes,
): PartitionedReleaseFiles {
  const alreadyDownloaded: { release: DiscoveredRelease; existingFile: ReleaseFileRecord }[] = [];
  const toDownload: DiscoveredRelease[] = [];

  if (existingFiles.length === 0) {
    return { alreadyDownloaded, toDownload: [...eligibleReleases] };
  }

  const verifiedByUrl = new Map<string, ReleaseFileRecord>();
  const verifiedByPath = new Map<string, ReleaseFileRecord>();
  const verifiedByName = new Map<string, ReleaseFileRecord>();

  for (const file of existingFiles) {
    if (file.status !== 'downloaded' && file.status !== 'skipped') continue;
    if (!file.localPath || !fileExistsWithBytes(file.localPath)) continue;

    if (file.remoteUrl) {
      verifiedByUrl.set(file.remoteUrl, file);
    }
    verifiedByPath.set(path.resolve(file.localPath), file);
    if (file.filename) {
      verifiedByName.set(normalizeFilenameKey(file.filename), file);
    }
    verifiedByName.set(normalizeFilenameKey(path.basename(file.localPath)), file);
  }

  for (const rel of eligibleReleases) {
    const expectedPath = path.resolve(resolveExpectedLocalPath(rel));
    const matched =
      verifiedByUrl.get(rel.remoteUrl) ??
      verifiedByPath.get(expectedPath) ??
      verifiedByName.get(normalizeFilenameKey(rel.filename));

    if (matched) {
      alreadyDownloaded.push({ release: rel, existingFile: matched });
    } else {
      toDownload.push(rel);
    }
  }

  return { alreadyDownloaded, toDownload };
}
