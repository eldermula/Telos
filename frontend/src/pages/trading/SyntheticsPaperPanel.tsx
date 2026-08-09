import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { GlassCard } from '../../components/ui/GlassCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { StatusPill, botStatusTone } from '../../components/ui/StatusPill';
import {
  confirmSyntheticLiveSession,
  getSyntheticSession,
  haltSyntheticNewOpensSession,
  resumeSyntheticNewOpensSession,
  startSyntheticSession,
  stopSyntheticSession,
  type SyntheticSession,
} from '../../lib/api/syntheticBot';
import { getLiveAccountInfo, getPositions, type LiveAccountInfo } from '../../lib/api/trading';
import { ApiError } from '../../types/api';
import { useBotEvents } from '../../hooks/useBotEvents';
import type { BotEventMessage } from '../../lib/ws';
import { ConfirmSyntheticsLiveTradingModal } from './ConfirmSyntheticsLiveTradingModal';

/**
 * Match synthetic/forex runtime tick cadence (SYNTHETIC_PAPER_TICK_MS /
 * PAPER_TICK_MS default 2000). No other live-data poll exists in the
 * frontend — the app is otherwise WebSocket-driven.
 */
const LIVE_ACCOUNT_POLL_MS = 2000;

function hasOpenRealSyntheticTrade(
  positions: { execution_mode?: string; asset_class?: string; status?: string }[],
): boolean {
  return positions.some(
    (p) =>
      p.status === 'open' &&
      p.execution_mode === 'real' &&
      p.asset_class === 'synthetic',
  );
}

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
  const [confirmAction, setConfirmAction] = useState<
    'start' | 'stop' | 'halt' | 'resume' | null
  >(null);
  const [confirmLiveOpen, setConfirmLiveOpen] = useState(false);
  const [confirmLivePending, setConfirmLivePending] = useState(false);
  const [liveAccount, setLiveAccount] = useState<LiveAccountInfo | null>(null);
  const [liveAccountError, setLiveAccountError] = useState<string | null>(null);
  const [openRealSynthetic, setOpenRealSynthetic] = useState(false);

  // Mode pill: REAL while confirm-TTL is active OR an open real synthetic
  // trade still exists — so Stop/TTL expiry cannot flip the panel to PAPER
  // while a broker position remains open. Confirmation alone is insufficient.
  const confirmationActive =
    session != null && session.synthetic_live_trading_confirmed_at != null;
  const mode: 'paper' | 'real' =
    confirmationActive || openRealSynthetic ? 'real' : 'paper';
  const running = session?.synthetic_status === 'running';
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const refreshOpenRealSynthetic = useCallback(async () => {
    try {
      const positions = await getPositions();
      setOpenRealSynthetic(hasOpenRealSyntheticTrade(positions));
    } catch {
      // Keep last-known openRealSynthetic on transient failures so we
      // don't flash PAPER mid-open-real.
    }
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const data = await getSyntheticSession();
      setSession(data);
      await refreshOpenRealSynthetic();
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
  }, [refreshOpenRealSynthetic]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  /**
   * REAL-mode balances always come from GET /trading/account-info.
   * Keep last-good values on transient failure so we never flash the
   * paper ledger mid-REAL session.
   */
  const refreshLiveAccount = useCallback(async () => {
    try {
      const info = await getLiveAccountInfo();
      setLiveAccount(info);
      setLiveAccountError(null);
    } catch (err) {
      setLiveAccountError(
        err instanceof ApiError
          ? err.message
          : 'Could not load live MT5 account info.',
      );
    }
  }, []);

  // Immediate fetch + poll whenever display mode is REAL — including when
  // synthetic_status is stopped but an open real trade still exists.
  // (Previously gated on running, so Stop froze the equity display.)
  useEffect(() => {
    if (mode !== 'real') {
      setLiveAccount(null);
      setLiveAccountError(null);
      return;
    }

    void refreshLiveAccount();
    const id = window.setInterval(() => {
      void refreshLiveAccount();
      void refreshOpenRealSynthetic();
    }, LIVE_ACCOUNT_POLL_MS);
    return () => window.clearInterval(id);
  }, [mode, refreshKey, refreshLiveAccount, refreshOpenRealSynthetic]);

  const onBotEvent = useCallback(
    (message: BotEventMessage) => {
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      if (message.event === 'bot.status_changed') {
        setSession((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          if (typeof payload.synthetic_status === 'string') {
            next.synthetic_status =
              payload.synthetic_status as SyntheticSession['synthetic_status'];
          }
          if (typeof payload.synthetic_halt_new_opens === 'boolean') {
            next.synthetic_halt_new_opens = payload.synthetic_halt_new_opens;
          }
          return next;
        });
        // Stop clears confirmation in the session response; re-check open real.
        void refreshOpenRealSynthetic();
        return;
      }
      if (
        message.event === 'trade.opened' ||
        message.event === 'trade.closed' ||
        message.event === 'equity.updated'
      ) {
        // PAPER path: merge synthetic ledger from equity.updated.
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
        void refreshOpenRealSynthetic();
        // REAL path: re-read live MT5 account-info (paper ledger is not display).
        if (modeRef.current === 'real') {
          void refreshLiveAccount();
        }
      }
    },
    [refreshLiveAccount, refreshOpenRealSynthetic],
  );

  useBotEvents(onBotEvent);

  async function onConfirmAction() {
    setPending(true);
    setError(null);
    try {
      if (confirmAction === 'start') {
        setSession(await startSyntheticSession());
      } else if (confirmAction === 'stop') {
        setSession(await stopSyntheticSession());
      } else if (confirmAction === 'halt') {
        setSession(await haltSyntheticNewOpensSession());
      } else if (confirmAction === 'resume') {
        setSession(await resumeSyntheticNewOpensSession());
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

  const realAvailable = Boolean(session.synthetic_real_trading_available);
  const haltNewOpensActive = Boolean(session.synthetic_halt_new_opens);
  const paperBalance = session.synthetic_active_trading_balance ?? 0;
  const paperPeak = session.synthetic_peak_equity ?? 0;
  const paperBootstrap = (session.synthetic_current_tier ?? 0) === 0;

  const modalTitle =
    confirmAction === 'start'
      ? 'Start synthetics bot'
      : confirmAction === 'stop'
        ? 'Stop synthetics bot'
        : confirmAction === 'halt'
          ? 'Halt new trades'
          : confirmAction === 'resume'
            ? 'Resume new trades'
            : '';
  const modalConfirmLabel =
    confirmAction === 'start'
      ? 'Start synthetics'
      : confirmAction === 'stop'
        ? 'Stop synthetics'
        : confirmAction === 'halt'
          ? 'Halt new trades'
          : confirmAction === 'resume'
            ? 'Resume new trades'
            : '';
  const modalConfirmVariant =
    confirmAction === 'stop' || confirmAction === 'halt' ? 'destructive' : 'primary';

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
              <>
                {haltNewOpensActive ? (
                  <Button variant="secondary" onClick={() => setConfirmAction('resume')}>
                    Resume new trades
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmAction('halt')}>
                    Halt new trades
                  </Button>
                )}
                <Button variant="destructive" onClick={() => setConfirmAction('stop')}>
                  Stop synthetics
                </Button>
              </>
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

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <StatusPill
            label={`synthetics: ${session.synthetic_status}`}
            tone={botStatusTone(session.synthetic_status)}
            pulse={running}
          />
          {haltNewOpensActive ? (
            <StatusPill label="New trades halted" tone="warning" />
          ) : null}
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
        title={modalTitle}
        confirmLabel={modalConfirmLabel}
        confirmVariant={modalConfirmVariant}
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
        ) : null}
        {confirmAction === 'stop' ? (
          <p>
            This fully stops the synthetics bot — the tick loop ends, so Telos will no
            longer monitor or reconcile an already-open position (broker SL/TP still
            apply at the broker). Live-trading confirmation is cleared
            {mode === 'real'
              ? ' and must be retyped before the next real-mode Start'
              : ''}
            . To keep monitoring an open position while blocking new opens, use Halt
            new trades instead.
          </p>
        ) : null}
        {confirmAction === 'halt' ? (
          <p>
            Halt new trades keeps the synthetics bot running so it can still monitor
            and reconcile an already-open position, but it will not open any new ones.
            This is different from Stop synthetics, which ends the tick loop entirely
            (including monitoring). You can Resume new trades later without
            restarting.
          </p>
        ) : null}
        {confirmAction === 'resume' ? (
          <p>
            Resume new trades clears the soft-halt. The synthetics bot stays running
            and may open new positions again on the next eligible tick. Open positions
            were already being monitored while halted.
          </p>
        ) : null}
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
