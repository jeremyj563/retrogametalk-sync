import { AlertTriangle, CheckCircle2, Save, XCircle } from 'lucide-react';
import type { ConfigDirtyState } from '../types';

interface ConfigSaveBarProps {
  ariaLabel: string;
  dirtyState: ConfigDirtyState;
  saving: boolean;
  saveMsg: string | null;
  saveErr: string | null;
  validationHint?: string | null;
  saveDisabled?: boolean;
  onDiscard: () => void;
}

export function ConfigSaveBar({
  ariaLabel,
  dirtyState,
  saving,
  saveMsg,
  saveErr,
  validationHint = null,
  saveDisabled = false,
  onDiscard,
}: ConfigSaveBarProps) {
  const visible = dirtyState.isDirty || saving || Boolean(saveErr) || Boolean(saveMsg);

  return (
    <div
      aria-hidden={!visible}
      inert={!visible || undefined}
      data-open={visible ? 'true' : 'false'}
      className={`sticky bottom-3 z-20 crt-accordion-grid transition-opacity duration-200 motion-reduce:transition-none ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="crt-accordion-inner">
        <div
          role="region"
          aria-label={ariaLabel}
          className={`border rounded-md px-4 py-3 shadow-[0_-8px_28px_-12px_rgba(0,0,0,0.85)] backdrop-blur-md transition-colors duration-200 ${
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
                  {validationHint && (
                    <p className="text-[11px] font-mono text-crt-amber/90">{validationHint}</p>
                  )}
                </div>
              ) : saveMsg ? (
                <div className="flex items-center gap-2 text-crt-phosphor font-mono">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{saveMsg}</span>
                </div>
              ) : null}
            </div>

            {(dirtyState.isDirty || saving || Boolean(saveErr)) && (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
