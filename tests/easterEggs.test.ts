import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceKonamiProgress,
  buildCartridgeLabelPool,
  computePaddleBounceVelocity,
  formatCartridgeTag,
  generateStageBricks,
  KONAMI_SEQUENCE,
  matchSecretSearch,
  recordHeaderTap,
} from '../src/utils/easterEggs';

test('advanceKonamiProgress unlocks on exact Konami Code sequence (case-insensitive)', () => {
  let progress = 0;
  let unlocked = false;
  const keys = [
    'ArrowUp',
    'ArrowUp',
    'ArrowDown',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowLeft',
    'ArrowRight',
    'B',
    'A',
  ];

  for (let i = 0; i < keys.length; i += 1) {
    const step = advanceKonamiProgress(progress, keys[i]);
    progress = step.nextProgress;
    unlocked = step.unlocked;
    if (i < keys.length - 1) {
      assert.equal(unlocked, false);
      assert.equal(progress, i + 1);
    }
  }

  assert.equal(unlocked, true);
  assert.equal(progress, 0);
});

test('advanceKonamiProgress preserves longest prefix on extra leading ArrowUp presses', () => {
  let progress = 0;
  // Extra ArrowUp before the full sequence
  const keys = ['ArrowUp', ...KONAMI_SEQUENCE];
  let unlocked = false;

  for (const key of keys) {
    const step = advanceKonamiProgress(progress, key);
    progress = step.nextProgress;
    unlocked = step.unlocked;
  }

  assert.equal(unlocked, true);
  assert.equal(progress, 0);
});

test('advanceKonamiProgress resets on mismatched key', () => {
  let step = advanceKonamiProgress(0, 'ArrowUp');
  step = advanceKonamiProgress(step.nextProgress, 'ArrowUp');
  assert.equal(step.nextProgress, 2);

  step = advanceKonamiProgress(step.nextProgress, 'x');
  assert.equal(step.nextProgress, 0);
  assert.equal(step.unlocked, false);
});

test('matchSecretSearch detects classic Google-style tricks and protects casual typing', () => {
  assert.equal(matchSecretSearch('Atari Breakout'), 'breakout');
  assert.equal(matchSecretSearch('Space Invaders'), 'invaders');
  assert.equal(matchSecretSearch('Retro Invaders'), 'invaders');
  assert.equal(matchSecretSearch('Phosphor Snake'), 'snake');
  assert.equal(matchSecretSearch('Tetromino Drop'), 'tetromino');
  assert.equal(matchSecretSearch('Insert Coin'), 'arcade_launcher');
  assert.equal(matchSecretSearch('Multi Cart'), 'arcade_launcher');
  assert.equal(matchSecretSearch('  do a barrel roll! '), 'barrel_roll');
  assert.equal(matchSecretSearch('Z or R twice'), 'barrel_roll');
  assert.equal(matchSecretSearch('askew'), 'askew');
  assert.equal(matchSecretSearch('tilt'), 'askew');
  assert.equal(matchSecretSearch('blow cartridge'), 'blow_cartridge');
  assert.equal(matchSecretSearch('blow the cartridge'), 'blow_cartridge');
  assert.equal(matchSecretSearch('V-SYNC'), 'vsync_glitch');
  assert.equal(matchSecretSearch('v-sync'), 'vsync_glitch');
  assert.equal(matchSecretSearch('vsync'), 'vsync_glitch');
  assert.equal(matchSecretSearch('v sync'), 'vsync_glitch');
  assert.equal(matchSecretSearch('up up down down'), 'konami_breakout');

  // Single-word ambiguous terms only trigger on explicit Enter submit
  assert.equal(matchSecretSearch('breakout', { submitted: false }), null);
  assert.equal(matchSecretSearch('invaders', { submitted: false }), null);
  assert.equal(matchSecretSearch('snake', { submitted: false }), null);
  assert.equal(matchSecretSearch('tetris', { submitted: false }), null);
  assert.equal(matchSecretSearch('arcade', { submitted: false }), null);
  assert.equal(matchSecretSearch('konami', { submitted: false }), null);

  assert.equal(matchSecretSearch('breakout', { submitted: true }), 'breakout');
  assert.equal(matchSecretSearch('invaders', { submitted: true }), 'invaders');
  assert.equal(matchSecretSearch('snake', { submitted: true }), 'snake');
  assert.equal(matchSecretSearch('tetris', { submitted: true }), 'tetromino');
  assert.equal(matchSecretSearch('tetromino', { submitted: true }), 'tetromino');
  assert.equal(matchSecretSearch('arcade', { submitted: true }), 'arcade_launcher');
  assert.equal(matchSecretSearch('konami', { submitted: true }), 'konami_breakout');

  // Normal catalog searches never trigger
  assert.equal(matchSecretSearch('Super Metroid', { submitted: true }), null);
  assert.equal(matchSecretSearch('Castlevania', { submitted: true }), null);
  assert.equal(matchSecretSearch('Metal Gear Solid Snake', { submitted: true }), null);
});

