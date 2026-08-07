import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent-gold text-bg-canvas hover:bg-accent-gold-hover active:bg-accent-gold-active disabled:bg-text-disabled disabled:text-bg-canvas',
  secondary:
    'bg-transparent border border-border-subtle text-text-primary hover:border-text-secondary disabled:text-text-disabled',
  destructive:
    'bg-danger text-text-primary hover:brightness-110 disabled:bg-text-disabled',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary disabled:text-text-disabled',
};

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[8px] px-4 py-2.5 text-[0.9375rem] font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed',
        variantClass[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
