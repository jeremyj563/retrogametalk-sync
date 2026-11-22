import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, ShieldAlert, Unlock } from 'lucide-react';
import { readJsonSafely } from '../utils/http';
import { BrandMark } from './BrandMark';

interface AppAuthGateProps {
  usernameRequired: boolean;
  onUnlocked: () => void;
}

export function AppAuthGate({ usernameRequired, onUnlocked }: AppAuthGateProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfterSec, setRetryAfterSec] = useState<number>(0);

  const usernameInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (usernameRequired) {
      usernameInputRef.current?.focus();
    } else {
      passwordInputRef.current?.focus();
    }
  }, [usernameRequired]);

  useEffect(() => {
    if (retryAfterSec <= 0) return;
    const timer = window.setInterval(() => {
      setRetryAfterSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfterSec]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || retryAfterSec > 0) return;
    if (!password) {
      setErrorMessage('Enter the console password to unlock.');
      return;
    }
    if (usernameRequired && !username.trim()) {
      setErrorMessage('Enter the configured username to unlock.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/app-auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'rgt-sync',
        },
        body: JSON.stringify({
          ...(usernameRequired ? { username: username.trim() } : {}),
          password,
        }),
      });
      const parsed = await readJsonSafely<{
        ok?: boolean;
        authenticated?: boolean;
        error?: string;
        retryAfterSec?: number;
        remainingAttempts?: number;
      }>(res);

      if (!parsed.ok || !parsed.data?.authenticated) {
        if (typeof parsed.data?.retryAfterSec === 'number' && parsed.data.retryAfterSec > 0) {
          setRetryAfterSec(parsed.data.retryAfterSec);
        }
        const remainingNote =
          typeof parsed.data?.remainingAttempts === 'number' && parsed.data.remainingAttempts <= 3
            ? ` (${parsed.data.remainingAttempts} attempt${parsed.data.remainingAttempts === 1 ? '' : 's'} left)`
            : '';
        setErrorMessage(
          (parsed.data?.error || parsed.errorMessage || `Sign-in failed (HTTP ${res.status})`) +
            remainingNote,
        );
        setPassword('');
        passwordInputRef.current?.focus();
        return;
      }

      setPassword('');
      onUnlocked();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to reach RetroGameTalk Sync.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-crt-border-strong bg-crt-surface rounded-md p-6 sm:p-7 space-y-6 shadow-2xl relative crt-panel-living">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>

        <div className="space-y-4 border-b border-crt-border pb-5">
          <div className="flex justify-center">
            <BrandMark isSyncRunning={false} isDryRun={false} />
          </div>
          <div className="flex items-start gap-2.5 text-left">
            <Lock className="h-4 w-4 text-crt-phosphor shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h1 className="font-display text-base font-semibold text-crt-text">
                Console Access Locked
              </h1>
              <p className="text-xs text-crt-muted leading-relaxed">
                This self-hosted RetroGameTalk Sync instance is protected by{' '}
                <code className="font-mono text-crt-text">APP_AUTH_PASSWORD</code>. Enter your
                credentials to unlock the dashboard.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {usernameRequired && (
            <div className="space-y-1.5">
              <label htmlFor="app-auth-username" className="block text-xs font-medium text-crt-text">
                Username
              </label>
              <input
                ref={usernameInputRef}
                id="app-auth-username"
                type="text"
                autoComplete="username"
                value={username}
                disabled={submitting || retryAfterSec > 0}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Configured APP_AUTH_USERNAME"
                className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="app-auth-password" className="block text-xs font-medium text-crt-text">
              Password
            </label>
            <div className="relative">
              <input
                ref={passwordInputRef}
                id="app-auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                disabled={submitting || retryAfterSec > 0}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter console unlock password"
                className="w-full pl-3 pr-10 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-crt-muted hover:text-crt-phosphor transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="border border-crt-crimson/50 bg-crt-crimson/10 rounded px-3.5 py-2.5 text-xs font-mono text-crt-text flex items-start gap-2"
            >
              <ShieldAlert className="h-4 w-4 text-crt-crimson shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p>{errorMessage}</p>
                {retryAfterSec > 0 && (
                  <p className="text-[11px] text-crt-muted tabular-nums">
                    Unlock retry available in {Math.floor(retryAfterSec / 60)}m{' '}
                    {String(retryAfterSec % 60).padStart(2, '0')}s
                  </p>
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || retryAfterSec > 0}
            className="w-full crt-cta-beam inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-display font-semibold tracking-[0.03em] border border-crt-phosphor bg-crt-phosphor/12 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Unlock className="h-3.5 w-3.5" />
            <span>
              {submitting
                ? 'Verifying...'
                : retryAfterSec > 0
                  ? 'Temporarily Rate-Limited'
                  : 'Unlock Console'}
            </span>
          </button>
        </form>
      </div>
    </main>
  );
}
