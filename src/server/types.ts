export type { CatalogRatingFilterMode } from '../shared/catalogRating.ts';
export type { CatalogSortOption } from '../shared/catalogSort.ts';
export type {
  RomNamingPreviewSample,
  RomNamingTypeKey,
  RomNamingTypeOverrides,
} from '../shared/romNaming.ts';
export type { SyncOverrideMode } from '../shared/syncRuleMatcher.ts';
export type {
  StorageFolderMappingConfig,
  StorageRomCategoryKey,
  SystemTypeFolderOverride,
  SystemTypeSubfolderMode,
} from '../shared/storageFolderMappings.ts';
export type RunTrigger = 'scheduled' | 'manual' | 'retry' | 'download';
export type SyncScope = 'incremental' | 'full';
export type RunMode = SyncScope | 'dry_run';
export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed';
export type FileItemStatus = 'available' | 'queued' | 'downloading' | 'downloaded' | 'skipped' | 'failed';
export type ItemStatus = FileItemStatus | 'partial';
export type LogLevel = 'debug' | 'info' | 'download' | 'throttle' | 'warn' | 'error';

export interface SystemIndexCursor {
  lastIndexedAt: string;
  totalWpPosts: number;
  totalPages: number;
  pagesIndexed: number;
  fullyIndexed: boolean;
  scope: 'filtered' | 'full';
}

export interface CatalogIndexerStatus {
  active: boolean;
  scope: 'filtered' | 'full' | null;
  mode?: 'delta' | 'full' | 'mixed' | null;
  currentSystem: string | null;
  systemsCompleted: number;
  systemsTotal: number;
  currentPage: number;
  totalPages: number;
  indexedCount: number;
  remainingUnindexedSystems: number;
  lastError: string | null;
}

export interface RatingsSyncStatus {
  active: boolean;
  scope: 'filtered' | 'full' | null;
  currentSystem: string | null;
  systemsCompleted: number;
  systemsTotal: number;
  currentPage: number;
  totalPages: number;
  updatedCount: number;
  ratedCount: number;
  lastError: string | null;
}

export interface ScraperConfigPublic {
  baseUrl: string;
  loginUrl: string;
  username: string;
  password: string;
  hasPassword: boolean;
  dataDir: string;
  downloadDir: string;
  cronSchedule: string;
  scheduleEnabled: boolean;
  baseDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  maxRetries: number;
  maxConcurrency: number;
  downloadChunkConcurrency: number;
  downloadChunkMinSizeMb: number;
  minFreeDiskGb: number;
  requestTimeoutMs: number;
  userAgent: string;
  systemFilter: string;
  allowedReleaseTypes: string[];
  discoveredSystems: string[];
  lastWatermarkAt: string | null;
  romNamingTemplate: string;
  romNamingTypeOverrides?: import('../shared/romNaming.ts').RomNamingTypeOverrides;
  romSanitizeFat32: boolean;
  romMaxFilenameLen: number;
  storageFolderConfig: import('../shared/storageFolderMappings.ts').StorageFolderMappingConfig;
  autoDownloadNewReleases: boolean;
  systemIndexState?: Record<string, SystemIndexCursor>;
  updatedAt: string;
  envOverrides: string[];
}

export type ScraperConfigInternal = ScraperConfigPublic;

export interface ConfigUpdateInput {
  baseUrl?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  clearPassword?: boolean;
  downloadDir?: string;
  cronSchedule?: string;
  scheduleEnabled?: boolean;
  baseDelayMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  maxRetries?: number;
  maxConcurrency?: number;
  downloadChunkConcurrency?: number;
  downloadChunkMinSizeMb?: number;
  minFreeDiskGb?: number;
  requestTimeoutMs?: number;
  userAgent?: string;
  systemFilter?: string;
  allowedReleaseTypes?: string[];
  lastWatermarkAt?: string | null;
  romNamingTemplate?: string;
  romNamingTypeOverrides?: import('../shared/romNaming.ts').RomNamingTypeOverrides;
  romSanitizeFat32?: boolean;
  romMaxFilenameLen?: number;
  storageFolderConfig?: import('../shared/storageFolderMappings.ts').StorageFolderMappingConfig;
  autoDownloadNewReleases?: boolean;
}

export interface AppAuthStatus {
  enabled: boolean;
  authenticated: boolean;
  usernameRequired: boolean;
}

