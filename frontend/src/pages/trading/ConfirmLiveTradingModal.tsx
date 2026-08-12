import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { LIVE_TRADING_CONFIRMATION_PHRASE } from '../../lib/liveTradingConfirmation';
import { getLiveAccountInfo, type LiveAccountInfo } from '../../lib/api/trading';
import { ApiError } from '../../types/api';

type Props = {
  open: boolean;
  confirming: boolean;
  onClose: () => void;
  onConfirm: (phrase: string) => Promise<void>;
  /**
   * When true (session.allow_demo_confirm), UI accepts a live demo
   * account_type so forex demo walkthroughs can type the phrase.
   * Server still enforces the admin demo-confirm toggle on POST.
   */
  allowDemoConfirm?: boolean;
};

/**
 * Option 2 Layer 2 — the deliberate-typing gate before a real-mode
 * Start. Phrase is shown verbatim (not a secret); Confirm stays
 * disabled until (a) live MT5 account-info has loaded successfully,
 * (b) that live account_type is still `real`, and (c) the typed text
 * matches exactly. Server re-checks the phrase; a client-side match
 * alone never authorizes anything. Equity is always from
 * GET /trading/account-info (live connector), never
 * session.active_trading_balance (still the paper ledger until E).
 */
export function ConfirmLiveTradingModal({
  open,
  confirming,
  onClose,
  onConfirm,
  allowDemoConfirm = false,
}: Props) {
  const [phrase, setPhrase] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<LiveAccountInfo | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPhrase('');
      setLocalError(null);
      setAccountInfo(null);
      setAccountError(null);
      setAccountLoading(false);
      return;
    }

    let cancelled = false;
    setAccountLoading(true);
    setAccountError(null);
    setAccountInfo(null);

    void (async () => {
      try {
        const info = await getLiveAccountInfo();
        if (cancelled) return;
        setAccountInfo(info);
        const accountOk =
          info.account_type === 'real' ||
          (allowDemoConfirm && info.account_type === 'demo');
        if (!accountOk) {
          setAccountError(
            `Attached MT5 account is ${info.account_type}, not real. Live trading cannot be confirmed.`,
          );
        }
      } catch (err) {
        if (cancelled) return;
        setAccountError(
          err instanceof ApiError
            ? err.message
            : 'Could not load live MT5 account info. Confirmation is blocked until this succeeds.',
        );
      } finally {
        if (!cancelled) setAccountLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, allowDemoConfirm]);

  const matches = phrase === LIVE_TRADING_CONFIRMATION_PHRASE;
  const accountOk =
    accountInfo != null &&
    (accountInfo.account_type === 'real' ||
      (allowDemoConfirm && accountInfo.account_type === 'demo'));
  const liveContextReady = accountOk && !accountError;

  async function handleConfirm() {
    if (!matches || !liveContextReady) return;
    setLocalError(null);
    try {
      await onConfirm(phrase);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Confirmation failed.');
    }
  }

  const currency = accountInfo?.currency ? ` ${accountInfo.currency}` : '';

  return (
    <Modal
      open={open}
      title="Confirm live trading"
      confirmLabel="Confirm live trading"
      confirmVariant="destructive"
      confirming={confirming}
      confirmDisabled={!matches || !liveContextReady || accountLoading}
      onClose={onClose}
      onConfirm={() => void handleConfirm()}
    >
      <div className="flex flex-col gap-4">
        <p className="text-danger">
          You are about to authorize real-money order placement on your linked
          MT5 account. This is not a paper simulation.
        </p>

        {accountLoading ? (
          <p className="type-caption">Loading live MT5 account info…</p>
        ) : null}

        {accountError ? (
          <p className="type-caption text-danger">{accountError}</p>
        ) : null}

        {accountInfo && !accountLoading ? (
          <dl className="grid grid-cols-2 gap-3 rounded-[12px] border border-border-subtle bg-bg-surface p-3">
            <div>
              <dt className="type-caption">Account</dt>
              <dd className="type-data-base mt-0.5 text-text-primary">
                {accountInfo.login}{' '}
                <span className="capitalize">({accountInfo.account_type})</span>
              </dd>
            </div>
            <div>
              <dt className="type-caption">Broker</dt>
              <dd className="type-data-base mt-0.5 uppercase text-text-primary">
                {accountInfo.broker_name}
              </dd>
            </div>
            <div>
              <dt className="type-caption">Live equity</dt>
              <dd className="type-data-base mt-0.5 text-accent-gold">
                {accountInfo.equity.toFixed(2)}
                {currency}
              </dd>
            </div>
            <div>
              <dt className="type-caption">Live balance</dt>
              <dd className="type-data-base mt-0.5 text-text-primary">
                {accountInfo.balance.toFixed(2)}
                {currency}
              </dd>
            </div>
          </dl>
        ) : null}

        <p>
          Confirmation expires in 120 minutes if you don&apos;t Start, and is
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
          disabled={!liveContextReady}
        />
      </div>
    </Modal>
  );
}
