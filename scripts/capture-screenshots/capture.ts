import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  CRT_DISPLAY_STORAGE_KEY,
  type CrtDisplaySettings,
  type CrtPalette,
} from '../../src/shared/crtDisplay.ts';
import type { ServiceStatusSnapshot } from '../../src/types.ts';
import {
  type CaptureOptions,
  SCREENSHOT_FILENAMES,
  buildCaptureCrtSettings,
  formatCaptureUsage,
  parseCaptureCliArgs,
} from './options.ts';
import { type SeedDemoResult, seedDemoEnvironment } from './seedDemoDb.ts';

const VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * Matches CatalogPanel's persisted layout storage key so Playwright contexts mount
 * directly into Box-Art Grid view with zero split-second Table view flash.
 */
export const CATALOG_VIEW_STORAGE_KEY = 'rgt_sync_catalog_view_v1';
export const CAPTURE_CATALOG_VIEW_PREFS = {
  viewMode: 'catalog',
  catalogLayout: 'grid',
} as const;

/**
 * Deliberate viewer-friendly pacing (in ms) for the animated README walkthrough WebP
 * so every view, drawer section, screenshot thumbnail preview, and palette transition
 * is easy to read.
 */
export const WALKTHROUGH_TIMINGS_MS = {
  syncOverviewDwell: 3800,
  catalogGridDwell: 2600,
  detailDrawerDwell: 2600,
  detailDrawerScrollSettleMs: 700,
  detailDrawerScreenshotsDwell: 3200,
  afterDrawerCloseDwell: 900,
  deviceExportPreThemeDwell: 1400,
  crtPopoverOpenDwell: 1100,
  crtPaletteSelectedDwell: 1100,
  afterCrtPopoverCloseDwell: 500,
  deviceExportFinalDwell: 3200,
} as const;

interface PlaywrightModuleLike {
  chromium: {
    launch: (options?: Record<string, unknown>) => Promise<PlaywrightBrowserLike>;
  };
}

interface PlaywrightBrowserLike {
  newContext: (options?: Record<string, unknown>) => Promise<PlaywrightContextLike>;
  close: () => Promise<void>;
}

interface PlaywrightContextLike {
  addInitScript: (fn: (...args: any[]) => void, arg?: any) => Promise<void>;
  newPage: () => Promise<PlaywrightPageLike>;
  close: () => Promise<void>;
}

interface PlaywrightPageLike {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForSelector: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
  waitForLoadState: (state?: string, options?: Record<string, unknown>) => Promise<void>;
  screenshot: (options?: Record<string, unknown>) => Promise<Buffer>;
  route: (url: string | RegExp, handler: (route: any) => Promise<void> | void) => Promise<void>;
  unroute: (url: string | RegExp) => Promise<void>;
  evaluate: <T = unknown>(fn: (...args: any[]) => T, arg?: any) => Promise<T>;
  locator: (selector: string) => any;
  getByRole: (role: string, options?: Record<string, unknown>) => any;
  video: () => { path: () => Promise<string> } | null;
  close: () => Promise<void>;
}

function assertFfmpegInstalled(): void {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'FFmpeg is required to encode WebP screenshots and walkthrough animations. Install ffmpeg and retry.',
    );
  }
}

async function loadPlaywright(): Promise<PlaywrightModuleLike> {
  try {
    const moduleName = 'playwright';
    const mod = (await import(moduleName)) as unknown as PlaywrightModuleLike;
    if (!mod?.chromium?.launch) {
      throw new Error('Playwright chromium launcher not found.');
    }
    return mod;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      [
        `Playwright is not installed locally (${detail}).`,
        'To keep the production Docker image lean, Playwright is installed on demand:',
        '  npm install --no-save playwright && npx playwright install chromium',
      ].join('\n'),
    );
  }
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Could not determine ephemeral TCP port.')));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServerReady(baseUrl: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/readyz`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for demo server at ${baseUrl}/readyz (${lastErr}).`);
}

function ensureBuiltFrontend(): void {
  const distIndex = path.resolve(process.cwd(), 'dist', 'index.html');
  if (fs.existsSync(distIndex)) return;
  console.log('[capture] dist/index.html not found — running `npm run build` once...');
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: process.cwd() });
}

function spawnDemoServer(port: number, seed: SeedDemoResult): ChildProcess {
  const localTsx = path.resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const cmd = fs.existsSync(localTsx) ? localTsx : process.execPath;
  const args = ['server.ts'];

  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATA_DIR: seed.dataDir,
      DOWNLOAD_DIR: seed.downloadDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trim();
    if (line) console.error(`[demo-server] ${line}`);
  });

  return child;
}

