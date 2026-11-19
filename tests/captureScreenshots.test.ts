import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { CRT_PRESETS } from '../src/shared/crtDisplay.ts';
import {
  renderDemoCoverPng,
  renderDemoScreenshotPng,
} from '../scripts/capture-screenshots/demoArtwork.ts';
import {
  buildCaptureCrtSettings,
  parseCaptureCliArgs,
} from '../scripts/capture-screenshots/options.ts';
import { seedDemoEnvironment } from '../scripts/capture-screenshots/seedDemoDb.ts';

test('parseCaptureCliArgs applies sensible defaults and honors CLI/env overrides', () => {
  const defaults = parseCaptureCliArgs([], {}, '/tmp/project');
  assert.equal(defaults.baseUrl, null);
  assert.equal(defaults.crtPreset, 'pvm');
  assert.equal(defaults.uiMotion, 'high');
  assert.equal(defaults.skipVideo, false);
  assert.equal(defaults.help, false);
  assert.equal(defaults.outDir, path.resolve('/tmp/project', 'docs', 'assets', 'screenshots'));

  const fromEnv = parseCaptureCliArgs(
    [],
    {
      CAPTURE_BASE_URL: 'http://localhost:3000/',
      CAPTURE_CRT_PRESET: 'bvm',
      CAPTURE_UI_MOTION: 'ultra',
      CAPTURE_SKIP_VIDEO: 'true',
      CAPTURE_OUT_DIR: 'custom/shots',
    },
    '/tmp/project',
  );
  assert.equal(fromEnv.baseUrl, 'http://localhost:3000');
  assert.equal(fromEnv.crtPreset, 'bvm');
  assert.equal(fromEnv.uiMotion, 'ultra');
  assert.equal(fromEnv.skipVideo, true);
  assert.equal(fromEnv.outDir, path.resolve('/tmp/project', 'custom', 'shots'));

  const cliOverrides = parseCaptureCliArgs(
    [
      '--url',
      'https://rgt.homelab.local:8443/',
      '--preset=arcade',
      '--motion',
      'medium',
      '--out-dir=./out',
      '--skip-video',
    ],
    { CAPTURE_BASE_URL: 'http://ignored:3000' },
    '/tmp/project',
  );
  assert.equal(cliOverrides.baseUrl, 'https://rgt.homelab.local:8443');
  assert.equal(cliOverrides.crtPreset, 'arcade');
  assert.equal(cliOverrides.uiMotion, 'medium');
  assert.equal(cliOverrides.skipVideo, true);
  assert.equal(cliOverrides.outDir, path.resolve('/tmp/project', 'out'));
});

test('parseCaptureCliArgs rejects malformed URLs, unknown flags, and invalid presets', () => {
  assert.throws(() => parseCaptureCliArgs(['--url', 'not-a-url'], {}), /Invalid --url/);
  assert.throws(() => parseCaptureCliArgs(['--url', 'ftp://example.com'], {}), /Unsupported URL/);
  assert.throws(() => parseCaptureCliArgs(['--preset', 'crt999'], {}), /Invalid --preset/);
  assert.throws(() => parseCaptureCliArgs(['--motion', 'hyper'], {}), /Invalid --motion/);
  assert.throws(() => parseCaptureCliArgs(['--bogus'], {}), /Unknown option/);
});

test('buildCaptureCrtSettings applies exact preset optical curves and Speed Wave sync', () => {
  const greenPvm = buildCaptureCrtSettings('green', 'pvm', 'high');
  assert.equal(greenPvm.enabled, true);
  assert.equal(greenPvm.palette, 'green');
  assert.equal(greenPvm.uiMotion, 'high');
  assert.equal(greenPvm.syncSpeedWave, true);
  assert.deepEqual(
    {
      scanlines: greenPvm.scanlines,
      gaussGlow: greenPvm.gaussGlow,
      vignette: greenPvm.vignette,
      apertureGrille: greenPvm.apertureGrille,
      chromaticAberration: greenPvm.chromaticAberration,
    },
    CRT_PRESETS.pvm.values,
  );

  const amberOff = buildCaptureCrtSettings('amber', 'subtle', 'off');
  assert.equal(amberOff.palette, 'amber');
  assert.equal(amberOff.syncSpeedWave, false);
});

