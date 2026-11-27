import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractGamePlatformSlugsFromWpTypes,
  resolveSystemDisplayInfo,
} from '../src/shared/systemCatalog';
import { resolveDefaultSystemFolder } from '../src/shared/storageFolderMappings';

const SAMPLE_WP_TYPES_PAYLOAD = {
  post: { slug: 'post', rest_base: 'posts', has_archive: false, taxonomies: ['category', 'post_tag'] },
  page: { slug: 'page', rest_base: 'pages', has_archive: false, taxonomies: [] },
  attachment: { slug: 'attachment', rest_base: 'media', has_archive: false, taxonomies: [] },
  wp_block: { slug: 'wp_block', rest_base: 'blocks', has_archive: false, taxonomies: ['wp_pattern_category'] },
  emulator: { slug: 'emulator', rest_base: 'emulator', has_archive: true, taxonomies: ['category'] },
  amiga: {
    slug: 'amiga',
    rest_base: 'amiga',
    has_archive: true,
    taxonomies: ['category', 'developer', 'genre', 'region', 'release-year'],
  },
  'sega-pico': {
    slug: 'sega-pico',
    rest_base: 'sega-pico',
    has_archive: true,
    taxonomies: ['category', 'developer', 'genre', 'region', 'release-year'],
  },
  gb_roms: {
    slug: 'gb_roms',
    rest_base: 'gb_roms',
    has_archive: true,
    taxonomies: ['category', 'genre', 'region'],
  },
  'gcn-iso': {
    slug: 'gcn-iso',
    rest_base: 'gcn-iso',
    has_archive: true,
    taxonomies: ['category', 'genre', 'region'],
  },
  psx2psp: {
    slug: 'psx2psp',
    rest_base: 'psx2psp',
    has_archive: true,
    taxonomies: ['category', 'genre', 'region'],
  },
  msdos: {
    slug: 'msdos',
    rest_base: 'msdos',
    has_archive: true,
    taxonomies: ['category', 'genre', 'region', 'system'],
  },
  windows: {
    slug: 'windows',
    rest_base: 'windows',
    has_archive: true,
    taxonomies: ['category', 'genre', 'region', 'system'],
  },
};

test('extractGamePlatformSlugsFromWpTypes discovers amiga, sega-pico, msdos, windows and canonicalizes aliases', () => {
  const platforms = extractGamePlatformSlugsFromWpTypes(SAMPLE_WP_TYPES_PAYLOAD);

  assert.deepEqual(platforms, [
    'amiga',
    'gameboy-roms',
    'gamecube',
    'msdos',
    'psx2psp-eboots',
    'sega-pico',
    'windows',
  ]);
});

test('extractGamePlatformSlugsFromWpTypes excludes built-in WordPress types and utility CPTs like emulator', () => {
  const platforms = extractGamePlatformSlugsFromWpTypes(SAMPLE_WP_TYPES_PAYLOAD);

  assert.ok(!platforms.includes('post'));
  assert.ok(!platforms.includes('posts'));
  assert.ok(!platforms.includes('page'));
  assert.ok(!platforms.includes('pages'));
  assert.ok(!platforms.includes('emulator'));
  assert.ok(!platforms.includes('gb_roms'));
  assert.ok(!platforms.includes('gcn-iso'));
  assert.ok(!platforms.includes('psx2psp'));
});

test('extractGamePlatformSlugsFromWpTypes safely handles null, array, and malformed inputs', () => {
  assert.deepEqual(extractGamePlatformSlugsFromWpTypes(null), []);
  assert.deepEqual(extractGamePlatformSlugsFromWpTypes([]), []);
  assert.deepEqual(extractGamePlatformSlugsFromWpTypes('invalid'), []);
});

test('amiga, sega-pico, msdos, and windows have explicit display names, brand groups, and default storage folders', () => {
  const amiga = resolveSystemDisplayInfo('amiga');
  assert.equal(amiga.displayName, 'Commodore Amiga');
  assert.equal(amiga.brandId, 'arcade_computers');
  assert.equal(resolveDefaultSystemFolder('amiga'), 'AMIGA');

  const pico = resolveSystemDisplayInfo('sega-pico');
  assert.equal(pico.displayName, 'Sega Pico');
  assert.equal(pico.brandId, 'sega');
  assert.equal(resolveDefaultSystemFolder('sega-pico'), 'PICO');

  const msdos = resolveSystemDisplayInfo('msdos');
  assert.equal(msdos.displayName, 'MS-DOS / PC');
  assert.equal(msdos.brandId, 'arcade_computers');
  assert.equal(resolveDefaultSystemFolder('msdos'), 'DOS');

  const windows = resolveSystemDisplayInfo('windows');
  assert.equal(windows.displayName, 'Microsoft Windows / PC');
  assert.equal(windows.brandId, 'arcade_computers');
  assert.equal(resolveDefaultSystemFolder('windows'), 'WINDOWS');
});
