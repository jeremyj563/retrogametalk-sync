import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeRemainingAutoDismissMs,
  DEFAULT_EPHEMERAL_EXIT_MS,
  REDUCED_MOTION_EXIT_MS,
  resolveEphemeralExitMs,
} from '../src/shared/ephemeralNotice';

test('computeRemainingAutoDismissMs returns full duration when just started', () => {
  const remaining = computeRemainingAutoDismissMs({
    durationMs: 4500,
    elapsedBeforeResumeMs: 0,
    resumedAtMs: 1000,
    nowMs: 1000,
  });
  assert.equal(remaining, 4500);
});

test('computeRemainingAutoDismissMs subtracts prior paused elapsed and active elapsed', () => {
  const remaining = computeRemainingAutoDismissMs({
    durationMs: 4500,
    elapsedBeforeResumeMs: 1200,
    resumedAtMs: 5000,
    nowMs: 6300,
  });
  assert.equal(remaining, 2000);
});

test('computeRemainingAutoDismissMs freezes remaining time while paused (resumedAtMs = null)', () => {
  const remaining = computeRemainingAutoDismissMs({
    durationMs: 3500,
    elapsedBeforeResumeMs: 1850,
    resumedAtMs: null,
    nowMs: 999999,
  });
  assert.equal(remaining, 1650);
});

test('computeRemainingAutoDismissMs clamps at zero when overdue', () => {
  const remaining = computeRemainingAutoDismissMs({
    durationMs: 3500,
    elapsedBeforeResumeMs: 2000,
    resumedAtMs: 1000,
    nowMs: 5000,
  });
  assert.equal(remaining, 0);
});

test('resolveEphemeralExitMs honors reduced motion and CRT motion off preferences', () => {
  assert.equal(
    resolveEphemeralExitMs(DEFAULT_EPHEMERAL_EXIT_MS, {
      prefersReducedMotion: false,
      crtMotionOff: false,
    }),
    DEFAULT_EPHEMERAL_EXIT_MS,
  );
  assert.equal(
    resolveEphemeralExitMs(DEFAULT_EPHEMERAL_EXIT_MS, {
      prefersReducedMotion: false,
      crtMotionOff: true,
    }),
    260,
  );
  assert.equal(
    resolveEphemeralExitMs(DEFAULT_EPHEMERAL_EXIT_MS, {
      prefersReducedMotion: true,
      crtMotionOff: false,
    }),
    REDUCED_MOTION_EXIT_MS,
  );
});