test('demoArtwork renders valid PNG headers and dimensions for covers and widescreen screenshots', () => {
  const palette = {
    headerBg: [40, 30, 80] as [number, number, number],
    headerAccent: [140, 110, 255] as [number, number, number],
    skyTop: [12, 16, 40] as [number, number, number],
    skyBottom: [52, 28, 92] as [number, number, number],
    accent: [90, 230, 150] as [number, number, number],
    highlight: [255, 210, 90] as [number, number, number],
  };

  const coverPng = renderDemoCoverPng({
    title: 'Chrono Vanguard DX',
    consoleLabel: 'SNES',
    eraTag: '16-BIT',
    genreTag: 'RPG',
    regionTag: 'USA',
    palette,
    motif: 'rpg_citadel',
    seed: 101,
  });

  // Verify PNG magic signature and IHDR 360x480 dimensions
  assert.deepEqual(Array.from(coverPng.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(coverPng.readUInt32BE(16), 360);
  assert.equal(coverPng.readUInt32BE(20), 480);

  const shotPng = renderDemoScreenshotPng({
    title: 'Chrono Vanguard DX',
    consoleLabel: 'Super Nintendo',
    sceneIndex: 1,
    motif: 'rpg_citadel',
    palette,
    seed: 202,
  });
  assert.deepEqual(Array.from(shotPng.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(shotPng.readUInt32BE(16), 640);
  assert.equal(shotPng.readUInt32BE(20), 360);
});

test('seedDemoEnvironment creates an isolated migrated SQLite DB with artwork, telemetry, and trophies', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-sync-seed-test-'));
  try {
    const seeded = seedDemoEnvironment({
      rootDir: tmpRoot,
      now: new Date('2026-11-19T12:00:00Z'),
    });

    assert.ok(seeded.schemaVersion >= 19, `Expected schema >= v19, got v${seeded.schemaVersion}`);
    assert.ok(fs.existsSync(seeded.dbPath), 'Expected scraper.db to exist');
    assert.ok(seeded.seededSystems.length >= 12);
    assert.ok(seeded.seededReleases >= 20);
    assert.equal(seeded.seededRuns, 14);
    assert.ok(seeded.unlockedTrophies > 0, 'Expected baseline trophies unlocked');

    const db = new Database(seeded.dbPath, { readonly: true });
    try {
      const cfg = db.prepare('SELECT * FROM scraper_config WHERE id = 1').get() as Record<
        string,
        unknown
      >;
      assert.ok(cfg.last_authenticated_at, 'Demo DB must mark hasCompletedLogin via last_authenticated_at');
      assert.equal(cfg.password_enc, '', 'Demo DB must not store credentials that trigger live login');
      assert.equal(cfg.download_dir, seeded.downloadDir);

      const featured = db
        .prepare('SELECT * FROM catalog_releases WHERE id = ?')
        .get(seeded.featuredItemId) as Record<string, unknown>;
      assert.equal(featured.title, seeded.featuredItemTitle);
      assert.ok(
        typeof featured.cover_local_path === 'string' && fs.existsSync(featured.cover_local_path),
        'Featured release cover PNG must exist on disk',
      );
      const shots = JSON.parse(String(featured.screenshots_json || '[]')) as string[];
      assert.equal(shots.length, 3, 'Featured release must include 3 local screenshots');
      for (const shotPath of shots) {
        assert.ok(fs.existsSync(shotPath), `Expected screenshot file at ${shotPath}`);
      }

      const meta = JSON.parse(String(featured.metadata_json || '{}')) as {
        detailHydrated?: boolean;
        screenshotsFullResVersion?: number;
      };
      assert.equal(meta.detailHydrated, true);
      assert.equal(meta.screenshotsFullResVersion, 2);

      const installedCount = (
        db
          .prepare('SELECT COUNT(*) AS cnt FROM catalog_releases WHERE installed_at IS NOT NULL')
          .get() as { cnt: number }
      ).cnt;
      assert.ok(installedCount >= 5, 'Expected multiple releases marked Installed for catalog badges');

      const logCount = (
        db.prepare('SELECT COUNT(*) AS cnt FROM activity_logs').get() as { cnt: number }
      ).cnt;
      assert.ok(logCount >= 6, 'Expected seeded activity logs for Sync Overview');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