function encodeStaticPngToWebp(pngPath: string, webpPath: string): void {
  fs.mkdirSync(path.dirname(webpPath), { recursive: true });
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      pngPath,
      '-c:v',
      'libwebp',
      '-q:v',
      '86',
      '-compression_level',
      '6',
      webpPath,
    ],
    { stdio: 'inherit' },
  );
}

function encodeWalkthroughVideoToWebp(webmPath: string, webpPath: string): void {
  fs.mkdirSync(path.dirname(webpPath), { recursive: true });
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      webmPath,
      '-vf',
      'fps=15,scale=1200:-2:flags=lanczos',
      '-c:v',
      'libwebp',
      '-loop',
      '0',
      '-preset',
      'default',
      '-q:v',
      '78',
      '-compression_level',
      '6',
      '-an',
      webpPath,
    ],
    { stdio: 'inherit' },
  );
}

/**
 * Enhances a real /api/status payload in demo mode with a realistic active multi-chunk
 * transfer and verified session state so the Sync Speed Wave, combined progress bar,
 * Telemetry Deck, and Monitor status bar render cleanly without credentials warnings or
 * introducing any mock endpoints in production server code.
 */
export function buildActiveDemoStatus(
  base: ServiceStatusSnapshot,
  tick: number,
  featuredItemId: number,
  featuredTitle: string,
): ServiceStatusSnapshot {
  const now = Date.now();
  // Smooth ramping speed wave between ~9.2 MB/s and ~24.8 MB/s
  const waveMbps = 17.0 + Math.sin(tick * 0.55) * 6.8 + Math.cos(tick * 0.25) * 1.4;
  const worker1Bps = Math.round(waveMbps * 0.62 * 1024 * 1024);
  const worker2Bps = Math.round(waveMbps * 0.38 * 1024 * 1024);
  const combinedBps = worker1Bps + worker2Bps;

  const total1 = Math.round(412.5 * 1024 * 1024);
  const pct1 = Math.min(0.92, 0.54 + (tick % 30) * 0.011);
  const recv1 = Math.round(total1 * pct1);

  const total2 = Math.round(64.5 * 1024 * 1024);
  const pct2 = Math.min(0.89, 0.36 + (tick % 30) * 0.014);
  const recv2 = Math.round(total2 * pct2);

  const transfer1 = {
    workerKey: 'worker-1',
    itemId: featuredItemId,
    itemTitle: featuredTitle,
    hasCover: true,
    fileId: 1,
    fileIndex: 1,
    totalFiles: 2,
    completedFiles: 0,
    filename: `${featuredTitle} (En v2.4).zip`,
    systemName: 'snes',
    remoteUrl: 'https://retrogametalk.com/repo/snes/chrono-vanguard-dx/',
    localPath: `${base.storage.downloadDir}/snes/chrono-vanguard-dx/${featuredTitle} (En v2.4).zip`,
    bytesReceived: recv1,
    totalBytes: total1,
    bytesPerSec: worker1Bps,
    activeChunks: 3,
    activeWorkers: 2,
    resumed: false,
  };

  const transfer2 = {
    workerKey: 'worker-2',
    itemId: featuredItemId + 1,
    itemTitle: 'Starblade Zero 64',
    hasCover: true,
    fileId: 2,
    fileIndex: 1,
    totalFiles: 1,
    completedFiles: 0,
    filename: 'Starblade Zero 64 (USA).zip',
    systemName: 'n64',
    remoteUrl: 'https://retrogametalk.com/repo/n64/starblade-zero-64/',
    localPath: `${base.storage.downloadDir}/n64/starblade-zero-64/Starblade Zero 64 (USA).zip`,
    bytesReceived: recv2,
    totalBytes: total2,
    bytesPerSec: worker2Bps,
    activeChunks: 3,
    activeWorkers: 2,
    resumed: false,
  };

  const history = Array.from({ length: 24 }, (_, idx) => {
    const sampleMbps = 12.4 + Math.sin((idx + tick) * 0.42) * 5.6 + (idx / 24) * 3.8;
    return {
      timestamp: new Date(now - (24 - idx) * 2000).toISOString(),
      bytesPerSec: Math.round(sampleMbps * 1024 * 1024),
      bytesReceived: Math.round(recv1 * ((idx + 1) / 24)),
      totalBytes: total1,
      filename: transfer1.filename,
      systemName: 'snes',
    };
  });

  const rateHistory = Array.from({ length: 18 }, (_, idx) => ({
    timestamp: new Date(now - (18 - idx) * 3500).toISOString(),
    delayMs: 820 + Math.round(Math.sin(idx * 0.6) * 140),
    latencyMs: 118 + Math.round(Math.cos(idx * 0.5) * 34),
    throttled: idx === 5,
  }));

  return {
    ...base,
    currentPhase: 'Downloading release archives (3-chunk HTTP Range · 2 workers)',
    activeRun: {
      id: (base.totals.totalRuns || 14) + 1,
      triggerType: 'manual',
      mode: 'incremental',
      dryRun: false,
      status: 'running',
      startedAt: new Date(now - 95 * 1000).toISOString(),
      finishedAt: null,
      pagesCrawled: 12,
      newFound: 6,
      downloadedCount: 4,
      skippedCount: 11,
      failedCount: 0,
      bytesDownloaded: recv1 + recv2 + 286 * 1024 * 1024,
      rateLimitHits: 0,
      avgDelayMs: 880,
      errorSummary: null,
    },
    activeTransfer: {
      ...transfer1,
      bytesPerSec: combinedBps,
      bytesReceived: recv1 + recv2,
      totalBytes: total1 + total2,
      parallelTransfers: [transfer1, transfer2],
    },
    activeTransfers: [transfer1, transfer2],
    activeSyncItem: {
      itemId: featuredItemId,
      title: featuredTitle,
      systemName: 'snes',
      hasCover: true,
    },
    transferHistory: history,
    auth: {
      ...base.auth,
      configured: true,
      authenticated: true,
      hasCompletedLogin: true,
      lastAuthenticatedAt:
        base.auth.lastAuthenticatedAt ?? new Date(now - 18 * 60 * 1000).toISOString(),
      cookieCount: Math.max(base.auth.cookieCount || 0, 4),
      lastCheckedAt: new Date(now - 2 * 60 * 1000).toISOString(),
      lastMessage: 'Authenticated session active',
    },
    rateLimiter: {
      ...base.rateLimiter,
      currentDelayMs: 880,
      avgLatencyMs: 124,
      totalRequests: 48,
      consecutiveSuccesses: 16,
      history: rateHistory,
    },
  };
}

