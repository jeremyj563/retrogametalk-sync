import type { CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, Save, XCircle } from 'lucide-react';
import { useEphemeralPresence } from '../hooks/useEphemeralPresence';
import { DEFAULT_EPHEMERAL_EXIT_MS } from '../shared/ephemeralNotice';
import type { ConfigDirtyState } from '../types';

interface ConfigSaveBarProps {
  ariaLabel: string;
  dirtyState: ConfigDirtyState;
  saving: boolean;
  saveMsg: string | null;
  saveErr: string | null;
  /** Optional auto-dismiss duration in ms for pure save confirmations (enables decay hairline + hover pause) */
  saveNoticeDurationMs?: number | null;
  /** Called when auto-dismiss completes or user dismisses a save confirmation */
  onDismissSaveMsg?: () => void;
  validationHint?: string | null;
  infoHint?: string | null;
  saveDisabled?: boolean;
  onDiscard: () => void;
}

export function ConfigSaveBar({
  ariaLabel,
  dirtyState,
  saving,
  saveMsg,
  saveErr,
  saveNoticeDurationMs = null,
  onDismissSaveMsg,
  validationHint = null,
  infoHint = null,
  saveDisabled = false,
  onDiscard,
}: ConfigSaveBarProps) {
  const hasPersistentBar = dirtyState.isDirty || saving || Boolean(saveErr);
  const pureSaveMsg = !hasPersistentBar ? saveMsg : null;

  const savePresence = useEphemeralPresence(pureSaveMsg, {
    exitMs: DEFAULT_EPHEMERAL_EXIT_MS,
    autoDismissMs: onDismissSaveMsg ? saveNoticeDurationMs : null,
    onAutoDismiss: onDismissSaveMsg,
  });

  const isEphemeralConfirm = !hasPersistentBar && savePresence.mounted;
  const visible = hasPersistentBar || (isEphemeralConfirm && savePresence.phase !== 'closing');
  const ephemeralPhase = isEphemeralConfirm ? savePresence.phase : null;
  const displaySaveMsg = pureSaveMsg ?? savePresence.displayValue;

  const showDecayBar =
    isEphemeralConfirm &&
    savePresence.phase !== 'closing' &&
    Boolean(saveNoticeDurationMs && saveNoticeDurationMs > 0);
  const decayStyle = showDecayBar
    ? ({ '--crt-ephemeral-duration': `${saveNoticeDurationMs}ms` } as CSSProperties)
    : undefined;

  const isClosingEphemeral = ephemeralPhase === 'closing';

  return (
    <div
      aria-hidden={!visible && !isClosingEphemeral}
      inert={(!visible && !isClosingEphemeral) || isClosingEphemeral || undefined}
      data-open={visible ? 'true' : 'false'}
      data-ephemeral-state={isClosingEphemeral ? 'closing' : undefined}
      className={`sticky bottom-3 z-20 ${
        isClosingEphemeral
          ? 'crt-ephemeral-collapse'
          : `crt-accordion-grid transition-opacity duration-200 motion-reduce:transition-none ${
              visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`
      }`}
    >
      <div className={isClosingEphemeral ? 'crt-ephemeral-collapse-inner' : 'crt-accordion-inner'}>
        <div
          role="region"
          aria-label={ariaLabel}
          data-ephemeral-state={ephemeralPhase ?? undefined}
          data-ephemeral-tone="phosphor"
          {...(isEphemeralConfirm ? savePresence.pauseHandlers : {})}
          className={`relative overflow-hidden border rounded-md px-4 py-3 shadow-[0_-8px_28px_-12px_rgba(0,0,0,0.85)] backdrop-blur-md transition-colors duration-200 ${
            isEphemeralConfirm ? 'crt-ephemeral-surface' : ''
          } ${
            saveErr
              ? 'border-crt-crimson/60 bg-crt-surface/95'
              : dirtyState.isDirty
                ? 'border-crt-amber/60 bg-crt-surface/95'
                : 'border-crt-phosphor/50 bg-crt-surface/95'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-xs">
              {saveErr ? (
                <div className="flex items-center gap-2 text-crt-crimson font-mono">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span className="break-words">{saveErr}</span>
                </div>
              ) : dirtyState.isDirty ? (
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-crt-amber font-medium">
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Unsaved changes</span>
                    </span>
                    <span className="font-mono font-normal text-crt-text truncate">
                      · {dirtyState.changedSections.join(', ')}
                    </span>
                  </div>
                  {validationHint ? (
                    <p className="text-[11px] font-mono text-crt-amber/90">{validationHint}</p>
                  ) : infoHint ? (
                    <p className="text-[11px] font-mono text-crt-phosphor/90">{infoHint}</p>
                  ) : null}
                </div>
              ) : displaySaveMsg ? (
                <div role="status" aria-live="polite" className="flex items-center gap-2 text-crt-phosphor font-mono">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{displaySaveMsg}</span>
                </div>
              ) : null}
            </div>

            {hasPersistentBar ? (
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <button
                  type="button"
                  disabled={saving || !dirtyState.isDirty}
                  onClick={onDiscard}
                  className="px-3 py-1.5 text-xs font-medium border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={saving || saveDisabled || !dirtyState.isDirty}
                  className="crt-cta-beam inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            ) : isEphemeralConfirm && onDismissSaveMsg ? (
              <button
                type="button"
                disabled={isClosingEphemeral}
                onClick={onDismissSaveMsg}
                className="text-xs font-mono text-crt-muted hover:text-crt-text shrink-0 cursor-pointer transition-colors disabled:pointer-events-none"
              >
                Dismiss
              </button>
            ) : null}
          </div>

          {showDecayBar && (
            <span
              key={savePresence.generation}
              aria-hidden="true"
              data-paused={savePresence.isPaused ? 'true' : 'false'}
              style={decayStyle}
              className="crt-ephemeral-decay-bar"
            />
          )}
        </div>
      </div>
    </div>
  );
}

