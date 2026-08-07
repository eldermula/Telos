import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './Button';

type ModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'destructive';
  onConfirm?: () => void;
  confirming?: boolean;
  /** Extra disable condition beyond `confirming` (e.g. typed phrase mismatch). */
  confirmDisabled?: boolean;
  className?: string;
};

export function Modal({
  open,
  title,
  children,
  onClose,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  confirming = false,
  confirmDisabled = false,
  className,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'w-full max-w-md rounded-[24px] border border-border-subtle bg-bg-surface-raised p-6 shadow-none outline-none',
          className,
        )}
      >
        <h2 id={titleId} className="type-heading text-text-primary">
          {title}
        </h2>
        <div className="mt-3 text-text-secondary">{children}</div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={confirming}>
            {cancelLabel}
          </Button>
          {confirmLabel && onConfirm ? (
            <Button
              variant={confirmVariant}
              onClick={onConfirm}
              disabled={confirming || confirmDisabled}
            >
              {confirming ? 'Working…' : confirmLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
