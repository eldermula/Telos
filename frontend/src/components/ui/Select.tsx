import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  label: string;
  options: SelectOption[];
  error?: string;
  hint?: ReactNode;
};

/** Dropdown control matching `Input` border/radius/focus tokens (07 §3). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, hint, id, className, ...rest },
  ref,
) {
  const selectId = id ?? rest.name ?? label.replace(/\s+/g, '-').toLowerCase();

  return (
    <label className="flex flex-col gap-1.5" htmlFor={selectId}>
      <span className="type-caption text-text-secondary">{label}</span>
      <select
        ref={ref}
        id={selectId}
        className={cn(
          'rounded-[8px] border border-border-subtle bg-bg-surface px-3 py-2.5 text-text-primary transition-colors duration-150',
          'focus:border-accent-gold focus:outline-none',
          error && 'border-danger',
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${selectId}-error` : undefined}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={`${selectId}-error`} className="type-caption text-danger">
          {error}
        </span>
      ) : hint ? (
        <span className="type-caption">{hint}</span>
      ) : null}
    </label>
  );
});
