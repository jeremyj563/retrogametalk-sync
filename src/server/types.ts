export type RunTrigger = 'scheduled' | 'manual' | 'retry';
export type RunMode = 'incremental' | 'full' | 'dry_run';
export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed';
export type FileItemStatus = 'queued' | 'downloading' | 'downloaded' | 'skipped' | 'failed';
export type ItemStatus = FileItemStatus | 'partial';
export type LogLevel = 'info' | 'download' | 'throttle' | 'warn' | 'error';

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
  requestTimeoutMs: number;
  userAgent: string;
  systemFilter: string;
  discoveredSystems: string[];
  lastWatermarkAt: string | null;
  updatedAt: string;
  envOverrides: string[];
}

export type ScraperConfigInternal = ScraperConfigPublic;

export interface ConfigUpdateInput {
  baseUrl?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  downloadDir?: string;
  cronSchedule?: string;
  scheduleEnabled?: boolean;
  baseDelayMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  maxRetries?: number;
  maxConcurrency?: number;
  requestTimeoutMs?: number;
  userAgent?: string;
  systemFilter?: string;
}

export interface SyncRunRecord {
  id: number;
  triggerType: RunTrigger;
  mode: RunMode;
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
  specs: { label: string; value: string }[];
  descriptionHtml: string;
  descriptionText: string;
  coverUrl: string | null;
  coverLocalRelPath: string | null;
  screenshotUrls: string[];
  screenshotLocalRelPaths: string[];
  sourcePageUrl: string;
  fetchedAt: string;
}

export interface CatalogFacets {
  tags: string[];
  genres: string[];
  regions: string[];
  languages: string[];
  sources: string[];
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
  itemId: number | null;
  filename: string;
  systemName: string;
  remoteUrl: string;
  localPath: string;
  bytesReceived: number;
  totalBytes: number | null;
  bytesPerSec: number;
}

export interface StorageStats {
  downloadDir: string;
  dataDir: string;
  writable: boolean;
  totalFilesOnDisk: number;
  totalBytesOnDisk: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

export interface SystemBreakdown {
  systemName: string;
  totalItems: number;
  downloadedItems: number;
  skippedItems: number;
  failedItems: number;
  totalBytes: number;
}

export interface AuthSessionStatus {
  configured: boolean;
  authenticated: boolean;
  cookieCount: number;
  lastCheckedAt: string | null;
  lastMessage: string | null;
}

export interface ServiceStatusSnapshot {
  podId: string;
  activeRun: SyncRunRecord | null;
  activeTransfer: ActiveTransferState | null;
  currentPhase: string;
  nextScheduledRunAt: string | null;
  scheduleEnabled: boolean;
  cronSchedule: string;
  lastWatermarkAt: string | null;
  rateLimiter: RateLimiterTelemetry;
  auth: AuthSessionStatus;
  storage: StorageStats;
  totals: {
    totalCatalogItems: number;
    downloadedItems: number;
    skippedItems: number;
    failedItems: number;
    totalBytesMirrored: number;
    totalRuns: number;
  };
  systems: SystemBreakdown[];
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
