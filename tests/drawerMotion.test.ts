import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getDrawerCloseDurationMs,
  resolveDrawerSwapDirection,
} from '../src/utils/drawerMotion.ts';

test('resolveDrawerSwapDirection returns none on initial open or same-item metadata updates', () => {
  assert.equal(
    resolveDrawerSwapDirection({
      pendingDirection: 'next',
      prevItemId: null,
      nextItemId: 42,
      prevIndex: null,
      nextIndex: 1,
      wasOpen: false,
    }),
    'none',
  );

  assert.equal(
    resolveDrawerSwapDirection({
      pendingDirection: 'none',
      prevItemId: 42,
      nextItemId: 42,
      prevIndex: 3,
      nextIndex: 3,
      wasOpen: true,
    }),
    'none',
  );

  assert.equal(
    resolveDrawerSwapDirection({
      pendingDirection: 'prev',
      prevItemId: 42,
      nextItemId: 99,
      prevIndex: 3,
      nextIndex: 4,
      wasOpen: false,
    }),
    'none',
  );
});

test('resolveDrawerSwapDirection prefers explicit prev/next triggers and falls back to navigation index delta', () => {
  assert.equal(
    resolveDrawerSwapDirection({
      pendingDirection: 'prev',
      prevItemId: 10,
      nextItemId: 9,
      prevIndex: 5,
      nextIndex: 4,
      wasOpen: true,
    }),
    'prev',
  );

  assert.equal(
    resolveDrawerSwapDirection({
      pendingDirection: 'next',
      prevItemId: 10,
      nextItemId: 11,
      prevIndex: 5,
      nextIndex: 1, // explicit direction wins even on wrap-around
      wasOpen: true,
    }),
    'next',
  );

  assert.equal(
    resolveDrawerSwapDirection({
      pendingDirection: 'none',
      prevItemId: 10,
      nextItemId: 12,
      prevIndex: 5,
      nextIndex: 6,
      wasOpen: true,
    }),
    'next',
  );

  assert.equal(
    resolveDrawerSwapDirection({
      pendingDirection: 'none',
      prevItemId: 12,
      nextItemId: 10,
      prevIndex: 6,
      nextIndex: 5,
      wasOpen: true,
    }),
    'prev',
  );
});

test('getDrawerCloseDurationMs matches active Living UI Motion tier and OS reduced-motion preference', () => {
  assert.equal(getDrawerCloseDurationMs('low', false), 290);
  assert.equal(getDrawerCloseDurationMs('ultra', false), 290);
  assert.equal(getDrawerCloseDurationMs(null, false), 290);
  assert.equal(getDrawerCloseDurationMs('off', false), 200);
  assert.equal(getDrawerCloseDurationMs('low', true), 110);
  assert.equal(getDrawerCloseDurationMs('off', true), 110);
});
