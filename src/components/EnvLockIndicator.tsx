import { Lock } from 'lucide-react';

interface EnvLockIndicatorProps {
  envVar: string;
  detail?: string;
}

export function EnvLockIndicator({ envVar, detail }: EnvLockIndicatorProps) {
  const tooltip = detail || `Controlled by ${envVar} environment variable (read-only)`;
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center gap-1 text-[11px] font-mono text-crt-muted whitespace-nowrap shrink-0"
    >
      <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{envVar}</span>
    </span>
  );
}
