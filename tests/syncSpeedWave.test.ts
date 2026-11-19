import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSyncSpeedWaveParams,
  DEFAULT_CRT_DISPLAY_SETTINGS,
  isSyncSpeedWaveActive,
  normalizeDownloadSpeedRatio,
} from '../src/shared/crtDisplay.ts';

test('syncSpeedWave defaults enabled and requires Living UI Motion Low or higher', () => {
  assert.equal(DEFAULT_CRT_DISPLAY_SETTINGS.syncSpeedWave, true);
  assert.equal(isSyncSpeedWaveActive({ uiMotion: 'off', syncSpeedWave: true }), false);
  assert.equal(isSyncSpeedWaveActive({ uiMotion: 'low', syncSpeedWave: false }), false);
  assert.equal(isSyncSpeedWaveActive({ uiMotion: 'ultra', syncSpeedWave: false }), false);
  assert.equal(isSyncSpeedWaveActive({ uiMotion: 'low', syncSpeedWave: true }), true);
  assert.equal(isSyncSpeedWaveActive({ uiMotion: 'medium', syncSpeedWave: true }), true);
  assert.equal(isSyncSpeedWaveActive({ uiMotion: 'high', syncSpeedWave: true }), true);
  assert.equal(isSyncSpeedWaveActive({ uiMotion: 'ultra', syncSpeedWave: true }), true);
});

test('normalizeDownloadSpeedRatio maps throughput logarithmically into [0, 1]', () => {
  assert.equal(normalizeDownloadSpeedRatio(-100), 0);
  assert.equal(normalizeDownloadSpeedRatio(0), 0);
  assert.equal(normalizeDownloadSpeedRatio(Number.NaN), 0);

  const kb256 = normalizeDownloadSpeedRatio(256 * 1024);
  const mb1 = normalizeDownloadSpeedRatio(1 * 1024 * 1024);
  const mb5 = normalizeDownloadSpeedRatio(5 * 1024 * 1024);
  const mb20 = normalizeDownloadSpeedRatio(20 * 1024 * 1024);
  const mb60 = normalizeDownloadSpeedRatio(60 * 1024 * 1024);

  assert.ok(kb256 > 0 && kb256 < mb1);
  assert.ok(mb1 < mb5 && mb5 < mb20 && mb20 <= mb60);
  assert.equal(mb60, 1);
});

test('computeSyncSpeedWaveParams accelerates frequency & tightens bar duration as speed rises', () => {
  const idle = computeSyncSpeedWaveParams(0, 'medium', true);
  const slow = computeSyncSpeedWaveParams(512 * 1024, 'medium', true);
  const fast = computeSyncSpeedWaveParams(12 * 1024 * 1024, 'medium', true);
  const burst = computeSyncSpeedWaveParams(40 * 1024 * 1024, 'medium', true);

  assert.equal(idle.active, true);
  assert.ok(idle.frequencyHz < slow.frequencyHz);
  assert.ok(slow.frequencyHz < fast.frequencyHz);
  assert.ok(fast.frequencyHz < burst.frequencyHz);

  assert.ok(idle.spatialCycles < slow.spatialCycles);
  assert.ok(slow.spatialCycles < fast.spatialCycles);
  assert.ok(fast.spatialCycles < burst.spatialCycles);

  assert.ok(idle.progressWaveDurationSec > slow.progressWaveDurationSec);
  assert.ok(slow.progressWaveDurationSec > fast.progressWaveDurationSec);
  assert.ok(fast.progressWaveDurationSec > burst.progressWaveDurationSec);
});

test('computeSyncSpeedWaveParams scales across Living UI Motion tiers and disables cleanly', () => {
  const speed = 8 * 1024 * 1024;

  const offMotion = computeSyncSpeedWaveParams(speed, 'off', true);
  assert.equal(offMotion.active, false);
  assert.equal(offMotion.frequencyHz, 0);

  const independentOff = computeSyncSpeedWaveParams(speed, 'ultra', false);
  assert.equal(independentOff.active, false);
  assert.equal(independentOff.frequencyHz, 0);

  const low = computeSyncSpeedWaveParams(speed, 'low', true);
  const med = computeSyncSpeedWaveParams(speed, 'medium', true);
  const high = computeSyncSpeedWaveParams(speed, 'high', true);
  const ultra = computeSyncSpeedWaveParams(speed, 'ultra', true);

  assert.equal(low.harmonicOpacity, 0);
  assert.ok(med.harmonicOpacity > 0);
  assert.ok(high.harmonicOpacity > med.harmonicOpacity);
  assert.ok(ultra.harmonicOpacity > high.harmonicOpacity);

  assert.ok(low.primaryOpacity < med.primaryOpacity);
  assert.ok(med.primaryOpacity < high.primaryOpacity);
  assert.ok(high.primaryOpacity < ultra.primaryOpacity);

  assert.ok(low.glowPx < med.glowPx && med.glowPx < high.glowPx && high.glowPx < ultra.glowPx);
});
