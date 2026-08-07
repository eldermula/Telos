import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTradingSession } from '../../hooks/useTradingSession';
import { useBotEvents, useBotEventsContext } from '../../hooks/useBotEvents';
import type { BotEventMessage } from '../../lib/ws';
import { GlassCard } from '../../components/ui/GlassCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import {
  StatusPill,
  botStatusTone,
  strategyModeTone,
} from '../../components/ui/StatusPill';
import { TradingTables } from './TradingTables';

export function TradingPage() {
  const {
    session,
    brokerGate,
    loading,
    error,
    actionPending,
    start,
    stop,
    reload,
    applySessionPatch,
  } = useTradingSession();
  const [confirmAction, setConfirmAction] = useState<'start' | 'stop' | null>(null);
  const [tradeRefreshKey, setTradeRefreshKey] = useState(0);
  const { connectionState } = useBotEventsContext();
  const hasConnectedBeforeRef = useRef(false);

  const onBotEvent = useCallback(
    (message: BotEventMessage) => {
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      switch (message.event) {
        case 'bot.status_changed':
          if (typeof payload.status === 'string') {
            applySessionPatch({ status: payload.status as 'running' | 'stopped' | 'error' });
          }
          break;
        case 'strategy.switched':
          if (typeof payload.to === 'string') {
            applySessionPatch({
              active_strategy_mode: payload.to as 'STRATEGY_A' | 'STRATEGY_B' | 'HALTED',
            });
          }
          break;
        case 'equity.updated':
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
          break;
        case 'trade.opened':
        case 'trade.closed':
          // 6.1: a position can now sit open for real time instead of
          // opening and closing in the same tick, so the positions
          // table needs to refresh on open too, not just on close.
          setTradeRefreshKey((k) => k + 1);
          break;
        default:
          break;
      }
    },
    [applySessionPatch],
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

  async function onConfirm() {
    if (confirmAction === 'start') await start();
    if (confirmAction === 'stop') await stop();
    setConfirmAction(null);
  }

  const isRunning = session?.status === 'running';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="type-display-sm">Trading</h1>
        {isRunning ? (
          <Button variant="destructive" onClick={() => setConfirmAction('stop')}>
            Stop Trading
          </Button>
        ) : (
          <Button onClick={() => setConfirmAction('start')}>Start Trading</Button>
        )}
      </header>

      {error ? <p className="type-caption text-danger">{error}</p> : null}

      {session ? (
        <GlassCard>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              label={session.status}
              tone={botStatusTone(session.status)}
              pulse={session.status === 'running'}
            />
            <StatusPill
              label={session.active_strategy_mode}
              tone={strategyModeTone(session.active_strategy_mode)}
            />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border-subtle pt-6 md:grid-cols-4">
            <div>
              <p className="type-caption">Balance</p>
              <p className="type-data-lg mt-1 text-accent-gold">
                ${session.active_trading_balance.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="type-caption">Peak equity</p>
              <p className="type-data-base mt-1">${session.peak_equity.toFixed(2)}</p>
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
        </GlassCard>
      ) : null}

      <TradingTables refreshKey={tradeRefreshKey} />

      <Modal
        open={confirmAction !== null}
        title={confirmAction === 'start' ? 'Start Trading' : 'Stop Trading'}
        confirmLabel={confirmAction === 'start' ? 'Start Trading' : 'Stop Trading'}
        confirmVariant={confirmAction === 'start' ? 'primary' : 'destructive'}
        confirming={actionPending !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void onConfirm()}
      >
        {confirmAction === 'start' ? (
          <p>
            This starts the automated trading bot on your linked broker account.
            New trades may be placed according to the active strategy.
          </p>
        ) : (
          <p>This stops the bot from placing new trades. Open positions stay open.</p>
        )}
      </Modal>
    </div>
  );
}
