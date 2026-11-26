export type QueueInterruptionCause =
  | 'sigterm'
  | 'sigint'
  | 'crash_or_kill'
  | 'unknown_interruption'
  | 'user_stopped'
  | null;

export interface PersistedQueueRecoveryState {
  /** True when the user explicitly clicked Stop or Pause; blocks automatic resume across restarts. */
  userPaused: boolean;
  /** Consecutive auto-resume attempts that did not finish or survive the stability window. */
  consecutiveAutoResumes: number;
  /** ISO timestamp when the most recent auto-resume attempt actually started running. */
  lastAutoResumeStartedAt: string | null;
  /** ISO timestamp when the most recent unexpected interruption occurred or was detected. */
  lastInterruptedAt: string | null;
  /** Cause of the last interruption or stop. */
  lastInterruptionCause: QueueInterruptionCause;
  /** Remaining queued release count when the last auto-resume launched. */
  lastResumeQueuedCount: number | null;
  /** True once consecutive rapid interruptions exceed AUTO_RESUME_MAX_ATTEMPTS. */
  circuitBreakerTripped: boolean;
  /** Human-readable explanation when circuit breaker trips. */
  circuitBreakerReason: string | null;
}

export type QueueAutoResumePhase =
  | 'idle'
  | 'scheduled'
  | 'user_paused'
  | 'circuit_open'
  | 'blocked_auth';

export interface QueueAutoResumeStatus {
  phase: QueueAutoResumePhase;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  resumeAt: string | null;
  reason: string | null;
  lastInterruptionCause: QueueInterruptionCause;
}

export interface StartupQueueAutoResumeInput {
  state: PersistedQueueRecoveryState;
  queuedCount: number;
  canAuthenticate: boolean;
  recoveredCrashOnStartup: boolean;
  lastDownloadRunStoppedByUser?: boolean;
  nowMs?: number;
  stabilityWindowMs?: number;
  backoffScheduleMs?: readonly number[];
  maxAttempts?: number;
}

export interface QueueAutoResumeDecision {
  action: 'none' | 'schedule' | 'skip_user_paused' | 'circuit_open' | 'blocked_auth';
  attempt: number;
  delayMs: number;
  nextState: PersistedQueueRecoveryState;
  status: QueueAutoResumeStatus;
}

/**
 * Exponential backoff steps for automatic queue recovery after unexpected restarts:
 * 5s -> 15s -> 45s -> 2m -> 5m, followed by circuit-breaker pause to prevent reboot loops.
 */
export const AUTO_RESUME_BACKOFF_SCHEDULE_MS: readonly number[] = [
  5_000,
  15_000,
  45_000,
  120_000,
  300_000,
];

export const AUTO_RESUME_MAX_ATTEMPTS = AUTO_RESUME_BACKOFF_SCHEDULE_MS.length;

/**
 * If an auto-resumed download run stays alive and healthy for at least 3 minutes
 * (or completes cleanly), the consecutive failure/restart counter resets to 0.
 */
export const AUTO_RESUME_STABILITY_WINDOW_MS = 180_000;

export const DEFAULT_QUEUE_RECOVERY_STATE: PersistedQueueRecoveryState = {
  userPaused: false,
  consecutiveAutoResumes: 0,
  lastAutoResumeStartedAt: null,
  lastInterruptedAt: null,
  lastInterruptionCause: null,
  lastResumeQueuedCount: null,
  circuitBreakerTripped: false,
  circuitBreakerReason: null,
};

export const IDLE_QUEUE_AUTO_RESUME_STATUS: QueueAutoResumeStatus = {
  phase: 'idle',
  attempt: 0,
  maxAttempts: AUTO_RESUME_MAX_ATTEMPTS,
  delayMs: 0,
  resumeAt: null,
  reason: null,
  lastInterruptionCause: null,
};

const VALID_CAUSES = new Set<string>([
  'sigterm',
  'sigint',
  'crash_or_kill',
  'unknown_interruption',
  'user_stopped',
]);