async function installDemoLiveTransferRoute(
  page: PlaywrightPageLike,
  featuredItemId: number,
  featuredTitle: string,
): Promise<void> {
  let tick = 0;

  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as ServiceStatusSnapshot;
    tick += 1;
    const enhanced = buildActiveDemoStatus(json, tick, featuredItemId, featuredTitle);
    await route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      body: JSON.stringify(enhanced),
    });
  });

  // Intercept SSE stream so real-time status ticks smoothly ramp the Sync Speed Wave
  await page.route('**/api/events', async (route) => {
    // Let the app use the polled/initial /api/status cleanly without hanging Playwright close
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: ': demo-capture-sse-ready\n\n',
    });
  });
}

async function setCrtSettingsInPage(
  page: PlaywrightPageLike,
  settings: CrtDisplaySettings,
): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: CRT_DISPLAY_STORAGE_KEY, value: settings },
  );
}

async function clickNavTab(page: PlaywrightPageLike, label: string): Promise<void> {
  const navBtn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await navBtn.click();
  await page.waitForTimeout(450);
}

async function switchPaletteViaCrtStudio(
  page: PlaywrightPageLike,
  targetPalette: CrtPalette,
  fallbackSettings: CrtDisplaySettings,
  pacing?: {
    openDwellMs: number;
    selectedDwellMs: number;
    closeDwellMs: number;
  },
): Promise<void> {
  const openDwellMs = pacing?.openDwellMs ?? 260;
  const selectedDwellMs = pacing?.selectedDwellMs ?? 260;
  const closeDwellMs = pacing?.closeDwellMs ?? 320;

  try {
    const toggleBtn = page.locator('button:has-text("CRT Display")').first();
    if (await toggleBtn.isVisible({ timeout: 1500 })) {
      await toggleBtn.click();
      await page.waitForTimeout(openDwellMs);
      const label = targetPalette === 'amber' ? 'Amber' : 'Green';
      const swatchBtn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await swatchBtn.isVisible({ timeout: 1500 })) {
        await swatchBtn.click();
        await page.waitForTimeout(selectedDwellMs);
      }
      // Close CRT Display popover so the full console view is unobstructed
      await toggleBtn.click();
      await page.waitForTimeout(closeDwellMs);
      return;
    }
  } catch {
    // Fallback cleanly to localStorage + reload below
  }

  await setCrtSettingsInPage(page, fallbackSettings);
  await page.evaluate(() => window.location.reload());
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(450);
}

