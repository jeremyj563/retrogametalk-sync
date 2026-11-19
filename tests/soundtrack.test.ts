import test from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENT_REWARDS } from '../src/shared/achievementRewards.ts';
import { ACHIEVEMENT_CATALOG } from '../src/shared/achievements.ts';
import {
  clampMusicVolume,
  getUnlockedTracks,
  isMusicTrackUnlocked,
  isValidMusicTrackId,
  isValidPlaybackMode,
  type MusicTrackId,
  pickNextTrackId,
  resolveEffectiveTrackId,
  SOUNDTRACK_TRACKS,
  STARTER_TRACK_ID,
} from '../src/shared/soundtrack.ts';

const MAX_TROPHY_POINTS = ACHIEVEMENT_CATALOG.reduce((sum, item) => sum + item.points, 0);

test('Soundtrack roster has 1 starter track and 6 monotonically ascending milestone unlocks', () => {
  assert.equal(SOUNDTRACK_TRACKS.length, 7);
  assert.equal(SOUNDTRACK_TRACKS[0].id, STARTER_TRACK_ID);
  assert.equal(SOUNDTRACK_TRACKS[0].requiredPoints, 0);

  for (let i = 1; i < SOUNDTRACK_TRACKS.length; i += 1) {
    assert.ok(
      SOUNDTRACK_TRACKS[i].requiredPoints > SOUNDTRACK_TRACKS[i - 1].requiredPoints,
      `Track ${SOUNDTRACK_TRACKS[i].id} requiredPoints must exceed previous track`,
    );
    assert.ok(SOUNDTRACK_TRACKS[i].bpm >= 80 && SOUNDTRACK_TRACKS[i].bpm <= 160);
  }

  assert.ok(
    SOUNDTRACK_TRACKS[SOUNDTRACK_TRACKS.length - 1].requiredPoints <= MAX_TROPHY_POINTS,
    'Highest soundtrack unlock must be reachable within total achievable trophy points',
  );
});

test('Every unlockable soundtrack track is registered in ACHIEVEMENT_REWARDS with matching thresholds', () => {
  const rewardTracks = ACHIEVEMENT_REWARDS.filter((r) => r.kind === 'music_track');
  const unlockableTracks = SOUNDTRACK_TRACKS.filter((t) => t.requiredPoints > 0);
  assert.equal(rewardTracks.length, unlockableTracks.length);

  for (const track of unlockableTracks) {
    const match = rewardTracks.find((r) => r.targetKey === track.id);
    assert.ok(match, `Missing ACHIEVEMENT_REWARDS entry for track ${track.id}`);
    assert.equal(match.requiredPoints, track.requiredPoints);
  }
});

test('Unlock gating and resolveEffectiveTrackId fall back cleanly when persisted track is locked', () => {
  assert.equal(isMusicTrackUnlocked('phosphor_idle', 0), true);
  assert.equal(isMusicTrackUnlocked('bitplane_bounce', 149), false);
  assert.equal(isMusicTrackUnlocked('bitplane_bounce', 150), true);
  assert.equal(isMusicTrackUnlocked('broadcast_finale', 1649), false);
  assert.equal(isMusicTrackUnlocked('broadcast_finale', 1650), true);

  assert.equal(getUnlockedTracks(0).length, 1);
  assert.equal(getUnlockedTracks(400).length, 3);
  assert.equal(getUnlockedTracks(1650).length, 7);

  // Before achievements finish loading, preserve persisted selection to avoid flash
  assert.equal(resolveEffectiveTrackId('outrun_crt', 0, false), 'outrun_crt');
  // Once loaded with insufficient points, fall back gracefully to starter track
  assert.equal(resolveEffectiveTrackId('outrun_crt', 200, true), STARTER_TRACK_ID);
  assert.equal(resolveEffectiveTrackId('outrun_crt', 400, true), 'outrun_crt');
});

test('pickNextTrackId handles single-track, cycle wrap-around, and non-repeating shuffle', () => {
  const single: MusicTrackId[] = ['phosphor_idle'];
  assert.equal(pickNextTrackId('phosphor_idle', single, 'cycle', 'next'), 'phosphor_idle');
  assert.equal(pickNextTrackId('phosphor_idle', single, 'shuffle', 'next'), 'phosphor_idle');

  const three: MusicTrackId[] = ['phosphor_idle', 'bitplane_bounce', 'outrun_crt'];
  assert.equal(pickNextTrackId('phosphor_idle', three, 'cycle', 'next'), 'bitplane_bounce');
  assert.equal(pickNextTrackId('outrun_crt', three, 'cycle', 'next'), 'phosphor_idle');
  assert.equal(pickNextTrackId('phosphor_idle', three, 'cycle', 'prev'), 'outrun_crt');

  // Shuffle never repeats current track when multiple tracks are unlocked
  for (const seed of [0, 0.25, 0.5, 0.75, 0.99]) {
    const picked = pickNextTrackId('bitplane_bounce', three, 'shuffle', 'next', () => seed);
    assert.notEqual(picked, 'bitplane_bounce');
    assert.ok(three.includes(picked));
  }
});

test('Volume clamping and validators guard persisted preference values', () => {
  assert.equal(clampMusicVolume(-20), 0);
  assert.equal(clampMusicVolume(145), 100);
  assert.equal(clampMusicVolume(42.6), 43);
  assert.equal(clampMusicVolume(Number.NaN, 45), 45);

  assert.equal(isValidMusicTrackId('subcarrier_pulse'), true);
  assert.equal(isValidMusicTrackId('unknown_track'), false);
  assert.equal(isValidPlaybackMode('loop'), true);
  assert.equal(isValidPlaybackMode('cycle'), true);
  assert.equal(isValidPlaybackMode('shuffle'), true);
  assert.equal(isValidPlaybackMode('repeat_all'), false);
});
