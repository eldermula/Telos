import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { GlassCard } from '../../components/ui/GlassCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { StatusPill, botStatusTone } from '../../components/ui/StatusPill';
import {
  confirmSyntheticLiveSession,
  getSyntheticSession,
  startSyntheticSession,
  stopSyntheticSession,
  type SyntheticSession,
} from '../../lib/api/syntheticBot';
import { getLiveAccountInfo, type LiveAccountInfo } from '../../lib/api/trading';
import { ApiError } from '../../types/api';
import { useBotEvents } from '../../hooks/useBotEvents';
import type { BotEventMessage } from '../../lib/ws';
import { ConfirmSyntheticsLiveTradingModal } from './ConfirmSyntheticsLiveTradingModal';

/**
 * Trading — Synthetics panel (paper + real arming).
 * Visual/interaction from telos_synthetics_prototype TradingView;
 * data from Batch 1 session fields + GET /trading/account-info.
 */
export function SyntheticsPaperPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [session, setSession] = useState<SyntheticSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'start' | 'stop' | null>(null);
  const [confirmLiveOpen, setConfirmLiveOpen] = useState(false);
  const [confirmLivePending, setConfirmLivePending] = useState(false);
  const [liveAccount, setLiveAccount] = useState<LiveAccountInfo | null>(null);
  const [liveAccountError, setLiveAccountError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const data = await getSyntheticSession();
      setSession(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_BROKER_CONNECTION') {
        setSession(null);
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load synthetics session');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const onBotEvent = useCallback((message: BotEventMessage) => {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    if (message.event === 'bot.status_changed') {
      if (typeof payload.synthetic_status === 'string') {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                synthetic_status: payload.synthetic_status as SyntheticSession['synthetic_status'],
              }
            : prev,
        );
      }
      return;
    }
    if (message.event === 'equity.updated') {
      const bal = payload.synthetic_active_trading_balance;
      const peak = payload.synthetic_peak_equity;
      if (typeof bal === 'number' || typeof peak === 'number') {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                synthetic_active_trading_balance:
                  typeof bal === 'number' ? bal : prev.synthetic_active_trading_balance,
                synthetic_peak_equity:
                  typeof peak === 'number' ? peak : prev.synthetic_peak_equity,
              }
            : prev,
        );
      }
    }
  }, []);

  useBotEvents(onBotEvent);

  // Mode pill: trust the session field as already TTL-filtered by the
  // backend (bot-status.cache → isConfirmationActive). Never re-parse
  // or independently age-check a raw timestamp on the client.
  const mode: 'paper' | 'real' =
    session != null && session.synthetic_live_trading_confirmed_at != null
      ? 'real'
      : 'paper';

  // Real-mode balance grid: live connector read (same endpoint as Confirm Live).
  useEffect(() => {
    if (!session || mode !== 'real') {
      setLiveAccount(null);
      setLiveAccountError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const info = await getLiveAccountInfo();
        if (cancelled) return;
        setLiveAccount(info);
        setLiveAccountError(null);
      } catch (err) {
        if (cancelled) return;
        setLiveAccount(null);
        setLiveAccountError(
          err instanceof ApiError
            ? err.message
            : 'Could not load live MT5 account info.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, mode, refreshKey]);

  async function onConfirmAction() {
    setPending(true);
    setError(null);
    try {
      if (confirmAction === 'start') {
        setSession(await startSyntheticSession());
      } else if (confirmAction === 'stop') {
        setSession(await stopSyntheticSession());
      }
      setConfirmAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Synthetics action failed');
    } finally {
      setPending(false);
    }
  }

  async function onConfirmLive(phrase: string) {
    setConfirmLivePending(true);
    setError(null);
    try {
      setSession(await confirmSyntheticLiveSession(phrase));
      setConfirmLiveOpen(false);
    } finally {
      setConfirmLivePending(false);
    }
  }

  if (loading) {
    return (
      <GlassCard>
        <p className="type-caption text-text-secondary">Loading synthetics session…</p>
      </GlassCard>
    );
  }

  if (!session) {
    return null;
  }

  const running = session.synthetic_status === 'running';
  const realAvailable = Boolean(session.synthetic_real_trading_available);
  const paperBalance = session.synthetic_active_trading_balance ?? 0;
  const paperPeak = session.synthetic_peak_equity ?? 0;
  const paperBootstrap = (session.synthetic_current_tier ?? 0) === 0;

  const displayBalance =
    mode === 'real' && liveAccount
      ? liveAccount.balance
      : paperBalance;
  const displayPeak =
    mode === 'real' && liveAccount
      ? liveAccount.equity
      : paperPeak;

  return (
    <>
      <GlassCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="type-display-sm text-text-primary">Synthetics</h2>
              <StatusPill
                label={mode === 'real' ? 'REAL' : 'PAPER'}
                tone={mode === 'real' ? 'warning' : 'muted'}
              />
            </div>
            <p className="type-caption mt-1.5 max-w-md text-text-secondary">
              {mode === 'real'
                ? 'Volatility Indices pathway — placing real orders on your linked Deriv account.'
                : 'Volatility Indices pathway — own runtime, no news correlation, paper mode.'}{' '}
              Watchlist: Vol 10 / 25 / 50 / 75 / 100.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {running ? (
              <Button variant="destructive" onClick={() => setConfirmAction('stop')}>
                Stop synthetics
              </Button>
            ) : (
              <>
                <Button onClick={() => setConfirmAction('start')}>Start synthetics</Button>
                {/* Stop remains available while REAL-armed but not running so
                    Stop can clear synthetic_live_trading_confirmed_at without
                    requiring a Start (which would dispatch real orders). */}
                {mode === 'real' ? (
                  <Button variant="destructive" onClick={() => setConfirmAction('stop')}>
                    Stop synthetics
                  </Button>
                ) : null}
              </>
            )}
            {realAvailable && mode === 'paper' ? (
              <Button
                variant="secondary"
                className="border-warning text-warning hover:border-warning hover:text-warning"
                onClick={() => setConfirmLiveOpen(true)}
              >
                <ShieldAlert size={15} aria-hidden />
                Start real trading
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border-subtle pt-5">
          <div>
            <p className="type-caption text-text-secondary">Balance</p>
            <p className="type-data-lg mt-1 tabular-nums text-accent-gold">
              ${displayBalance.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="type-caption text-text-secondary">Peak equity</p>
            <p className="type-data-base mt-1 tabular-nums text-text-primary">
              ${displayPeak.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="type-caption text-text-secondary">Phase</p>
            <p className="mt-1 text-[0.9375rem] text-text-primary">
              {mode === 'real'
                ? 'Live account'
                : paperBootstrap
                  ? 'Bootstrap Phase'
                  : `Tier ${session.synthetic_current_tier}`}
            </p>
          </div>
          <div>
            <p className="type-caption text-text-secondary">Risk ceiling</p>
            <p className="mt-1 text-[0.9375rem] text-text-primary">—</p>
          </div>
        </div>

        {mode === 'real' && liveAccountError ? (
          <p className="type-caption mt-3 text-text-secondary">{liveAccountError}</p>
        ) : null}

        <div className="mt-5">
          <StatusPill
            label={`synthetics: ${session.synthetic_status}`}
            tone={botStatusTone(session.synthetic_status)}
            pulse={running}
          />
        </div>

        {error ? <p className="type-caption mt-3 text-danger">{error}</p> : null}
      </GlassCard>

      {!realAvailable ? (
        <p className="type-caption text-center text-text-disabled">
          Real trading is currently disabled at the environment level — the &quot;Start
          real trading&quot; control won&apos;t appear until it&apos;s enabled.
        </p>
      ) : null}

      <Modal
        open={confirmAction !== null}
        title={
          confirmAction === 'start' ? 'Start synthetics bot' : 'Stop synthetics bot'
        }
        confirmLabel={confirmAction === 'start' ? 'Start synthetics' : 'Stop synthetics'}
        confirmVariant={confirmAction === 'start' ? 'primary' : 'destructive'}
        confirming={pending}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void onConfirmAction()}
      >
        {confirmAction === 'start' ? (
          <p>
            {mode === 'real'
              ? 'Starts the synthetics bot. Live trading is confirmed — real orders may be placed on Volatility Indices against your linked Deriv MT5 account.'
              : 'Starts the synthetics paper bot on Volatility Indices. No real MT5 orders are placed while confirmation is inactive. Forex and crypto runtimes are separate.'}
          </p>
        ) : (
          <p>
            Stops the synthetics bot from opening new positions. Any open position stays
            until it resolves.
            {mode === 'real'
              ? ' Live-trading confirmation will be cleared and must be retyped before the next real-mode Start.'
              : ''}
          </p>
        )}
      </Modal>

      <ConfirmSyntheticsLiveTradingModal
        open={confirmLiveOpen}
        confirming={confirmLivePending}
        allowDemoConfirm={Boolean(session.synthetic_allow_demo_confirm)}
        onClose={() => setConfirmLiveOpen(false)}
        onConfirm={onConfirmLive}
      />
    </>
  );
}
