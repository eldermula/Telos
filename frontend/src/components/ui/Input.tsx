import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className, ...rest },
  ref,
) {
  const inputId = id ?? rest.name ?? label.replace(/\s+/g, '-').toLowerCase();

  return (
    <label className="flex flex-col gap-1.5" htmlFor={inputId}>
      <span className="type-caption text-text-secondary">{label}</span>
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'rounded-[8px] border border-border-subtle bg-bg-surface px-3 py-2.5 text-text-primary placeholder:text-text-disabled transition-colors duration-150',
          'focus:border-accent-gold focus:outline-none',
          error && 'border-danger',
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...rest}
      />
      {error ? (
        <span id={`${inputId}-error`} className="type-caption text-danger">
          {error}
        </span>
      ) : hint ? (
        <span className="type-caption">{hint}</span>
      ) : null}
    </label>
  );
});