export function normalizePersistedQueueRecoveryState(raw: unknown): PersistedQueueRecoveryState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_QUEUE_RECOVERY_STATE };
  }
  const obj = raw as Record<string, unknown>;
  const rawCause = typeof obj.lastInterruptionCause === 'string' ? obj.lastInterruptionCause : null;
  const lastInterruptionCause: QueueInterruptionCause =
    rawCause && VALID_CAUSES.has(rawCause) ? (rawCause as QueueInterruptionCause) : null;

  const rawConsecutive = Number(obj.consecutiveAutoResumes);
  const consecutiveAutoResumes =
    Number.isFinite(rawConsecutive) && rawConsecutive > 0 ? Math.floor(rawConsecutive) : 0;

  const rawQueued =
    obj.lastResumeQueuedCount === null || obj.lastResumeQueuedCount === undefined
      ? null
      : Number(obj.lastResumeQueuedCount);

  return {
    userPaused: Boolean(obj.userPaused),
    consecutiveAutoResumes,
    lastAutoResumeStartedAt:
      typeof obj.lastAutoResumeStartedAt === 'string' && obj.lastAutoResumeStartedAt.trim()
        ? obj.lastAutoResumeStartedAt.trim()
        : null,
    lastInterruptedAt:
      typeof obj.lastInterruptedAt === 'string' && obj.lastInterruptedAt.trim()
        ? obj.lastInterruptedAt.trim()
        : null,
    lastInterruptionCause,
    lastResumeQueuedCount:
      rawQueued !== null && Number.isFinite(rawQueued) && rawQueued >= 0
        ? Math.floor(rawQueued)
        : null,
    circuitBreakerTripped: Boolean(obj.circuitBreakerTripped),
    circuitBreakerReason:
      typeof obj.circuitBreakerReason === 'string' && obj.circuitBreakerReason.trim()
        ? obj.circuitBreakerReason.trim()
        : null,
  };
}

export function computeAutoResumeBackoffDelayMs(
  attempt: number,
  schedule: readonly number[] = AUTO_RESUME_BACKOFF_SCHEDULE_MS,
): number {
  if (schedule.length === 0) return 5_000;
  const clampedIdx = Math.max(0, Math.min(schedule.length - 1, Math.floor(attempt) - 1));
  return Math.max(0, Math.floor(schedule[clampedIdx] ?? schedule[schedule.length - 1]!));
}

export function formatAutoResumeDuration(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
}

export function formatInterruptionCauseLabel(cause: QueueInterruptionCause): string {
  switch (cause) {
    case 'sigterm':
      return 'Interrupted by SIGTERM';
    case 'sigint':
      return 'Interrupted by SIGINT';
    case 'crash_or_kill':
      return 'Interrupted by unexpected shutdown';
    case 'user_stopped':
      return 'Paused by user';
    case 'unknown_interruption':
    default:
      return 'Interrupted before restart';
  }
}

