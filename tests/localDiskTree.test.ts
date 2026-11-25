import assert from 'node:assert/strict';
import test from 'node:test';
import type { FsTreeNode } from '../src/types';
import {
  classifyDiskEntry,
  getParentDiskPath,
  isAncestorDiskPath,
  resolveDiskNavigationScrollTop,
  sortDiskTreeNodes,
  summarizeDiskTreeNodes,
} from '../src/utils/localDiskTree';

function makeNode(overrides: Partial<FsTreeNode> & Pick<FsTreeNode, 'name' | 'type'>): FsTreeNode {
  return {
    relativePath: overrides.relativePath ?? overrides.name,
    sizeBytes: overrides.sizeBytes ?? 0,
    modifiedAt: overrides.modifiedAt ?? '2026-11-24T12:00:00.000Z',
    ...overrides,
  };
}

test('getParentDiskPath resolves nested, top-level, and root paths cleanly', () => {
  assert.equal(getParentDiskPath(''), null);
  assert.equal(getParentDiskPath('/'), null);
  assert.equal(getParentDiskPath('snes-rom'), '');
  assert.equal(getParentDiskPath('snes-rom/Chrono Trigger'), 'snes-rom');
  assert.equal(getParentDiskPath('/snes-rom/Chrono Trigger/'), 'snes-rom');
});

test('isAncestorDiskPath detects true ancestors without false prefix matches', () => {
  assert.equal(isAncestorDiskPath('', 'snes-rom'), true);
  assert.equal(isAncestorDiskPath('snes-rom', 'snes-rom/Chrono Trigger'), true);
  assert.equal(isAncestorDiskPath('snes', 'snes-rom'), false);
  assert.equal(isAncestorDiskPath('snes-rom', 'snes-rom'), false);
  assert.equal(isAncestorDiskPath('snes-rom/Chrono Trigger', 'snes-rom'), false);
});

test('resolveDiskNavigationScrollTop resets to 0 on child drill-in and restores parent offset on up-navigation', () => {
  const saved = new Map<string, number>([
    ['', 420],
    ['snes-rom', 1840],
    ['snes-rom/Chrono Trigger', 120],
  ]);

  // Drilling down from snes-rom -> child always resets to 0 even if child was visited before
  assert.equal(
    resolveDiskNavigationScrollTop({
      fromPath: 'snes-rom',
      toPath: 'snes-rom/Chrono Trigger',
      savedScrollByPath: saved,
    }),
    0,
  );

  // Navigating up from child -> parent restores parent's exact saved scroll offset
  assert.equal(
    resolveDiskNavigationScrollTop({
      fromPath: 'snes-rom/Chrono Trigger',
      toPath: 'snes-rom',
      savedScrollByPath: saved,
    }),
    1840,
  );

  // Jumping all the way back to root restores root scroll offset
  assert.equal(
    resolveDiskNavigationScrollTop({
      fromPath: 'snes-rom/Chrono Trigger',
      toPath: '',
      savedScrollByPath: saved,
    }),
    420,
  );

  // Switching to a sibling resets to 0
  assert.equal(
    resolveDiskNavigationScrollTop({
      fromPath: 'snes-rom',
      toPath: 'gba-roms',
      savedScrollByPath: saved,
    }),
    0,
  );
});

test('sortDiskTreeNodes keeps directories ahead of files and sorts by name, size, and modified', () => {
  const nodes: FsTreeNode[] = [
    makeNode({ name: 'zeta.sfc', type: 'file', sizeBytes: 100, modifiedAt: '2026-11-20T00:00:00Z' }),
    makeNode({ name: 'alpha.zip', type: 'file', sizeBytes: 900, modifiedAt: '2026-11-24T00:00:00Z' }),
    makeNode({ name: 'gba-roms', type: 'directory', childrenCount: 40, modifiedAt: '2026-11-21T00:00:00Z' }),
    makeNode({ name: 'snes-rom', type: 'directory', childrenCount: 120, modifiedAt: '2026-11-23T00:00:00Z' }),
  ];

  assert.deepEqual(
    sortDiskTreeNodes(nodes, 'name', 'asc').map((n) => n.name),
    ['gba-roms', 'snes-rom', 'alpha.zip', 'zeta.sfc'],
  );

  assert.deepEqual(
    sortDiskTreeNodes(nodes, 'size', 'desc').map((n) => n.name),
    ['snes-rom', 'gba-roms', 'alpha.zip', 'zeta.sfc'],
  );

  assert.deepEqual(
    sortDiskTreeNodes(nodes, 'modified', 'desc').map((n) => n.name),
    ['snes-rom', 'gba-roms', 'alpha.zip', 'zeta.sfc'],
  );
});

test('classifyDiskEntry and summarizeDiskTreeNodes produce accurate labels and totals', () => {
  const nodes: FsTreeNode[] = [
    makeNode({ name: 'snes-rom', type: 'directory', childrenCount: 3 }),
    makeNode({ name: 'game.7z', type: 'file', sizeBytes: 2048, isArchive: true, archiveFormat: '7z' }),
    makeNode({ name: 'patch.bps', type: 'file', sizeBytes: 512 }),
    makeNode({ name: 'Super Metroid.sfc', type: 'file', sizeBytes: 4096 }),
  ];

  assert.deepEqual(classifyDiskEntry(nodes[0]), {
    kind: 'directory',
    label: '3 items',
    browsableArchive: false,
  });
  assert.deepEqual(classifyDiskEntry(nodes[1]), {
    kind: 'archive',
    label: '7Z archive',
    browsableArchive: true,
  });
  assert.deepEqual(classifyDiskEntry(nodes[2]), {
    kind: 'patch',
    label: 'BPS patch',
    browsableArchive: false,
  });
  assert.deepEqual(classifyDiskEntry(nodes[3]), {
    kind: 'rom',
    label: 'SNES ROM',
    browsableArchive: false,
  });

  assert.deepEqual(summarizeDiskTreeNodes(nodes), {
    folderCount: 1,
    fileCount: 3,
    totalFileBytes: 6656,
    totalChildEntries: 3,
  });
});
