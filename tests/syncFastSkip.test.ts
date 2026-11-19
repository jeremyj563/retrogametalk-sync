import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateReleaseFastSkip,
  partitionAlreadyDownloadedFiles,
} from '../src/server/syncFastSkip.ts';
import type { DiscoveredRelease, WpPostMetadata } from '../src/server/rgtClient.ts';
import type { ReleaseFileRecord, RepositoryItemRecord } from '../src/server/types.ts';

function makeFile(overrides: Partial<ReleaseFileRecord> = {}): ReleaseFileRecord {
  return {
    id: 1,
    releaseId: 10,
    remoteUrl: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/?dl=old-nonce',
    downloadUrl: 'https://retrogametalk.com/dl/old-nonce',
    remotePath: 'famicom_disk_system/ai-senshi-nicol-japan/Ai Senshi Nicol (English v1.0).zip',
    localPath: '/run/repo/famicom_disk_system/ai-senshi-nicol-japan/Ai Senshi Nicol (English v1.0).zip',
    filename: 'Ai Senshi Nicol (English v1.0).zip',
    displayLabel: 'Ai Senshi Nicol (English v1.0).zip',
    fileRole: 'Translation',
    fileSizeBytes: 80660,
    status: 'downloaded',
    errorMessage: null,
    lastRunId: 5,
    discoveredAt: '2026-11-10T10:00:00Z',
    downloadedAt: '2026-11-10T10:01:00Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<RepositoryItemRecord> = {}): RepositoryItemRecord {
  return {
    id: 10,
    remoteUrl: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/',
    wpPostId: 42,
    wpPostType: 'famicom_disk_system',
    remotePath: 'famicom_disk_system/ai-senshi-nicol-japan',
    localPath: '/run/repo/famicom_disk_system/ai-senshi-nicol-japan',
    systemName: 'famicom_disk_system',
    releaseType: 'Translation',
    releaseTags: ['Translation'],
    title: 'Ai Senshi Nicol',
    fileSizeBytes: 80660,
    sizeIsEstimated: false,
    publishedAt: '2025-05-01T00:00:00Z',
    remoteUpdatedAt: '2026-11-01T12:00:00Z',
    status: 'downloaded',
    errorMessage: null,
    lastRunId: 5,
    discoveredAt: '2026-11-10T10:00:00Z',
    downloadedAt: '2026-11-10T10:01:00Z',
    installedAt: null,
    installedDeviceLabel: null,
    publisher: 'Konami',
    developer: 'Konami',
    releaseYear: '1987',
    genres: ['Action'],
    regions: ['Japan'],
    languages: ['English', 'Japanese'],
    sources: ['Romhacking.net'],
    coverLocalPath: null,
    screenshotsCount: 0,
    hasMetadata: true,
    filesCount: 1,
    files: [makeFile()],
    metadata: null,
    ...overrides,
  };
}

function makePost(overrides: Partial<WpPostMetadata> = {}): WpPostMetadata {
  return {
    wpPostId: 42,
    wpPostType: 'famicom_disk_system',
    title: 'Ai Senshi Nicol',
    originalTitle: null,
    link: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/',
    dateGmt: '2025-05-01T00:00:00Z',
    modifiedGmt: '2026-11-01T12:00:00Z',
    publisher: 'Konami',
    developer: 'Konami',
    releaseYear: '1987',
    genres: ['Action'],
    regions: ['Japan'],
    languages: ['English', 'Japanese'],
    sources: ['Romhacking.net'],
    formats: ['.fds'],
    descriptionHtml: '',
    downloadHints: [
      { filename: 'Ai Senshi Nicol (English v1.0).zip', fileSize: '79 KB' },
      { filename: 'Ai Senshi Nicol (Japan) [b].zip', fileSize: '75 KB' },
    ],
    ...overrides,
  };
}

test('evaluateReleaseFastSkip skips unchanged downloaded release when policy-excluded hints are ignored', () => {
  const existing = makeItem();
  const post = makePost();

  const res = evaluateReleaseFastSkip({
    existing,
    post,
    systemSlug: 'famicom_disk_system',
    allowedReleaseTypes: ['translation_en'],
    fileExistsWithBytes: () => true,
  });

  assert.equal(res.skip, true);
  assert.equal(res.reason, 'already_downloaded');
  assert.equal(res.verifiedFilesCount, 1);
});

test('evaluateReleaseFastSkip refuses to skip when a downloaded file is missing from disk', () => {
  const existing = makeItem();
  const post = makePost();

  const res = evaluateReleaseFastSkip({
    existing,
    post,
    systemSlug: 'famicom_disk_system',
    allowedReleaseTypes: ['translation_en'],
    fileExistsWithBytes: () => false,
  });

  assert.equal(res.skip, false);
  assert.equal(res.reason, 'missing_on_disk');
});

test('evaluateReleaseFastSkip refuses to skip when upstream modifiedGmt is newer than stored remoteUpdatedAt', () => {
  const existing = makeItem({ remoteUpdatedAt: '2026-11-01T12:00:00Z' });
  const post = makePost({ modifiedGmt: '2026-11-18T08:30:00Z' });

  const res = evaluateReleaseFastSkip({
    existing,
    post,
    systemSlug: 'famicom_disk_system',
    allowedReleaseTypes: ['translation_en'],
    fileExistsWithBytes: () => true,
  });

  assert.equal(res.skip, false);
  assert.equal(res.reason, 'upstream_modified');
});

test('evaluateReleaseFastSkip refuses to skip when Release Type filter is widened to allow previously skipped files', () => {
  const existing = makeItem();
  const post = makePost();

  // User cleared release type filter -> Retail ROM hint is now eligible and not yet downloaded
  const res = evaluateReleaseFastSkip({
    existing,
    post,
    systemSlug: 'famicom_disk_system',
    allowedReleaseTypes: [],
    fileExistsWithBytes: () => true,
  });

  assert.equal(res.skip, false);
  assert.equal(res.reason, 'new_eligible_hint');
});

test('evaluateReleaseFastSkip refuses to skip non-downloaded releases', () => {
  for (const status of ['available', 'partial', 'failed', 'queued'] as const) {
    const res = evaluateReleaseFastSkip({
      existing: makeItem({ status }),
      post: makePost(),
      systemSlug: 'famicom_disk_system',
      allowedReleaseTypes: ['translation_en'],
      fileExistsWithBytes: () => true,
    });
    assert.equal(res.skip, false);
    assert.equal(res.reason, 'status_not_downloaded');
  }
});

test('partitionAlreadyDownloadedFiles skips verified files across rotated nonces and keeps new/missing files', () => {
  const existingFiles = [
    makeFile({
      id: 1,
      filename: 'Ai Senshi Nicol (English v1.0).zip',
      localPath: '/run/repo/famicom_disk_system/ai-senshi-nicol-japan/Ai Senshi Nicol (English v1.0).zip',
      status: 'downloaded',
    }),
    makeFile({
      id: 2,
      filename: 'Manual.7z',
      localPath: '/run/repo/famicom_disk_system/ai-senshi-nicol-japan/Manual.7z',
      status: 'downloaded',
    }),
  ];

  const discovered: DiscoveredRelease[] = [
    {
      remoteUrl: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/?dl=new-nonce-1',
      downloadUrl: 'https://retrogametalk.com/dl/new-nonce-1',
      pageUrl: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/',
      remotePath: 'famicom_disk_system/ai-senshi-nicol-japan/Ai Senshi Nicol (English v1.0).zip',
      systemName: 'famicom_disk_system',
      releaseType: 'Translation',
      title: 'Ai Senshi Nicol',
      filename: 'Ai Senshi Nicol (English v1.0).zip',
      publishedAt: null,
    },
    {
      remoteUrl: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/?dl=new-nonce-2',
      downloadUrl: 'https://retrogametalk.com/dl/new-nonce-2',
      pageUrl: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/',
      remotePath: 'famicom_disk_system/ai-senshi-nicol-japan/Manual.7z',
      systemName: 'famicom_disk_system',
      releaseType: 'Manual',
      title: 'Ai Senshi Nicol',
      filename: 'Manual.7z',
      publishedAt: null,
    },
    {
      remoteUrl: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/?dl=new-nonce-3',
      downloadUrl: 'https://retrogametalk.com/dl/new-nonce-3',
      pageUrl: 'https://retrogametalk.com/repository/famicom_disk_system/ai-senshi-nicol-japan/',
      remotePath: 'famicom_disk_system/ai-senshi-nicol-japan/Ai Senshi Nicol (English v1.1).zip',
      systemName: 'famicom_disk_system',
      releaseType: 'Translation',
      title: 'Ai Senshi Nicol',
      filename: 'Ai Senshi Nicol (English v1.1).zip',
      publishedAt: null,
    },
  ];

  // English v1.0 exists on disk; Manual.7z was deleted from disk; English v1.1 is brand new
  const onDisk = new Set([
    '/run/repo/famicom_disk_system/ai-senshi-nicol-japan/Ai Senshi Nicol (English v1.0).zip',
  ]);

  const partitioned = partitionAlreadyDownloadedFiles(
    existingFiles,
    discovered,
    (rel) => `/run/repo/${rel.remotePath}`,
    (p) => onDisk.has(p),
  );

  assert.deepEqual(
    partitioned.alreadyDownloaded.map((e) => e.release.filename),
    ['Ai Senshi Nicol (English v1.0).zip'],
  );
  assert.deepEqual(
    partitioned.toDownload.map((r) => r.filename),
    ['Manual.7z', 'Ai Senshi Nicol (English v1.1).zip'],
  );
});