async function seedCaptureBrowserStorage(
  context: PlaywrightContextLike,
  crtSettings: CrtDisplaySettings,
): Promise<void> {
  await context.addInitScript(
    ({ crtKey, crtValue, catalogKey, catalogValue }) => {
      window.localStorage.setItem(crtKey, JSON.stringify(crtValue));
      window.localStorage.setItem(catalogKey, JSON.stringify(catalogValue));
    },
    {
      crtKey: CRT_DISPLAY_STORAGE_KEY,
      crtValue: crtSettings,
      catalogKey: CATALOG_VIEW_STORAGE_KEY,
      catalogValue: CAPTURE_CATALOG_VIEW_PREFS,
    },
  );
}

async function ensureCatalogGridVisible(page: PlaywrightPageLike): Promise<void> {
  const gridBtn = page.locator('button[aria-label="Box-Art Grid view"]').first();
  if (await gridBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const isAlreadyGrid = await gridBtn
      .evaluate((el: HTMLElement) => el.className.includes('text-crt-phosphor'))
      .catch(() => false);
    if (!isAlreadyGrid) {
      await gridBtn.click();
    }
  }
  await page.waitForSelector('.crt-catalog-card', { timeout: 10000 });
  // Wait for cover images to decode
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('.crt-catalog-card img')) as HTMLImageElement[];
    await Promise.all(
      imgs.slice(0, 12).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
              setTimeout(resolve, 2500);
            }),
      ),
    );
  });
  await page.waitForTimeout(400);
}

async function openFeaturedGameDrawer(page: PlaywrightPageLike, preferredTitle?: string): Promise<void> {
  const targetCard = preferredTitle
    ? page.locator(`.crt-catalog-card:has-text("${preferredTitle}")`).first()
    : page.locator('.crt-catalog-card').first();
  if (await targetCard.isVisible({ timeout: 2500 }).catch(() => false)) {
    await targetCard.click();
  } else {
    await page.locator('.crt-catalog-card').first().click();
  }
  await page.waitForSelector('button[aria-label="Close game details"]', { timeout: 10000 });
  await page.waitForTimeout(650);
}

async function scrollDrawerToScreenshots(page: PlaywrightPageLike): Promise<boolean> {
  const firstShotBtn = page.locator('button[title="View screenshot 1"]').first();
  if (!(await firstShotBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
    return false;
  }

  await page.evaluate(() => {
    const shotBtn = document.querySelector('button[title="View screenshot 1"]');
    const section = shotBtn?.closest('section') ?? shotBtn;
    section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await page.waitForTimeout(WALKTHROUGH_TIMINGS_MS.detailDrawerScrollSettleMs);

  // Ensure screenshot thumbnails inside the drawer have finished decoding
  await page.evaluate(async () => {
    const imgs = Array.from(
      document.querySelectorAll('button[title^="View screenshot "] img'),
    ) as HTMLImageElement[];
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
              setTimeout(resolve, 2500);
            }),
      ),
    );
  });

  return true;
}

