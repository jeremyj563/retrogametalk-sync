export type { CatalogSortOption } from './shared/catalogSort';
export type {
  StorageFolderMappingConfig,
  StorageRomCategoryKey,
  SystemTypeFolderOverride,
  SystemTypeSubfolderMode,
} from './shared/storageFolderMappings';
export type NavSection =
  | 'monitor'
  | 'catalog'
  | 'sync-rules'
  | 'device-export'
  | 'settings';

export type ConfigSectionTarget =
  | 'schedule'
  | 'systems'
  | 'releaseTypes'
  | 'romNaming'
  | 'storageMappings'
  | 'auth'
  | 'pacing';

export type OperationsSectionTarget = ConfigSectionTarget;

export interface ConfigFocusRequest {
  target: ConfigSectionTarget;
  nonce: number;
}

export type OperationsFocusRequest = ConfigFocusRequest;

export interface ConfigDirtyState {
  isDirty: boolean;
  changedSections: string[];
}

export interface ConfigPanelHandle {
  save: () => Promise<boolean>;
  discard: () => void;
}
export type SyncScope = 'incremental' | 'full';
export type RunMode = SyncScope | 'dry_run';
export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed';
export type FileItemStatus = 'queued' | 'downloading' | 'downloaded' | 'skipped' | 'failed';
export type ItemStatus = FileItemStatus | 'partial';
export type LogLevel = 'debug' | 'info' | 'download' | 'throttle' | 'warn' | 'error';

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
  requestTimeoutMs: number;
  userAgent: string;
  systemFilter: string;
  allowedReleaseTypes: string[];
  discoveredSystems: string[];
  lastWatermarkAt: string | null;
  romNamingTemplate: string;
  romSanitizeFat32: boolean;
  romMaxFilenameLen: number;
  storageFolderConfig: import('./shared/storageFolderMappings').StorageFolderMappingConfig;
  updatedAt: string;
  envOverrides: string[];
}

export interface SyncRunRecord {
  id: number;
  triggerType: 'scheduled' | 'manual' | 'retry';
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
  sourcePageUrl: string;
  fetchedAt: string;
}

export type FilterMatchMode = 'any' | 'all';
export type CatalogInstalledFilter = 'all' | 'only' | 'exclude';

export interface CatalogFacetCounts {
  tags: Record<string, number>;
  genres: Record<string, number>;
  regions: Record<string, number>;
  languages: Record<string, number>;
  sources: Record<string, number>;
  statuses: Record<string, number>;
  installed?: {
    installed: number;
    notInstalled: number;
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
  publishedAt: string | null;
  remoteUpdatedAt: string | null;
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
  installedAt: string | null;
  installedDeviceLabel: string | null;
  filesCount: number;
  files: ReleaseFileRecord[];
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

export interface ActiveTransferState {
  workerKey?: string;
  itemId: number | null;
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

export interface TransferSpeedSample {
  timestamp: string;
  bytesPerSec: number;
  bytesReceived: number;
  totalBytes: number | null;
  filename: string;
  systemName: string;
}

export interface ReleaseTypeBreakdown {
  typeName: string;
  downloadedItems: number;
  totalItems: number;
  totalBytes: number;
}

export interface SystemBreakdown {
  systemName: string;
  totalItems: number;
  downloadedItems: number;
  skippedItems: number;
  failedItems: number;
  queuedItems: number;
  installedItems: number;
  mirroredFiles: number;
  totalBytes: number;
  lastActivityAt: string | null;
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
  transferHistory: TransferSpeedSample[];
  currentPhase: string;
  nextScheduledRunAt: string | null;
  scheduleEnabled: boolean;
  cronSchedule: string;
  lastWatermarkAt: string | null;
  rateLimiter: RateLimiterTelemetry;
  auth: {
    configured: boolean;
    authenticated: boolean;
    hasCompletedLogin: boolean;
    lastAuthenticatedAt: string | null;
    cookieCount: number;
    lastCheckedAt: string | null;
    lastMessage: string | null;
  };
  storage: {
    downloadDir: string;
    dataDir: string;
    writable: boolean;
    totalFilesOnDisk: number;
    totalBytesOnDisk: number;
    sqliteBytes: number;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
  };
  totals: {
    totalCatalogItems: number;
    downloadedItems: number;
    skippedItems: number;
    failedItems: number;
    queuedItems: number;
    installedItems: number;
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
}

export type ArchiveFormat = 'zip' | '7z' | 'rar' | 'tar' | 'raw';

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
