import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  APP_AUTH_COOKIE_NAME,
  AppAuthManager,
  SlidingWindowRateLimiter,
  buildSessionCookieHeader,
  parseCookieHeader,
  verifyCsrfProtection,
} from '../src/server/appAuth.ts';
import {
  CONFIG_BACKUP_SCHEMA_VERSION,
  buildConfigBackupSnapshot,
  parseAndValidateConfigBackup,
} from '../src/shared/configBackup.ts';
import { createDefaultStorageFolderConfig } from '../src/shared/storageFolderMappings.ts';
import type { ScraperConfigPublic } from '../src/server/types.ts';

function makeSampleConfig(overrides: Partial<ScraperConfigPublic> = {}): ScraperConfigPublic {
  return {
    baseUrl: 'https://retrogametalk.com/repo/',
    loginUrl: 'https://retrogametalk.com/login/login',
    username: 'collector',
    password: '',
    hasPassword: true,
    dataDir: '/tmp/rgt-data',
    downloadDir: '/tmp/rgt-roms',
    minFreeDiskGb: 2,
    cronSchedule: '0 */6 * * *',
    scheduleEnabled: true,
    baseDelayMs: 1500,
    minDelayMs: 650,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    maxRetries: 5,
    maxConcurrency: 1,
    downloadChunkConcurrency: 1,
    downloadChunkMinSizeMb: 32,
    requestTimeoutMs: 30000,
    userAgent: 'RetroGameTalkSync/1.33.0',
    systemFilter: 'snes-rom,gba-roms',
    allowedReleaseTypes: ['hack', 'translation_en'],
    discoveredSystems: ['snes-rom', 'gba-roms', 'nes-roms'],
    lastWatermarkAt: null,
    romNamingTemplate: '{title}{regionParen}{tagBracket}',
    romSanitizeFat32: true,
    romMaxFilenameLen: 0,
    storageFolderConfig: createDefaultStorageFolderConfig(),
    autoDownloadNewReleases: true,
    updatedAt: '2026-11-22T20:00:00.000Z',
    envOverrides: [],
    ...overrides,
  };
}

test('SQLite getPublicConfig never leaks password and updateConfig preserves secret unless clearPassword is true', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-sec-db-'));
  const dataDir = path.join(tmpDir, 'data');
  const downloadDir = path.join(tmpDir, 'roms');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  const prevDataDir = process.env.DATA_DIR;
  const prevDownloadDir = process.env.DOWNLOAD_DIR;
  const prevRgtPassword = process.env.RGT_PASSWORD;

  process.env.DATA_DIR = dataDir;
  process.env.DOWNLOAD_DIR = downloadDir;
  delete process.env.RGT_PASSWORD;

  try {
    const db = await import('../src/server/db.ts');
    db.initDb();

    // 1. Save a real password
    const afterSave = db.updateConfig({
      username: 'retro-tester',
      password: 'SuperSecretPassword!42',
    });
    assert.equal(afterSave.password, '', 'PUT /api/config response must never return plaintext password');
    assert.equal(afterSave.hasPassword, true, 'hasPassword should be true when stored');
    assert.equal(db.getInternalConfig().password, 'SuperSecretPassword!42');
    assert.equal(db.getPublicConfig().password, '');
    assert.equal(db.getPublicConfig().hasPassword, true);

    // 2. Updating unrelated settings or sending empty string password must preserve stored password
    const afterEmptyUpdate = db.updateConfig({
      username: 'retro-tester-2',
      password: '',
    });
    assert.equal(afterEmptyUpdate.password, '');
    assert.equal(afterEmptyUpdate.hasPassword, true);
    assert.equal(db.getInternalConfig().password, 'SuperSecretPassword!42');

    const afterOmittedUpdate = db.updateConfig({
      maxRetries: 7,
    });
    assert.equal(afterOmittedUpdate.password, '');
    assert.equal(afterOmittedUpdate.hasPassword, true);
    assert.equal(db.getInternalConfig().password, 'SuperSecretPassword!42');

    // 3. Explicit clearPassword: true clears the stored password
    const afterClear = db.updateConfig({ clearPassword: true });
    assert.equal(afterClear.password, '');
    assert.equal(afterClear.hasPassword, false);
    assert.equal(db.getInternalConfig().password, '');

    // 4. Even when RGT_PASSWORD env var is set, getPublicConfig() masks it
    process.env.RGT_PASSWORD = 'EnvInjectedSecretPassword';
    const envPublic = db.getPublicConfig();
    assert.equal(envPublic.password, '');
    assert.equal(envPublic.hasPassword, true);
    assert.ok(envPublic.envOverrides.includes('RGT_PASSWORD'));
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevDownloadDir === undefined) delete process.env.DOWNLOAD_DIR;
    else process.env.DOWNLOAD_DIR = prevDownloadDir;
    if (prevRgtPassword === undefined) delete process.env.RGT_PASSWORD;
    else process.env.RGT_PASSWORD = prevRgtPassword;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AppAuthManager is disabled by default when APP_AUTH_PASSWORD is empty', () => {
  const auth = new AppAuthManager({ password: '', username: '' });
  assert.equal(auth.isEnabled(), false);
  assert.equal(auth.isUsernameRequired(), false);
  const status = auth.getStatus({ headers: {} });
  assert.deepEqual(status, {
    enabled: false,
    authenticated: true,
    usernameRequired: false,
  });
});

