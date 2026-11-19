import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSnakeStep,
  canPlaceTetromino,
  computeGhostY,
  computeInvaderStepInterval,
  computeSnakeTickInterval,
  computeTetrominoClearScore,
  createEmptyTetroBoard,
  createInitialSnake,
  createInvaderBunkers,
  createInvaderWave,
  createSevenBag,
  createSpawnTetromino,
  enqueueSnakeDirection,
  lockTetrominoAndClearLines,
  SNAKE_COLS,
  SNAKE_ROWS,
  spawnSnakeFood,
  stepInvaderFormation,
  TETRO_COLS,
  TETRO_ROWS,
  TETROMINO_KINDS,
  tryRotateTetromino,
} from '../src/utils/arcadeGames';

test('Retro Invaders wave spawning, edge drop reversal, bunker creation & speed curve', () => {
  const wave1 = createInvaderWave(1);
  assert.equal(wave1.length, 50);
  assert.equal(wave1.filter((i) => i.kind === 'squid').length, 10);
  assert.equal(wave1.filter((i) => i.kind === 'crab').length, 20);
  assert.equal(wave1.filter((i) => i.kind === 'octopus').length, 20);

  const wave3 = createInvaderWave(3);
  assert.ok(wave3[0].y > wave1[0].y, 'later waves start lower');

  // Accelerates sharply as fewer invaders remain
  const fullInterval = computeInvaderStepInterval(50, 50, 1);
  const lastOneInterval = computeInvaderStepInterval(1, 50, 1);
  assert.ok(lastOneInterval < fullInterval * 0.35);

  // Edge hit reverses direction and drops down
  const rightMost = Math.max(...wave1.map((i) => i.x + i.w));
  const beforeY = wave1[0].y;
  const edgeRes = stepInvaderFormation(wave1, 1, {
    stepX: 12,
    dropY: 18,
    minX: 20,
    maxX: rightMost + 5,
  });
  assert.equal(edgeRes.dropped, true);
  assert.equal(edgeRes.nextDirection, -1);
  assert.equal(wave1[0].y, beforeY + 18);

  const bunkers = createInvaderBunkers();
  assert.ok(bunkers.length > 200);
  assert.ok(bunkers.every((c) => c.alive));
});

test('Phosphor Snake turn-queue blocks 180-degree self-reversal and buffers rapid turns', () => {
  // Moving right: pressing left must be ignored
  assert.deepEqual(enqueueSnakeDirection([], 'right', 'left'), []);

  // Moving right: rapid Down then Left buffers cleanly without reversal
  const q1 = enqueueSnakeDirection([], 'right', 'down');
  assert.deepEqual(q1, ['down']);
  const q2 = enqueueSnakeDirection(q1, 'right', 'left');
  assert.deepEqual(q2, ['down', 'left']);

  // Duplicate or opposite to queued tail is ignored
  assert.deepEqual(enqueueSnakeDirection(q1, 'right', 'up'), ['down']);
  assert.deepEqual(enqueueSnakeDirection(q1, 'right', 'down'), ['down']);

  // Growth, normal advance & collision checks
  const snake = createInitialSnake(SNAKE_COLS, SNAKE_ROWS);
  const foodAhead = { x: snake[0].x + 1, y: snake[0].y };
  const ate = advanceSnakeStep(snake, 'right', foodAhead, SNAKE_COLS, SNAKE_ROWS);
  assert.equal(ate.ateFood, true);
  assert.equal(ate.hitWall, false);
  assert.equal(ate.hitSelf, false);
  assert.equal(ate.nextSnake.length, snake.length + 1);

  // Wall collision
  const edgeSnake = [{ x: SNAKE_COLS - 1, y: 5 }, { x: SNAKE_COLS - 2, y: 5 }];
  const wallHit = advanceSnakeStep(edgeSnake, 'right', null, SNAKE_COLS, SNAKE_ROWS);
  assert.equal(wallHit.hitWall, true);

  // Food never spawns on occupied cells
  const spawned = spawnSnakeFood(4, 1, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 3, y: 0 },
  ]);
  assert.deepEqual(spawned, { x: 2, y: 0 });
  assert.equal(
    spawnSnakeFood(2, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]),
    null,
  );

  assert.ok(computeSnakeTickInterval(30) < computeSnakeTickInterval(0));
});

test('Tetromino Drop 7-bag, rotation wall-kick, ghost piece & Quad 4-line clear', () => {
  const bag = createSevenBag();
  assert.equal(bag.length, 7);
  assert.deepEqual([...bag].sort(), [...TETROMINO_KINDS].sort());

  const board = createEmptyTetroBoard();
  const tPiece = createSpawnTetromino('T');
  assert.equal(canPlaceTetromino(board, tPiece), true);

  // Wall kick when rotating I-piece flush against right wall
  const iVert = { kind: 'I' as const, rotation: 1, x: TETRO_COLS - 3, y: 5 };
  assert.equal(canPlaceTetromino(board, iVert), true);
  const rotated = tryRotateTetromino(board, iVert, 1);
  assert.ok(rotated !== null, 'I-piece near wall should wall-kick cleanly');
  assert.equal(canPlaceTetromino(board, rotated!), true);

  // Ghost piece lands at bottom of empty well
  const oPiece = createSpawnTetromino('O');
  const ghostY = computeGhostY(board, oPiece);
  assert.equal(ghostY, TETRO_ROWS - 2);

  // Build 4 bottom rows with only col 0 empty, then lock vertical I-piece for a Quad!
  for (let r = TETRO_ROWS - 4; r < TETRO_ROWS; r += 1) {
    for (let c = 1; c < TETRO_COLS; c += 1) {
      board[r][c] = 'J';
    }
  }
  const quadPiece = { kind: 'I' as const, rotation: 3, x: -1, y: TETRO_ROWS - 4 };
  assert.equal(canPlaceTetromino(board, quadPiece), true);
  const cleared = lockTetrominoAndClearLines(board, quadPiece);
  assert.equal(cleared.linesCleared, 4);
  assert.equal(cleared.clearedRowIndices.length, 4);
  assert.ok(
    cleared.nextBoard[TETRO_ROWS - 1].every((cell) => cell === null),
    'all 4 cleared rows should be removed and replaced with empty top rows',
  );
  assert.equal(computeTetrominoClearScore(4, 2), 1600);
  assert.equal(computeTetrominoClearScore(1, 3), 300);
});