export interface DryRunSampleRelease {
  id?: number;
  title: string;
  systemName: string;
  releaseType: string;
  fileSizeBytes: number;
  status: string;
}

export interface DryRunConsoleBreakdown {
  systemName: string;
  pendingCount: number;
  estimatedBytes: number;
}

export interface SyncRunSummarySnapshot {
  strategy: 'index_first' | 'legacy_crawl' | 'incremental_delta';
  ruleScopeLabel: string;
  totalRuleMatched: number;
  wouldDownloadCount: number;
  alreadyOnDiskCount: number;
  excludedByRulesCount: number;
  estimatedDownloadBytes: number;
  refreshedConsoles: string[];
  newDeltaDiscoveredCount: number;
  consoleBreakdown: DryRunConsoleBreakdown[];
  sampleReleases: DryRunSampleRelease[];
}

export interface SyncPreflightSummary {
  generatedAt: string;
  ruleScopeLabel: string;
  hasCustomSystemFilter: boolean;
  hasCustomTypeFilter: boolean;
  targetSystemsCount: number;
  targetSystems: string[];
  freshConsoles: string[];
  staleConsoles: string[];
  unindexedConsoles: string[];
  oldestIndexedAt: string | null;
  totalCataloged: number;
  totalRuleMatched: number;
  pendingDownloadCount: number;
  availablePendingCount: number;
  retryablePendingCount: number;
  queuedCount: number;
  alreadyDownloadedCount: number;
  excludedByRulesCount: number;
  estimatedPendingBytes: number;
  topPendingConsoles: DryRunConsoleBreakdown[];
  samplePendingReleases: DryRunSampleRelease[];
  autoDownloadNewReleases: boolean;
  lastWatermarkAt: string | null;
  scheduleEnabled: boolean;
}

export interface SyncRunRecord {
  id: number;
  triggerType: RunTrigger;
  mode: RunMode;
  dryRun: boolean;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  pagesCrawled: number;
  newFound: number;
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  bytesDownloaded: number;
  rateLimitHits: number;
  avgDelayMs: number;
  errorSummary: string | null;
  summary?: SyncRunSummarySnapshot | null;
}

export interface ReleaseMetadata {
  wpPostId?: number | null;
  wpPostType?: string | null;
  title: string;
  subtitle: string | null;
  consoleName: string | null;
  publisher: string | null;
  developer?: string | null;
  releaseYear: string | null;
  genres: string[];
  regions: string[];
  languages: string[];
  sources?: string[];
  formats?: string[];
  releaseTags?: string[];
  downloadsCount: string | null;
  userRating?: number | null;
  userRatingVotes?: number | null;
  releasedAgo: string | null;
  updatedDate: string | null;
  publishedAt?: string | null;
  remoteUpdatedAt?: string | null;
  specs: { label: string; value: string }[];
  descriptionHtml: string;
  descriptionText: string;
  coverUrl: string | null;
  coverLocalRelPath: string | null;
  screenshotUrls: string[];
  screenshotLocalRelPaths: string[];
  screenshotsFullResVersion?: number;
  detailHydrated?: boolean;
  coverCandidates?: string[];
  screenshotCandidates?: string[][];
  downloadHints?: { filename: string; fileSize: string }[];
  sourcePageUrl: string;
  fetchedAt: string;
}

export type FilterMatchMode = 'any' | 'all';
export type CatalogDownloadedFilter = 'all' | 'only' | 'exclude';
export type CatalogInstalledFilter = 'all' | 'only' | 'exclude' | 'outdated';

export interface CatalogFacetCounts {
  tags: Record<string, number>;
  genres: Record<string, number>;
  regions: Record<string, number>;
  languages: Record<string, number>;
  sources: Record<string, number>;
  statuses: Record<string, number>;
  downloaded?: {
    downloaded: number;
    notDownloaded: number;
  };
  installed?: {
    installed: number;
    notInstalled: number;
    outdated: number;
  };
  syncRulesMatched?: number;
  queueableFiltered?: number;
  favorites?: number;
  syncOverrides?: {
    pinned: number;
    ignored: number;
  };
  ratings?: {
    rated: number;
    unrated: number;
    total: number;
    atLeast48: number;
    atLeast45: number;
    atLeast40: number;
    atLeast35: number;
    atLeast30: number;
  };
}

export interface CatalogFacets {
  tags: string[];
  genres: string[];
  regions: string[];
  languages: string[];
  sources: string[];
  counts?: CatalogFacetCounts;
}