test('AppAuthManager verifies credentials, signs/verifies HMAC cookies, rejects tampering and expiry', () => {
  let fakeNow = 1_700_000_000_000;
  const auth = new AppAuthManager({
    password: 'correct-horse-battery',
    username: 'operator',
    sessionSecret: 'unit-test-signing-key',
    sessionTtlMs: 120_000,
    now: () => fakeNow,
  });

  assert.equal(auth.isEnabled(), true);
  assert.equal(auth.isUsernameRequired(), true);
  assert.equal(auth.verifyCredentials('operator', 'correct-horse-battery'), true);
  assert.equal(auth.verifyCredentials('wrong-user', 'correct-horse-battery'), false);
  assert.equal(auth.verifyCredentials('operator', 'wrong-pass'), false);
  assert.equal(auth.verifyCredentials('operator', ''), false);

  const token = auth.issueSessionToken();
  assert.equal(auth.verifySessionToken(token), true);
  assert.equal(
    auth.isRequestAuthenticated({ headers: { cookie: `${APP_AUTH_COOKIE_NAME}=${token}` } }),
    true,
  );

  // Tampered signature must fail
  const tampered = `${token.slice(0, -2)}aa`;
  assert.equal(auth.verifySessionToken(tampered), false);

  // Expired token must fail
  fakeNow += 121_000;
  assert.equal(auth.verifySessionToken(token), false);
});

test('AppAuthManager invalidates existing session cookies when configured password rotates', () => {
  const authBefore = new AppAuthManager({
    password: 'old-password',
    sessionSecret: 'shared-secret',
  });
  const token = authBefore.issueSessionToken();

  const authAfter = new AppAuthManager({
    password: 'new-password',
    sessionSecret: 'shared-secret',
  });
  assert.equal(authAfter.verifySessionToken(token), false);
});

test('SlidingWindowRateLimiter enforces brute-force thresholds and recovers after window elapses', () => {
  let fakeNow = 1_000_000;
  const limiter = new SlidingWindowRateLimiter(3, 60_000, () => fakeNow);

  assert.equal(limiter.check('10.0.0.5').allowed, true);
  assert.equal(limiter.recordFailure('10.0.0.5').allowed, true);
  assert.equal(limiter.recordFailure('10.0.0.5').allowed, true);
  const third = limiter.recordFailure('10.0.0.5');
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSec >= 59 && third.retryAfterSec <= 60);

  // Different IP remains unaffected
  assert.equal(limiter.check('10.0.0.6').allowed, true);

  // Advance past sliding window
  fakeNow += 61_000;
  assert.equal(limiter.check('10.0.0.5').allowed, true);
});

