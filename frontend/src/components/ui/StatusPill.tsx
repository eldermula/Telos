import { cn } from '../../lib/cn';

type StatusTone = 'success' | 'danger' | 'warning' | 'gold' | 'muted' | 'info';

type StatusPillProps = {
  label: string;
  tone?: StatusTone;
  pulse?: boolean;
  className?: string;
};

const toneDot: Record<StatusTone, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  gold: 'bg-accent-gold',
  muted: 'bg-text-secondary',
  info: 'bg-info',
};

const toneBorder: Record<StatusTone, string> = {
  success: 'border-success/40 text-success',
  danger: 'border-danger/40 text-danger',
  warning: 'border-warning/40 text-warning',
  gold: 'border-accent-gold/50 text-accent-gold',
  muted: 'border-border-subtle text-text-secondary',
  info: 'border-info/40 text-info',
};

export function StatusPill({
  label,
  tone = 'muted',
  pulse = false,
  className,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 type-caption',
        toneBorder[tone],
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          toneDot[tone],
          pulse && 'animate-pulse',
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function brokerStatusTone(
  status: 'connected' | 'disconnected' | 'error',
): StatusTone {
  if (status === 'connected') return 'success';
  if (status === 'error') return 'danger';
  return 'muted';
}

export function botStatusTone(status: 'running' | 'stopped' | 'error'): StatusTone {
  if (status === 'running') return 'success';
  if (status === 'error') return 'danger';
  return 'muted';
}

export function strategyModeTone(
  mode: 'STRATEGY_A' | 'STRATEGY_B' | 'HALTED',
): StatusTone {
  if (mode === 'STRATEGY_A') return 'gold';
  if (mode === 'STRATEGY_B') return 'warning';
  return 'danger';
}
