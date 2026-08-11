import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTradingSession } from '../../hooks/useTradingSession';
import { useBotEvents, useBotEventsContext } from '../../hooks/useBotEvents';
import type { BotEventMessage } from '../../lib/ws';
import { getLiveAccountInfo, getPositions, type LiveAccountInfo } from '../../lib/api/trading';
import { ApiError } from '../../types/api';
import { GlassCard } from '../../components/ui/GlassCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import {
  StatusPill,
  botStatusTone,
  strategyModeTone,
} from '../../components/ui/StatusPill';
import { TradingTables } from './TradingTables';
import { ConfirmLiveTradingModal } from './ConfirmLiveTradingModal';
import { SyntheticsPaperPanel } from './SyntheticsPaperPanel';

const LIVE_ACCOUNT_POLL_MS = 2000;

function hasOpenRealForexTrade(
  positions: { execution_mode?: string; asset_class?: string; status?: string }[],
): boolean {
  return positions.some(
    (p) =>
      p.status === 'open' &&
      p.execution_mode === 'real' &&
      p.asset_class === 'forex_gold',
  );
}

export function TradingPage() {
  const {
    session,
    brokerGate,
    loading,
    error,
    actionPending,
    start,
    stop,
    haltNewOpens,
    resumeNewOpens,
    confirmLive,
    reload,
    applySessionPatch,
  } = useTradingSession();
  const [confirmAction, setConfirmAction] = useState<
    'start' | 'stop' | 'halt' | 'resume' | null
  >(null);
  const [confirmLiveOpen, setConfirmLiveOpen] = useState(false);
  const [tradeRefreshKey, setTradeRefreshKey] = useState(0);
  const [liveAccount, setLiveAccount] = useState<LiveAccountInfo | null>(null);
  const [liveAccountError, setLiveAccountError] = useState<string | null>(null);
  const [openRealForex, setOpenRealForex] = useState(false);
  const { connectionState } = useBotEventsContext();
  const hasConnectedBeforeRef = useRef(false);

  const confirmationActive =
    session != null && session.live_trading_confirmed_at != null;
  const mode: 'paper' | 'real' =
    confirmationActive || openRealForex ? 'real' : 'paper';
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const refreshOpenRealForex = useCallback(async () => {
    try {
      const positions = await getPositions();
      setOpenRealForex(hasOpenRealForexTrade(positions));
    } catch {
      // Keep last-known openRealForex on transient failures.
    }
  }, []);

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

  useEffect(() => {
    void refreshOpenRealForex();
  }, [refreshOpenRealForex, tradeRefreshKey]);

  useEffect(() => {
    if (mode !== 'real') {
      setLiveAccount(null);
      setLiveAccountError(null);
      return;
    }

    void refreshLiveAccount();
    const id = window.setInterval(() => {
      void refreshLiveAccount();
      void refreshOpenRealForex();
    }, LIVE_ACCOUNT_POLL_MS);
    return () => window.clearInterval(id);
  }, [mode, tradeRefreshKey, refreshLiveAccount, refreshOpenRealForex]);

  const onBotEvent = useCallback(
    (message: BotEventMessage) => {
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      switch (message.event) {
        case 'bot.status_changed':
          if (typeof payload.status === 'string') {
            applySessionPatch({ status: payload.status as 'running' | 'stopped' | 'error' });
          }
          if (typeof payload.halt_new_opens === 'boolean') {
            applySessionPatch({ halt_new_opens: payload.halt_new_opens });
          }
          if (typeof payload.synthetic_status === 'string') {
            applySessionPatch({
              synthetic_status: payload.synthetic_status as
                | 'running'
                | 'stopped'
                | 'error',
            });
          }
          if (typeof payload.synthetic_halt_new_opens === 'boolean') {
            applySessionPatch({
              synthetic_halt_new_opens: payload.synthetic_halt_new_opens,
            });
          }
          void refreshOpenRealForex();
          break;
        case 'strategy.switched':
          if (typeof payload.to === 'string') {
            applySessionPatch({
              active_strategy_mode: payload.to as 'STRATEGY_A' | 'STRATEGY_B' | 'HALTED',
            });
          }
          break;
        case 'equity.updated':
          if (modeRef.current !== 'real') {
            if (
              typeof payload.active_trading_balance === 'number' &&
              typeof payload.peak_equity === 'number'
            ) {
              // bootstrap_phase / bootstrap_risk_ceiling_pct intentionally left
              // as last-known-good here (not recomputed client-side, per the
              // decision not to duplicate the Section 3a formula) — corrected
              // on the next full session reload (reconnect, Start/Stop, or
              // page load).
              applySessionPatch({
                active_trading_balance: payload.active_trading_balance,
                peak_equity: payload.peak_equity,
              });
            }
          }
          break;
        case 'trade.opened':
        case 'trade.closed':
          // 6.1: a position can now sit open for real time instead of
          // opening and closing in the same tick, so the positions
          // table needs to refresh on open too, not just on close.
          setTradeRefreshKey((k) => k + 1);
          void refreshOpenRealForex();
          if (modeRef.current === 'real') {
            void refreshLiveAccount();
          }
          break;
        default:
          break;
      }
    },
    [applySessionPatch, refreshLiveAccount, refreshOpenRealForex],
  );

  useBotEvents(onBotEvent);

  useEffect(() => {
    if (connectionState !== 'open') return;
    if (hasConnectedBeforeRef.current) {
      // Reconnected after a drop — REST is the source of truth for anything
      // missed while disconnected (06_API_Specification.md Section 11).
      void reload();
      setTradeRefreshKey((k) => k + 1);
    }
    hasConnectedBeforeRef.current = true;
  }, [connectionState, reload]);

  if (loading) {
    return <p className="text-text-secondary">Loading trading session…</p>;
  }

  if (brokerGate === 'no-broker') {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="type-display-sm">Trading</h1>
        </header>
        <GlassCard>
          <p className="text-text-secondary">
            Link a broker account before starting the trading bot.
          </p>
          <div className="mt-4">
            <Link to="/onboarding/broker">
              <Button>Link broker account</Button>
            </Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  function onStartClick() {
    // Option 2 Layer 2: if real trading is available and not yet
    // confirmed (or the prior confirmation has expired), the
    // Confirm Live modal must come first — the whole point of Layer 2
    // is a real person physically typing the phrase before any Start
    // that could resolve to real mode.
    if (
      session?.real_trading_available &&
      !session.live_trading_confirmed_at
    ) {
      setConfirmLiveOpen(true);
      return;
    }
    setConfirmAction('start');
  }

  async function onConfirmLive(phrase: string) {
    await confirmLive(phrase);
    setConfirmLiveOpen(false);
    // After a successful Layer 2 confirm, still show the normal Start
    // confirmation — confirming live intent is not the same act as
    // starting the bot.
    setConfirmAction('start');
  }

  async function onConfirm() {
    if (confirmAction === 'start') await start();
    if (confirmAction === 'stop') await stop();
    if (confirmAction === 'halt') await haltNewOpens();
    if (confirmAction === 'resume') await resumeNewOpens();
    setConfirmAction(null);
  }

  const isRunning = session?.status === 'running';
  // status==='error' still needs a way back — stopSession() already
  // unconditionally clears error status (bot-runtime.js halts to 'error',
  // Stop is the only path back to 'stopped'), but the header used to only
  // ever show Start Trading in that state, which just re-throws
  // BOT_INSTANCE_ERROR. Show Stop whenever there's an error to clear too.
  const canStop = isRunning || session?.status === 'error';
  const haltNewOpensActive = Boolean(session?.halt_new_opens);
  const liveConfirmed = Boolean(session?.live_trading_confirmed_at);

  const paperBalance = session?.active_trading_balance ?? 0;
  const paperPeak = session?.peak_equity ?? 0;
  const displayBalance =
    mode === 'real' && liveAccount ? liveAccount.balance : paperBalance;
  const displayPeak = mode === 'real' && liveAccount ? liveAccount.equity : paperPeak;

  const modalTitle =
    confirmAction === 'start'
      ? 'Start Trading'
      : confirmAction === 'stop'
        ? 'Stop Trading'
        : confirmAction === 'halt'
          ? 'Halt new trades'
          : confirmAction === 'resume'
            ? 'Resume new trades'
            : '';
  const modalConfirmLabel = modalTitle;
  const modalConfirmVariant =
    confirmAction === 'stop' || confirmAction === 'halt' ? 'destructive' : 'primary';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="type-display-sm">Trading</h1>
        {canStop ? (
          <div className="flex flex-wrap gap-2.5">
            {isRunning ? (
              haltNewOpensActive ? (
                <Button variant="secondary" onClick={() => setConfirmAction('resume')}>
                  Resume new trades
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmAction('halt')}>
                  Halt new trades
                </Button>
              )
            ) : null}
            <Button variant="destructive" onClick={() => setConfirmAction('stop')}>
              Stop Trading
            </Button>
          </div>
        ) : (
          <Button onClick={onStartClick}>Start Trading</Button>
        )}
      </header>

      {error ? <p className="type-caption text-danger">{error}</p> : null}

      {session ? (
        <GlassCard>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              label={mode === 'real' ? 'REAL' : 'PAPER'}
              tone={mode === 'real' ? 'warning' : 'muted'}
            />
            <StatusPill
              label={session.status}
              tone={botStatusTone(session.status)}
              pulse={session.status === 'running'}
            />
            <StatusPill
              label={session.active_strategy_mode}
              tone={strategyModeTone(session.active_strategy_mode)}
            />
            {haltNewOpensActive ? (
              <StatusPill label="New trades halted" tone="warning" />
            ) : null}
            {session.real_trading_available ? (
              <StatusPill
                label={liveConfirmed ? 'Live confirmed' : 'Live available'}
                tone={liveConfirmed ? 'danger' : 'warning'}
              />
            ) : null}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border-subtle pt-6 md:grid-cols-4">
            <div>
              <p className="type-caption">Balance</p>
              <p className="type-data-lg mt-1 tabular-nums text-accent-gold">
                ${displayBalance.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="type-caption">Peak equity</p>
              <p className="type-data-base mt-1 tabular-nums">
                ${displayPeak.toFixed(2)}
              </p>
            </div>
            {session.bootstrap_phase ? (
              <div>
                <p className="type-caption">Phase</p>
                <StatusPill label="Bootstrap Phase" tone="warning" className="mt-1" />
              </div>
            ) : (
              <div>
                <p className="type-caption">Tier</p>
                <p className="type-data-base mt-1">{session.current_tier}</p>
              </div>
            )}
            {session.bootstrap_phase && session.bootstrap_risk_ceiling_pct !== null ? (
              <div>
                <p className="type-caption">Risk ceiling</p>
                <p className="type-data-base mt-1">
                  ~{(session.bootstrap_risk_ceiling_pct * 100).toFixed(1)}%
                </p>
              </div>
            ) : null}
          </div>

          {mode === 'real' && liveAccountError ? (
            <p className="type-caption mt-3 text-text-secondary">{liveAccountError}</p>
          ) : null}
        </GlassCard>
      ) : null}

      <SyntheticsPaperPanel refreshKey={tradeRefreshKey} />

      <TradingTables
        refreshKey={tradeRefreshKey}
        onClosed={() => {
          setTradeRefreshKey((k) => k + 1);
          void reload();
        }}
      />

      <Modal
        open={confirmAction !== null}
        title={modalTitle}
        confirmLabel={modalConfirmLabel}
        confirmVariant={modalConfirmVariant}
        confirming={
          actionPending === 'start' ||
          actionPending === 'stop' ||
          actionPending === 'halt' ||
          actionPending === 'resume'
        }
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void onConfirm()}
      >
        {confirmAction === 'start' ? (
          <p>
            {liveConfirmed
              ? 'Live trading is confirmed for this session. Starting the bot may place real orders against your MT5 account.'
              : 'This starts the automated trading bot on your linked broker account. New trades may be placed according to the active strategy.'}
          </p>
        ) : null}
        {confirmAction === 'stop' ? (
          <p>
            This fully stops the bot — the tick loop ends, so Telos will no longer
            monitor or reconcile an already-open position (broker SL/TP still apply
            at the broker). Live-trading confirmation is cleared
            {liveConfirmed ? ' and must be retyped before the next real-mode Start' : ''}
            . To keep monitoring an open position while blocking new opens, use Halt
            new trades instead.
          </p>
        ) : null}
        {confirmAction === 'halt' ? (
          <p>
            Halt new trades keeps the bot running so it can still monitor and
            reconcile an already-open position, but it will not open any new ones.
            This is different from Stop Trading, which ends the tick loop entirely
            (including monitoring). You can Resume new trades later without
            restarting.
          </p>
        ) : null}
        {confirmAction === 'resume' ? (
          <p>
            Resume new trades clears the soft-halt. The bot stays running and may
            open new positions again on the next eligible tick. Open positions were
            already being monitored while halted.
          </p>
        ) : null}
      </Modal>

      <ConfirmLiveTradingModal
        open={confirmLiveOpen}
        confirming={actionPending === 'confirm-live'}
        allowDemoConfirm={Boolean(session?.allow_demo_confirm)}
        onClose={() => setConfirmLiveOpen(false)}
        onConfirm={onConfirmLive}
      />
    </div>
  );
}