export function planStartupQueueAutoResume(
  input: StartupQueueAutoResumeInput,
): QueueAutoResumeDecision {
  const nowMs = input.nowMs ?? Date.now();
  const stabilityWindowMs = input.stabilityWindowMs ?? AUTO_RESUME_STABILITY_WINDOW_MS;
  const backoffScheduleMs = input.backoffScheduleMs ?? AUTO_RESUME_BACKOFF_SCHEDULE_MS;
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? backoffScheduleMs.length));
  const state = normalizePersistedQueueRecoveryState(input.state);

  if (input.queuedCount <= 0) {
    const cleanState: PersistedQueueRecoveryState = {
      ...DEFAULT_QUEUE_RECOVERY_STATE,
    };
    return {
      action: 'none',
      attempt: 0,
      delayMs: 0,
      nextState: cleanState,
      status: {
        ...IDLE_QUEUE_AUTO_RESUME_STATUS,
        maxAttempts,
      },
    };
  }

  // Respect explicit user Stop / Pause unless a brand-new crash happened on a running job
  if (state.userPaused && !input.recoveredCrashOnStartup) {
    return {
      action: 'skip_user_paused',
      attempt: 0,
      delayMs: 0,
      nextState: state,
      status: {
        phase: 'user_paused',
        attempt: 0,
        maxAttempts,
        delayMs: 0,
        resumeAt: null,
        reason: 'Paused by user — resume where it left off or clear back to available.',
        lastInterruptionCause: 'user_stopped',
      },
    };
  }

  if (
    input.lastDownloadRunStoppedByUser &&
    !input.recoveredCrashOnStartup &&
    !state.lastInterruptionCause
  ) {
    const pausedState: PersistedQueueRecoveryState = {
      ...state,
      userPaused: true,
      lastInterruptionCause: 'user_stopped',
      consecutiveAutoResumes: 0,
      circuitBreakerTripped: false,
      circuitBreakerReason: null,
    };
    return {
      action: 'skip_user_paused',
      attempt: 0,
      delayMs: 0,
      nextState: pausedState,
      status: {
        phase: 'user_paused',
        attempt: 0,
        maxAttempts,
        delayMs: 0,
        resumeAt: null,
        reason: 'Paused by user — resume where it left off or clear back to available.',
        lastInterruptionCause: 'user_stopped',
      },
    };
  }

  const resolvedCause: QueueInterruptionCause = input.recoveredCrashOnStartup
    ? 'crash_or_kill'
    : state.lastInterruptionCause && state.lastInterruptionCause !== 'user_stopped'
      ? state.lastInterruptionCause
      : 'unknown_interruption';

  // If the prior auto-resumed run stayed alive past the stability window before this
  // new interruption (e.g. two separate container upgrades hours apart), reset backoff.
  let effectiveConsecutive = state.consecutiveAutoResumes;
  let effectiveCircuitTripped = state.circuitBreakerTripped;
  if (state.lastAutoResumeStartedAt) {
    const lastStartedMs = Date.parse(state.lastAutoResumeStartedAt);
    const interruptedMs = state.lastInterruptedAt ? Date.parse(state.lastInterruptedAt) : nowMs;
    const referenceMs = Number.isFinite(interruptedMs) ? interruptedMs : nowMs;
    if (
      Number.isFinite(lastStartedMs) &&
      referenceMs - lastStartedMs >= stabilityWindowMs &&
      !state.circuitBreakerTripped
    ) {
      effectiveConsecutive = 0;
      effectiveCircuitTripped = false;
    }
  }

  const nextAttempt = effectiveConsecutive + 1;

  if (effectiveCircuitTripped || nextAttempt > maxAttempts) {
    const reason =
      state.circuitBreakerReason ||
      `Auto-resume paused after ${maxAttempts} consecutive interrupted attempts without stabilizing to prevent a restart loop. Resume manually once resolved or clear the queue.`;
    const trippedState: PersistedQueueRecoveryState = {
      ...state,
      userPaused: false,
      consecutiveAutoResumes: Math.max(effectiveConsecutive, maxAttempts),
      lastInterruptionCause: resolvedCause,
      lastInterruptedAt: state.lastInterruptedAt || new Date(nowMs).toISOString(),
      circuitBreakerTripped: true,
      circuitBreakerReason: reason,
    };
    return {
      action: 'circuit_open',
      attempt: trippedState.consecutiveAutoResumes,
      delayMs: 0,
      nextState: trippedState,
      status: {
        phase: 'circuit_open',
        attempt: trippedState.consecutiveAutoResumes,
        maxAttempts,
        delayMs: 0,
        resumeAt: null,
        reason,
        lastInterruptionCause: resolvedCause,
      },
    };
  }

  if (!input.canAuthenticate) {
    const waitingState: PersistedQueueRecoveryState = {
      ...state,
      userPaused: false,
      consecutiveAutoResumes: effectiveConsecutive,
      lastInterruptionCause: resolvedCause,
      circuitBreakerTripped: false,
      circuitBreakerReason: null,
    };
    return {
      action: 'blocked_auth',
      attempt: effectiveConsecutive,
      delayMs: 0,
      nextState: waitingState,
      status: {
        phase: 'blocked_auth',
        attempt: effectiveConsecutive,
        maxAttempts,
        delayMs: 0,
        resumeAt: null,
        reason: 'Verify repository login in System Settings to resume the interrupted download queue.',
        lastInterruptionCause: resolvedCause,
      },
    };
  }

  const delayMs = computeAutoResumeBackoffDelayMs(nextAttempt, backoffScheduleMs);
  const resumeAt = new Date(nowMs + delayMs).toISOString();
  const causeLabel = formatInterruptionCauseLabel(resolvedCause);
  const reason =
    nextAttempt > 1
      ? `${causeLabel} — crash-loop backoff (attempt ${nextAttempt}/${maxAttempts}), resuming automatically in ${formatAutoResumeDuration(delayMs)}.`
      : `${causeLabel} — resuming automatically in ${formatAutoResumeDuration(delayMs)}.`;

  const scheduledState: PersistedQueueRecoveryState = {
    ...state,
    userPaused: false,
    consecutiveAutoResumes: effectiveConsecutive,
    lastInterruptionCause: resolvedCause,
    lastInterruptedAt: state.lastInterruptedAt || new Date(nowMs).toISOString(),
    circuitBreakerTripped: false,
    circuitBreakerReason: null,
  };

  return {
    action: 'schedule',
    attempt: nextAttempt,
    delayMs,
    nextState: scheduledState,
    status: {
      phase: 'scheduled',
      attempt: nextAttempt,
      maxAttempts,
      delayMs,
      resumeAt,
      reason,
      lastInterruptionCause: resolvedCause,
    },
  };
}