test('Cookie helpers and CSRF protection enforce secure attributes and same-origin rules', () => {
  const httpsCookie = buildSessionCookieHeader('tok.sig', { secure: true, maxAgeSec: 3600 });
  assert.ok(httpsCookie.includes('HttpOnly'));
  assert.ok(httpsCookie.includes('Secure'));
  assert.ok(httpsCookie.includes('SameSite=None'));
  assert.ok(httpsCookie.includes('Partitioned'));

  const lanHttpCookie = buildSessionCookieHeader('tok.sig', { secure: false, maxAgeSec: 3600 });
  assert.ok(lanHttpCookie.includes('HttpOnly'));
  assert.ok(lanHttpCookie.includes('SameSite=Lax'));
  assert.equal(lanHttpCookie.includes('Secure'), false);

  const parsed = parseCookieHeader(`foo=bar; ${APP_AUTH_COOKIE_NAME}=abc%2Edef`);
  assert.equal(parsed[APP_AUTH_COOKIE_NAME], 'abc.def');

  // CSRF rules
  assert.equal(verifyCsrfProtection({ method: 'GET', headers: {} }), true);
  assert.equal(
    verifyCsrfProtection({
      method: 'POST',
      headers: { host: 'rgt.local:3000', origin: 'http://rgt.local:3000' },
    }),
    true,
  );
  assert.equal(
    verifyCsrfProtection({
      method: 'POST',
      headers: { host: 'rgt.local:3000', origin: 'https://evil.example' },
    }),
    false,
  );
  assert.equal(
    verifyCsrfProtection({
      method: 'DELETE',
      headers: { host: 'rgt.local:3000', 'x-requested-with': 'rgt-sync' },
    }),
    true,
  );
  assert.equal(
    verifyCsrfProtection({
      method: 'POST',
      headers: { host: 'rgt.local:3000' },
    }),
    false,
  );
});

test('Config backup export excludes all secrets and import validates, diffs, and skips env-locked keys', () => {
  const current = makeSampleConfig({
    envOverrides: ['SCRAPER_CRON', 'SCRAPER_MAX_RETRIES'],
  });
  const snapshot = buildConfigBackupSnapshot(current, '1.33.0', '2026-11-22T21:00:00.000Z');
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.schemaVersion, CONFIG_BACKUP_SCHEMA_VERSION);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('collector'), false);
  assert.equal(serialized.includes('/tmp/rgt-roms'), false);
  assert.equal(serialized.includes('/tmp/rgt-data'), false);

  // Round-trip against identical config produces 0 changes
  const roundTrip = parseAndValidateConfigBackup(snapshot, current);
  assert.equal(roundTrip.valid, true);
  if (roundTrip.valid) {
    assert.equal(roundTrip.changes.length, 0);
    assert.equal(roundTrip.appliedFields.length, 0);
  }

  // Modified backup updates unlocked fields and skips env-locked fields
  const modified = structuredClone(snapshot);
  modified.settings.syncRules.systemFilter = 'nes-roms,snes-rom,ps1-roms';
  modified.settings.syncRules.cronSchedule = '0 */12 * * *'; // env-locked via SCRAPER_CRON
  modified.settings.pacing.maxRetries = 10; // env-locked via SCRAPER_MAX_RETRIES
  modified.settings.pacing.baseDelayMs = 2200; // unlocked
  modified.settings.deviceExport.romNamingTemplate = '{title} ({region})';

  const result = parseAndValidateConfigBackup(modified, current);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.patch.systemFilter, 'nes-roms,snes-rom,ps1-roms');
    assert.equal(result.patch.baseDelayMs, 2200);
    assert.equal(result.patch.romNamingTemplate, '{title} ({region})');
    assert.equal(result.patch.cronSchedule, undefined);
    assert.equal(result.patch.maxRetries, undefined);
    assert.deepEqual(
      result.skippedEnvLocked.map((s) => s.envVar).sort(),
      ['SCRAPER_CRON', 'SCRAPER_MAX_RETRIES'],
    );
  }

  // Rejects bad schema version and disallowed secret keys
  const badVersion = parseAndValidateConfigBackup({ schemaVersion: 99, settings: {} }, current);
  assert.equal(badVersion.valid, false);

  const injectedSecret = parseAndValidateConfigBackup(
    {
      schemaVersion: 1,
      settings: { password: 'leaked', syncRules: snapshot.settings.syncRules },
    },
    current,
  );
  assert.equal(injectedSecret.valid, false);
});