export interface ReleaseFileRecord {
  id: number;
  releaseId: number;
  remoteUrl: string;
  downloadUrl: string;
  remotePath: string;
  localPath: string;
  filename: string;
  displayLabel: string;
  fileRole: string;
  fileSizeBytes: number;
  status: FileItemStatus;
  errorMessage: string | null;
  lastRunId: number | null;
  discoveredAt: string;
  downloadedAt: string | null;
}

export interface DeviceRomNamingOverrides {
  romNamingTemplate?: string | null;
  romNamingTypeOverrides?: import('../shared/romNaming.ts').RomNamingTypeOverrides | null;
  romSanitizeFat32?: boolean | null;
  romMaxFilenameLen?: number | null;
}

export type DeviceIconKey =
  | 'handheld'
  | 'vertical'
  | 'clamshell'
  | 'sdcard'
  | 'console'
  | 'desktop'
  | 'drive';

export type DeviceColorKey =
  | 'phosphor'
  | 'amber'
  | 'cyan'
  | 'crimson'
  | 'violet'
  | 'slate';

export interface StorageDeviceProfile {
  id: string;
  name: string;
  volumeLabel: string;
  iconKey: DeviceIconKey;
  colorKey: DeviceColorKey;
  isPinned: boolean;
  isArchived: boolean;
  markerVerifiedAt: string | null;
  folderConfig: import('../shared/storageFolderMappings.ts').StorageFolderMappingConfig | null;
  romNaming: DeviceRomNamingOverrides | null;
  lastMountedAt: string | null;
  installedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseDeviceInstallRecord {
  releaseId: number;
  deviceId: string;
  deviceName: string;
  volumeLabel: string;
  iconKey?: DeviceIconKey;
  colorKey?: DeviceColorKey;
  installedAt: string;
  installedFileId: number | null;
  installedFilename: string | null;
  installedPaths: string[];
}

export interface RepositoryItemRecord {
  id: number;
  wpPostId: number | null;
  wpPostType: string | null;
  remoteUrl: string;
  remotePath: string;
  localPath: string;
  systemName: string;
  releaseType: string;
  releaseTags: string[];
  title: string;
  fileSizeBytes: number;
  sizeIsEstimated?: boolean;
  publishedAt: string | null;
  remoteUpdatedAt: string | null;
  remoteCheckedAt?: string | null;
  status: ItemStatus;
  errorMessage: string | null;
  lastRunId: number | null;
  discoveredAt: string;
  downloadedAt: string | null;
  publisher: string | null;
  developer: string | null;
  releaseYear: string | null;
  genres: string[];
  regions: string[];
  languages: string[];
  sources: string[];
  coverLocalPath: string | null;
  screenshotsCount: number;
  hasMetadata: boolean;
  metadata: ReleaseMetadata | null;
  userRating?: number | null;
  userRatingVotes?: number | null;
  votedRank?: number | null;
  rgtDownloads?: number | null;
  ratingSyncedAt?: string | null;
  installedAt: string | null;
  installedDeviceLabel: string | null;
  installedFileId: number | null;
  installedFilename: string | null;
  deviceInstalls?: ReleaseDeviceInstallRecord[];
  isFavorite: boolean;
  syncOverride: import('../shared/syncRuleMatcher.ts').SyncOverrideMode;
  collectionIds: number[];
  filesCount: number;
  files: ReleaseFileRecord[];
}

export interface UserCollectionRecord {
  id: number;
  name: string;
  description: string | null;
  sortOrder: number;
  itemCount: number;
  downloadedCount: number;
  installedCount: number;
  queueableCount: number;
  estimatedBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface OutdatedInstalledItemSummary {
  id: number;
  title: string;
  systemName: string;
  updateState: 'update_ready_local' | 'update_available_remote';
  installedAt: string;
  installedDeviceLabel: string | null;
  installedFileId: number | null;
  installedFilename: string | null;
  latestLocalDownloadedAt: string | null;
  remoteUpdatedAt: string | null;
}

export interface OutdatedInstalledSummary {
  total: number;
  localReadyCount: number;
  remoteOnlyCount: number;
  localReadyIds: number[];
  remoteOnlyIds: number[];
  items: OutdatedInstalledItemSummary[];
}

export interface ActivityLogRecord {
  id: number;
  runId: number | null;
  level: LogLevel;
  message: string;
  detail: string | null;
  createdAt: string;
}

export interface RateLimitSample {
  timestamp: string;
  delayMs: number;
  latencyMs: number;
  throttled: boolean;
}

export interface RateLimiterTelemetry {
  currentDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  baseDelayMs: number;
  backoffMultiplier: number;
  consecutiveSuccesses: number;
  rateLimitHits: number;
  cooldownUntilMs: number | null;
  avgLatencyMs: number;
  totalRequests: number;
  history: RateLimitSample[];
}

export interface ActiveSyncItemSummary {
  itemId: number;
  title: string;
  systemName: string;
  hasCover: boolean;
}

export interface ActiveTransferState {
  workerKey?: string;
  itemId: number | null;
  itemTitle?: string;
  hasCover?: boolean;
  fileId?: number | null;
  fileIndex?: number | null;
  totalFiles?: number | null;
  completedFiles?: number | null;
  filename: string;
  systemName: string;
  remoteUrl: string;
  localPath: string;
  bytesReceived: number;
  totalBytes: number | null;
  bytesPerSec: number;
  activeChunks?: number | null;
  activeWorkers?: number | null;
  resumed?: boolean;
  parallelTransfers?: ActiveTransferState[];
}

export interface StorageStats {
  downloadDir: string;
  dataDir: string;
  writable: boolean;
  totalFilesOnDisk: number;
  totalBytesOnDisk: number;
  sqliteBytes: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

export interface EvictLocalFilesResult {
  evictedItemsCount: number;
  deletedFilesCount: number;
  freedBytes: number;
  skippedActiveIds: number[];
  ignoredInSyncCount: number;
  items: RepositoryItemRecord[];
}

export interface TransferSpeedSample {
  timestamp: string;
  bytesPerSec: number;
  bytesReceived: number;
  totalBytes: number | null;
  filename: string;
  systemName: string;
}

export interface SystemBreakdown {
  systemName: string;
  totalItems: number;
  availableItems: number;
  downloadedItems: number;
  skippedItems: number;
  failedItems: number;
  queuedItems: number;
  installedItems: number;
  mirroredFiles: number;
  totalBytes: number;
  lastActivityAt: string | null;
}

export interface ReleaseTypeBreakdown {
  typeName: string;
  downloadedItems: number;
  totalItems: number;
  totalBytes: number;
}

export interface AuthSessionStatus {
  configured: boolean;
  authenticated: boolean;
  hasCompletedLogin: boolean;
  lastAuthenticatedAt: string | null;
  cookieCount: number;
  lastCheckedAt: string | null;
  lastMessage: string | null;
}

export interface ActiveRunProgress {
  processed: number;
  total: number;
  scope: 'queue' | 'system';
  systemName: string | null;
}

export interface ServiceStatusSnapshot {
  podId: string;
  uptimeSeconds: number;
  schemaVersion: number;
  debugLogging: boolean;
  build: {
    version: string;
    gitSha: string;
    gitUrl: string | null;
    gitRef: string | null;
    builtAt: string | null;
  };
  activeRun: SyncRunRecord | null;
  activeTransfer: ActiveTransferState | null;
  activeTransfers?: ActiveTransferState[];
  activeSyncItem?: ActiveSyncItemSummary | null;
  runProgress?: ActiveRunProgress | null;
  transferHistory: TransferSpeedSample[];
  currentPhase: string;
  nextScheduledRunAt: string | null;
  scheduleEnabled: boolean;
  cronSchedule: string;
  lastWatermarkAt: string | null;
  rateLimiter: RateLimiterTelemetry;
  auth: AuthSessionStatus;
  storage: StorageStats;
  indexer: CatalogIndexerStatus;
  ratingsSync?: RatingsSyncStatus;
  queueAutoResume?: import('../shared/queueAutoResume.ts').QueueAutoResumeStatus | null;
  totals: {
    totalCatalogItems: number;
    availableItems: number;
    downloadedItems: number;
    skippedItems: number;
    failedItems: number;
    queuedItems: number;
    installedItems: number;
    outdatedInstalledItems?: number;
    outdatedLocalReadyItems?: number;
    favoriteItems?: number;
    totalBytesMirrored: number;
    totalRuns: number;
  };
  systems: SystemBreakdown[];
  releaseTypes: ReleaseTypeBreakdown[];
}

export interface AuthTestResult {
  success: boolean;
  statusCode: number | null;
  authenticated: boolean;
  cookieCount: number;
  discoveredSystems: string[];
  sampleReleaseUrls: string[];
  message: string;
  latencyMs: number;
}

export interface FsTreeNode {
  name: string;
  relativePath: string;
  type: 'directory' | 'file';
  sizeBytes: number;
  modifiedAt: string;
  childrenCount?: number;
  isArchive?: boolean;
  archiveFormat?: ArchiveFormat;
}

export interface AppliedMigrationRecord {
  version: number;
  name: string;
  description: string;
  checksum: string;
  appliedAt: string;
  durationMs: number;
}

export interface DatabaseMigrationReport {
  previousVersion: number;
  currentVersion: number;
  targetVersion: number;
  backupPath: string | null;
  appliedNow: AppliedMigrationRecord[];
  history: AppliedMigrationRecord[];
  rollbackWarning: string | null;
}

export type ArchiveFormat = 'zip' | '7z' | 'rar' | 'tar' | 'raw';
export type {
  ArchiveBrowseEntry,
  ArchiveBrowseListing,
  ArchiveEntryCategory,
  ArchiveTextPreviewResult,
} from '../shared/archiveTree';

export interface PlayableExportTarget {
  id: string;
  kind: 'rom' | 'disc_set' | 'patch_only';
  displayName: string;
  primaryEntry: string;
  entryPaths: string[];
  extension: string;
  sizeBytes: number;
  suggestedFilename: string;
  suggestedArchiveName: string;
  detectedVersion: string | null;
  roleBadge: string | null;
}

export interface ArchiveInspectResult {
  itemId: number;
  fileId: number;
  sourceFilename: string;
  fileRole?: string;
  fileDisplayLabel?: string;
  fileDownloadedAt?: string | null;
  archiveFormat: ArchiveFormat;
  playableTargets: PlayableExportTarget[];
  ignoredEntriesCount: number;
  ignoredSample: string[];
  patchOnly: boolean;
  notes: string[];
}

export interface CatalogGrowthPoint {
  date: string;
  indexedAdded: number;
  downloadedAdded: number;
  bytesAdded: number;
  cumulativeIndexed: number;
  cumulativeDownloaded: number;
  cumulativeBytes: number;
}

export interface DownloadTrendDailyPoint {
  date: string;
  filesDownloaded: number;
  bytesDownloaded: number;
  failedItems: number;
}

export interface DownloadTrendRunPoint {
  id: number;
  startedAt: string;
  triggerType: RunTrigger;
  mode: RunMode;
  dryRun: boolean;
  status: RunStatus;
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  bytesDownloaded: number;
  durationSec: number;
  avgBytesPerSec: number;
  rateLimitHits: number;
  avgDelayMs: number;
}

export interface SystemCoverageStat {
  systemName: string;
  totalItems: number;
  downloadedItems: number;
  availableItems: number;
  queuedItems: number;
  failedItems: number;
  installedItems: number;
  mirroredBytes: number;
  estimatedAvailableBytes: number;
  indexedPages: number;
  totalPages: number;
  fullyIndexed: boolean;
}

export interface SizeBucketStat {
  bucketKey: string;
  label: string;
  minBytes: number;
  maxBytes: number | null;
  downloadedCount: number;
  availableCount: number;
  downloadedBytes: number;
  availableBytes: number;
}

export interface CompositionStat {
  label: string;
  totalCount: number;
  downloadedCount: number;
  mirroredBytes: number;
}

export interface CatalogStatsSnapshot {
  generatedAt: string;
  summary: {
    totalCatalogItems: number;
    downloadedItems: number;
    availableItems: number;
    queuedItems: number;
    failedItems: number;
    installedItems: number;
    mirroredBytes: number;
    estimatedAvailableBytes: number;
    avgMirroredFileBytes: number;
    installedBytes: number;
    systemsTracked: number;
    fullyIndexedSystems: number;
  };
  growthTimeline: CatalogGrowthPoint[];
  downloadTrends: {
    daily: DownloadTrendDailyPoint[];
    runs: DownloadTrendRunPoint[];
  };
  systemCoverage: SystemCoverageStat[];
  sizeDistribution: SizeBucketStat[];
  releaseComposition: {
    tags: CompositionStat[];
    regions: CompositionStat[];
    languages: CompositionStat[];
    sources: CompositionStat[];
  };
}