function formatSizeKb(filePath: string): string {
  const bytes = fs.statSync(filePath).size;
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export async function runScreenshotCapture(options: CaptureOptions): Promise<string[]> {
  assertFfmpegInstalled();
  const playwright = await loadPlaywright();

  const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-sync-capture-work-'));
  let demoSeed: SeedDemoResult | null = null;
  let demoServer: ChildProcess | null = null;
  let browser: PlaywrightBrowserLike | null = null;

  const cleanup = async (): Promise<void> => {
    if (browser) {
      await browser.close().catch(() => undefined);
      browser = null;
    }
    if (demoServer && !demoServer.killed) {
      demoServer.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 350));
      if (!demoServer.killed) demoServer.kill('SIGKILL');
      demoServer = null;
    }
    fs.rmSync(tempWorkDir, { recursive: true, force: true });
    if (demoSeed) {
      fs.rmSync(demoSeed.rootDir, { recursive: true, force: true });
      demoSeed = null;
    }
  };

  const handleSignal = () => {
    void cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    let baseUrl = options.baseUrl;
    const isDemoMode = !baseUrl;

    if (isDemoMode) {
      ensureBuiltFrontend();
      demoSeed = seedDemoEnvironment();
      const port = await findFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(
        `[capture] Seeded ephemeral demo DB (schema v${demoSeed.schemaVersion}, ${demoSeed.seededSystems.length} consoles, ${demoSeed.seededReleases} releases, ${demoSeed.unlockedTrophies} trophies)`,
      );
      demoServer = spawnDemoServer(port, demoSeed);
      await waitForServerReady(baseUrl);
      console.log(`[capture] Ephemeral demo server ready at ${baseUrl}`);
    } else {
      console.log(`[capture] Connecting to live instance at ${baseUrl}`);
    }

    const greenSettings = buildCaptureCrtSettings('green', options.crtPreset, options.uiMotion);
    const amberSettings = buildCaptureCrtSettings('amber', options.crtPreset, options.uiMotion);

    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--disable-gpu-sandbox', '--font-render-hinting=none'],
    });

    const producedFiles: string[] = [];
    fs.mkdirSync(options.outDir, { recursive: true });

    // ------------------------------------------------------------------
    // Phase 1: Capture the 4 crisp 1440x900 static screenshots (PNG -> WebP)
    // ------------------------------------------------------------------
    const staticContext = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'dark',
    });
    await seedCaptureBrowserStorage(staticContext, greenSettings);

    const staticPage = await staticContext.newPage();
    if (isDemoMode && demoSeed) {
      await installDemoLiveTransferRoute(
        staticPage,
        demoSeed.featuredItemId,
        demoSeed.featuredItemTitle,
      );
    }

    await staticPage.goto(baseUrl!, { waitUntil: 'networkidle' });
    await staticPage.waitForTimeout(1400);

    // 1) Sync Overview & Telemetry (Green · PVM · Low Motion · Speed Wave)
    const syncPng = path.join(tempWorkDir, 'sync-overview.png');
    const syncWebp = path.join(options.outDir, SCREENSHOT_FILENAMES.syncOverview);
    await staticPage.screenshot({ path: syncPng, fullPage: false });
    encodeStaticPngToWebp(syncPng, syncWebp);
    producedFiles.push(syncWebp);
    console.log(`[capture] Saved ${SCREENSHOT_FILENAMES.syncOverview} (${formatSizeKb(syncWebp)})`);

    // 2) Offline Box-Art Catalog (Green · PVM)
    await clickNavTab(staticPage, 'Catalog');
    await ensureCatalogGridVisible(staticPage);
    const catalogPng = path.join(tempWorkDir, 'catalog-grid.png');
    const catalogWebp = path.join(options.outDir, SCREENSHOT_FILENAMES.catalogGrid);
    await staticPage.screenshot({ path: catalogPng, fullPage: false });
    encodeStaticPngToWebp(catalogPng, catalogWebp);
    producedFiles.push(catalogWebp);
    console.log(`[capture] Saved ${SCREENSHOT_FILENAMES.catalogGrid} (${formatSizeKb(catalogWebp)})`);

    // 3) Game Detail Drawer (Green · PVM)
    await openFeaturedGameDrawer(staticPage, demoSeed?.featuredItemTitle);
    const drawerPng = path.join(tempWorkDir, 'game-detail-drawer.png');
    const drawerWebp = path.join(options.outDir, SCREENSHOT_FILENAMES.gameDetailDrawer);
    await staticPage.screenshot({ path: drawerPng, fullPage: false });
    encodeStaticPngToWebp(drawerPng, drawerWebp);
    producedFiles.push(drawerWebp);
    console.log(
      `[capture] Saved ${SCREENSHOT_FILENAMES.gameDetailDrawer} (${formatSizeKb(drawerWebp)})`,
    );

    // Close drawer cleanly before switching to Device Export
    await staticPage.locator('button[aria-label="Close game details"]').first().click();
    await staticPage.waitForTimeout(420);

    // 4) Direct-to-SD-Card Exporter (Warm Amber Phosphor Highlight · PVM)
    await clickNavTab(staticPage, 'Device Export');
    await staticPage.waitForTimeout(350);
    await switchPaletteViaCrtStudio(staticPage, 'amber', amberSettings);
    await staticPage.waitForTimeout(550);
    const exportPng = path.join(tempWorkDir, 'sd-card-exporter.png');
    const exportWebp = path.join(options.outDir, SCREENSHOT_FILENAMES.sdCardExporter);
    await staticPage.screenshot({ path: exportPng, fullPage: false });
    encodeStaticPngToWebp(exportPng, exportWebp);
    producedFiles.push(exportWebp);
    console.log(
      `[capture] Saved ${SCREENSHOT_FILENAMES.sdCardExporter} (${formatSizeKb(exportWebp)})`,
    );

    await staticContext.close();

    // ------------------------------------------------------------------
    // Phase 2: Record smooth continuous walkthrough video -> animated WebP
    // ------------------------------------------------------------------
    if (!options.skipVideo) {
      const videoDir = path.join(tempWorkDir, 'video');
      fs.mkdirSync(videoDir, { recursive: true });

      const videoContext = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        recordVideo: {
          dir: videoDir,
          size: VIEWPORT,
        },
      });
      await seedCaptureBrowserStorage(videoContext, greenSettings);

      const videoPage = await videoContext.newPage();
      if (isDemoMode && demoSeed) {
        await installDemoLiveTransferRoute(
          videoPage,
          demoSeed.featuredItemId,
          demoSeed.featuredItemTitle,
        );
      }

      // Scene 1 (~3.8s): Sync Overview with inline cover thumbnail, live Speed Wave & transfer telemetry
      await videoPage.goto(baseUrl!, { waitUntil: 'networkidle' });
      await videoPage.waitForTimeout(WALKTHROUGH_TIMINGS_MS.syncOverviewDwell);

      // Scene 2 (~3.5s): Box-Art Catalog Grid (pre-seeded directly in Grid view, no Table flash)
      await clickNavTab(videoPage, 'Catalog');
      await ensureCatalogGridVisible(videoPage);
      await videoPage.waitForTimeout(WALKTHROUGH_TIMINGS_MS.catalogGridDwell);

      // Scene 3 (~8.0s): Game Detail Drawer + in-drawer Screenshot Thumbnails (no full-res lightbox)
      await openFeaturedGameDrawer(videoPage, demoSeed?.featuredItemTitle);
      await videoPage.waitForTimeout(WALKTHROUGH_TIMINGS_MS.detailDrawerDwell);

      if (await scrollDrawerToScreenshots(videoPage)) {
        await videoPage.waitForTimeout(WALKTHROUGH_TIMINGS_MS.detailDrawerScreenshotsDwell);
      }

      const closeDrawerBtn = videoPage.locator('button[aria-label="Close game details"]').first();
      if (await closeDrawerBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await closeDrawerBtn.click();
        await videoPage.waitForTimeout(WALKTHROUGH_TIMINGS_MS.afterDrawerCloseDwell);
      }

      // Scene 4 (~7.3s): SD Card Exporter + legible CRT Display palette switch to warm Amber phosphor
      await clickNavTab(videoPage, 'Device Export');
      await videoPage.waitForTimeout(WALKTHROUGH_TIMINGS_MS.deviceExportPreThemeDwell);
      await switchPaletteViaCrtStudio(videoPage, 'amber', amberSettings, {
        openDwellMs: WALKTHROUGH_TIMINGS_MS.crtPopoverOpenDwell,
        selectedDwellMs: WALKTHROUGH_TIMINGS_MS.crtPaletteSelectedDwell,
        closeDwellMs: WALKTHROUGH_TIMINGS_MS.afterCrtPopoverCloseDwell,
      });
      await videoPage.waitForTimeout(WALKTHROUGH_TIMINGS_MS.deviceExportFinalDwell);

      const videoHandle = videoPage.video();
      await videoPage.close();
      const recordedWebm = videoHandle ? await videoHandle.path() : null;
      await videoContext.close();

      if (!recordedWebm || !fs.existsSync(recordedWebm)) {
        throw new Error('Playwright did not produce a walkthrough .webm video file.');
      }

      const walkthroughWebp = path.join(options.outDir, SCREENSHOT_FILENAMES.walkthrough);
      encodeWalkthroughVideoToWebp(recordedWebm, walkthroughWebp);
      producedFiles.unshift(walkthroughWebp);
      console.log(
        `[capture] Saved ${SCREENSHOT_FILENAMES.walkthrough} (${formatSizeKb(walkthroughWebp)})`,
      );
    }

    return producedFiles;
  } finally {
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
    await cleanup();
  }
}

async function main(): Promise<void> {
  const options = parseCaptureCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatCaptureUsage());
    return;
  }

  const files = await runScreenshotCapture(options);
  console.log(`\n[capture] Complete — wrote ${files.length} WebP preview asset(s) to ${options.outDir}`);
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectEntry) {
  main().catch((err) => {
    console.error(`\n[capture] Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
