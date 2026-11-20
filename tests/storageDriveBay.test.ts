import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateFileSystemAccessSupport } from '../src/utils/sdCardFs.ts';
import { resolveStorageDriveBayState } from '../src/components/StorageDeviceSidebarDock.tsx';

test('evaluateFileSystemAccessSupport distinguishes Secure Context LAN HTTP from non-Chromium browsers', () => {
  const supported = evaluateFileSystemAccessSupport({
    hasWindow: true,
    isSecureContext: true,
    hasDirectoryPicker: true,
    origin: 'https://rgt.home.arpa',
  });
  assert.equal(supported.supported, true);
  assert.equal(supported.code, 'supported');

  const insecureLan = evaluateFileSystemAccessSupport({
    hasWindow: true,
    isSecureContext: false,
    hasDirectoryPicker: false,
    origin: 'http://192.168.11.11:8080',
  });
  assert.equal(insecureLan.supported, false);
  assert.equal(insecureLan.code, 'insecure_context');
  assert.match(insecureLan.reason || '', /http:\/\/192\.168\.11\.11:8080/);
  assert.match(insecureLan.reason || '', /unsafely-treat-insecure-origin-as-secure/);

  const nonChromium = evaluateFileSystemAccessSupport({
    hasWindow: true,
    isSecureContext: true,
    hasDirectoryPicker: false,
    origin: 'https://rgt.home.arpa',
  });
  assert.equal(nonChromium.supported, false);
  assert.equal(nonChromium.code, 'unsupported_browser');
  assert.match(nonChromium.reason || '', /Chrome, Edge, or another Chromium browser/);
});

test('resolveStorageDriveBayState maps mount, busy transfer, standby, and insecure HTTP states accurately', () => {
  assert.deepEqual(
    resolveStorageDriveBayState({
      hasMountedHandle: false,
      isBusy: false,
      support: { supported: true, code: 'supported' },
    }),
    {
      state: 'standby',
      statusLabel: 'Standby',
      ledMode: 'standby',
    },
  );

  assert.deepEqual(
    resolveStorageDriveBayState({
      hasMountedHandle: true,
      isBusy: false,
      support: { supported: true, code: 'supported' },
    }),
    {
      state: 'mounted',
      statusLabel: 'Mounted',
      ledMode: 'mounted',
    },
  );

  assert.deepEqual(
    resolveStorageDriveBayState({
      hasMountedHandle: true,
      isBusy: true,
      support: { supported: true, code: 'supported' },
    }),
    {
      state: 'writing',
      statusLabel: 'Writing',
      ledMode: 'writing',
    },
  );

  assert.deepEqual(
    resolveStorageDriveBayState({
      hasMountedHandle: false,
      isBusy: false,
      support: { supported: false, code: 'insecure_context' },
    }),
    {
      state: 'insecure_context',
      statusLabel: 'HTTPS Req',
      ledMode: 'warning',
    },
  );

  assert.deepEqual(
    resolveStorageDriveBayState({
      hasMountedHandle: false,
      isBusy: false,
      support: { supported: false, code: 'unsupported_browser' },
    }),
    {
      state: 'unsupported_browser',
      statusLabel: 'Unsupported',
      ledMode: 'standby',
    },
  );
});
