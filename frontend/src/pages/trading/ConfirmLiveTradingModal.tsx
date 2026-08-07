import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { LIVE_TRADING_CONFIRMATION_PHRASE } from '../../lib/liveTradingConfirmation';
import type { TradingSession } from '../../types/trading';

type Props = {
  open: boolean;
  session: TradingSession;
  confirming: boolean;
  onClose: () => void;
  onConfirm: (phrase: string) => Promise<void>;
};

/**
 * Option 2 Layer 2 — the deliberate-typing gate before a real-mode
 * Start. Phrase is shown verbatim (not a secret); Confirm stays
 * disabled until the typed text matches exactly. Server re-checks
 * the same phrase; a client-side match alone never authorizes anything.
 */
export function ConfirmLiveTradingModal({
  open,
  session,
  confirming,
  onClose,
  onConfirm,
}: Props) {
  const [phrase, setPhrase] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPhrase('');
      setLocalError(null);
    }
  }, [open]);

  const matches = phrase === LIVE_TRADING_CONFIRMATION_PHRASE;

  async function handleConfirm() {
    if (!matches) return;
    setLocalError(null);
    try {
      await onConfirm(phrase);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Confirmation failed.');
    }
  }

  return (
    <Modal
      open={open}
      title="Confirm live trading"
      confirmLabel="Confirm live trading"
      confirmVariant="destructive"
      confirming={confirming}
      confirmDisabled={!matches}
      onClose={onClose}
      onConfirm={() => void handleConfirm()}
    >
      <div className="flex flex-col gap-4">
        <p className="text-danger">
          You are about to authorize real-money order placement on your linked
          MT5 account. This is not a paper simulation.
        </p>

        <dl className="grid grid-cols-2 gap-3 rounded-[12px] border border-border-subtle bg-bg-surface p-3">
          <div>
            <dt className="type-caption">Account type</dt>
            <dd className="type-data-base mt-0.5 capitalize text-text-primary">
              {session.account_type}
            </dd>
          </div>
          <div>
            <dt className="type-caption">Trading balance</dt>
            <dd className="type-data-base mt-0.5 text-accent-gold">
              ${session.active_trading_balance.toFixed(2)}
            </dd>
          </div>
        </dl>

        <p>
          Confirmation expires in 15 minutes if you don&apos;t Start, and is
          cleared on every Stop. Type the phrase below exactly to continue.
        </p>

        <p className="rounded-[8px] border border-border-subtle bg-bg-surface px-3 py-2 font-mono text-[0.875rem] text-text-primary">
          {LIVE_TRADING_CONFIRMATION_PHRASE}
        </p>

        <Input
          label="Confirmation phrase"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Type the phrase exactly"
          error={localError ?? undefined}
        />
      </div>
    </Modal>
  );
}
