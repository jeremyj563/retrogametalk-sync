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
import { type NoteCell, TRACK_SCORES } from '../src/utils/retroMusicPlayer.ts';

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

function validateNoteLane(trackId: string, laneName: string, lane: readonly NoteCell[], totalSteps: number) {
  assert.equal(lane.length, totalSteps, `${trackId} ${laneName} length (${lane.length}) must equal totalSteps (${totalSteps})`);
  for (let i = 0; i < lane.length; i += 1) {
    const cell = lane[i];
    if (cell === null) continue;
    const midi = typeof cell === 'number' ? cell : cell[0];
    assert.ok(
      Number.isInteger(midi) && midi >= 21 && midi <= 108,
      `${trackId} ${laneName}[${i}] MIDI ${midi} out of valid range [21, 108]`,
    );
    if (typeof cell !== 'number') {
      assert.ok(cell[1] >= 1, `${trackId} ${laneName}[${i}] sustain steps (${cell[1]}) must be >= 1`);
      if (cell[2] !== undefined) {
        assert.ok(cell[2] > 0 && cell[2] <= 2, `${trackId} ${laneName}[${i}] velocity (${cell[2]}) out of bounds`);
      }
    }
  }
}

test('All 7 composed TRACK_SCORES match SOUNDTRACK_TRACKS BPM and have exact bar-aligned lengths & valid steps', () => {
  for (const meta of SOUNDTRACK_TRACKS) {
    const score = TRACK_SCORES[meta.id];
    assert.ok(score, `Missing TRACK_SCORES entry for ${meta.id}`);
    assert.equal(score.bpm, meta.bpm, `${meta.id} score BPM (${score.bpm}) must match metadata BPM (${meta.bpm})`);
    assert.ok(
      score.totalSteps >= 64 && score.totalSteps % 16 === 0,
      `${meta.id} totalSteps (${score.totalSteps}) must be a multiple of 16 steps (>= 64)`,
    );

    validateNoteLane(meta.id, 'lead', score.lead, score.totalSteps);
    validateNoteLane(meta.id, 'arp', score.arp, score.totalSteps);
    validateNoteLane(meta.id, 'bass', score.bass, score.totalSteps);
    if (score.counter) {
      validateNoteLane(meta.id, 'counter', score.counter, score.totalSteps);
    }

    for (const [stepKey, entry] of Object.entries(score.chords)) {
      const step = Number(stepKey);
      assert.ok(
        Number.isInteger(step) && step >= 0 && step < score.totalSteps,
        `${meta.id} chord step ${stepKey} out of [0, ${score.totalSteps - 1}]`,
      );
      assert.ok(entry, `${meta.id} chord entry at step ${stepKey} must be defined`);
      const isRich = !Array.isArray(entry) && 'notes' in entry;
      const notes: readonly number[] = isRich ? entry.notes : (entry as readonly number[]);
      if (isRich && entry.altVoice) {
        assert.ok(score.altPadVoice, `${meta.id} chord at step ${stepKey} requests altVoice but altPadVoice is missing`);
      }
      assert.ok(notes.length >= 2, `${meta.id} chord at step ${stepKey} must have >= 2 notes`);
      for (const midi of notes) {
        assert.ok(
          Number.isInteger(midi) && midi >= 21 && midi <= 108,
          `${meta.id} chord MIDI ${midi} at step ${stepKey} out of bounds`,
        );
      }
    }

    const drumLanes: Array<[string, readonly number[] | undefined]> = [
      ['kick', score.kick],
      ['snare', score.snare],
      ['clap', score.clap],
      ['rim', score.rim],
      ['hatClosed', score.hatClosed],
      ['hatAccent', score.hatAccent],
      ['hatOpen', score.hatOpen],
      ['clang', score.clang],
      ['crash', score.crash],
      ['accentSteps', score.accentSteps],
    ];
    for (const [name, steps] of drumLanes) {
      if (!steps) continue;
      for (const step of steps) {
        assert.ok(
          Number.isInteger(step) && step >= 0 && step < score.totalSteps,
          `${meta.id} ${name} step ${step} out of [0, ${score.totalSteps - 1}]`,
        );
      }
    }

    if (score.toms) {
      for (const hit of score.toms) {
        assert.ok(
          Number.isInteger(hit.step) && hit.step >= 0 && hit.step < score.totalSteps,
          `${meta.id} tom step ${hit.step} out of [0, ${score.totalSteps - 1}]`,
        );
        assert.ok(
          Number.isInteger(hit.midi) && hit.midi >= 21 && hit.midi <= 108,
          `${meta.id} tom MIDI ${hit.midi} out of bounds`,
        );
      }
    }
  }
});
