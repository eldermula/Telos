import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type GlassCardProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article';
  children: ReactNode;
};

export function GlassCard({
  as: Tag = 'div',
  className,
  children,
  ...rest
}: GlassCardProps) {
  return (
    <Tag className={cn('glass-panel p-6', className)} {...rest}>
      {children}
    </Tag>
  );
}