test('recordHeaderTap triggers on 5 clicks within window and expires stale clicks', () => {
  let taps: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const res = recordHeaderTap(taps, 1000 + i * 300, 2500, 5);
    assert.equal(res.triggered, false);
    taps = res.nextTimestamps;
  }
  const fifth = recordHeaderTap(taps, 2400, 2500, 5);
  assert.equal(fifth.triggered, true);
  assert.deepEqual(fifth.nextTimestamps, []);

  // Expired window should not trigger
  let stale: number[] = [];
  stale = recordHeaderTap(stale, 1000, 2500, 5).nextTimestamps;
  stale = recordHeaderTap(stale, 1200, 2500, 5).nextTimestamps;
  const afterGap = recordHeaderTap(stale, 5000, 2500, 5);
  assert.equal(afterGap.triggered, false);
  assert.equal(afterGap.nextTimestamps.length, 1);
});

test('formatCartridgeTag & generateStageBricks produce valid multi-stage cartridge layouts', () => {
  assert.equal(formatCartridgeTag('snes-roms'), 'SNES');
  assert.equal(formatCartridgeTag('n64-roms'), 'N64');
  assert.equal(formatCartridgeTag('psx-roms'), 'PS1');
  assert.equal(formatCartridgeTag('dreamcast-roms'), 'DC');

  const pool = buildCartridgeLabelPool(['snes-roms', 'gba-roms', 'snes-roms']);
  assert.deepEqual(pool, ['SNES', 'GBA']);

  const stage1 = generateStageBricks(1, ['snes-roms', 'n64-roms']);
  assert.equal(stage1.stageName, 'Classic Cartridge Wall');
  assert.equal(stage1.bricks.length, 60);
  assert.ok(stage1.bricks.some((b) => b.maxHp === 2 && b.tier === 'armored'));
  assert.ok(stage1.bricks.every((b) => b.label === 'SNES' || b.label === 'N64'));

  const stage2 = generateStageBricks(2);
  assert.equal(stage2.stageName, 'Space Invader Mosaic');
  assert.ok(stage2.bricks.length > 20);

  const stage3 = generateStageBricks(3);
  assert.equal(stage3.stageName, 'Pyramid Vault');
  assert.ok(stage3.bricks.length > 20);

  const stage4 = generateStageBricks(4);
  assert.equal(stage4.stageName, 'Fortress Grid');
  assert.ok(stage4.bricks.length > 20);

  const stage5 = generateStageBricks(5);
  assert.equal(stage5.stageName, 'Classic Cartridge Wall');
  assert.ok(stage5.bricks[0].points > stage1.bricks[0].points);
});

test('computePaddleBounceVelocity preserves ball speed and clamps reflection angle', () => {
  const center = computePaddleBounceVelocity(0, 350);
  assert.ok(Math.abs(center.vx) < 1e-6);
  assert.ok(Math.abs(center.vy + 350) < 1e-6);

  const farRight = computePaddleBounceVelocity(3.5, 400);
  const mag = Math.hypot(farRight.vx, farRight.vy);
  assert.ok(Math.abs(mag - 400) < 1e-6);
  assert.ok(farRight.vx > 0);
  assert.ok(farRight.vy < -150, 'ball should never bounce nearly horizontally');

  const farLeft = computePaddleBounceVelocity(-1, 400);
  assert.ok(farLeft.vx < 0);
  assert.ok(farLeft.vy < -150);
});
