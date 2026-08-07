import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTradingSession } from '../../hooks/useTradingSession';
import { useBotEvents } from '../../hooks/useBotEvents';
import type { BotEventMessage } from '../../lib/ws';
import { getDecisionLog, getHistory } from '../../lib/api/trading';
import type { DecisionLogEntry, Trade } from '../../types/trading';
import { GlassCard } from '../../components/ui/GlassCard';
import { Button } from '../../components/ui/Button';
import {
  StatusPill,
  botStatusTone,
  strategyModeTone,
} from '../../components/ui/StatusPill';

export function DashboardPage() {
  const { session, brokerGate, loading, applySessionPatch } = useTradingSession();
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [recentDecisions, setRecentDecisions] = useState<DecisionLogEntry[]>([]);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);

  const onBotEvent = useCallback(
    (message: BotEventMessage) => {
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      if (
        message.event === 'equity.updated' &&
        typeof payload.active_trading_balance === 'number' &&
        typeof payload.peak_equity === 'number'
      ) {
        applySessionPatch({
          active_trading_balance: payload.active_trading_balance,
          peak_equity: payload.peak_equity,
        });
      }
      if (message.event === 'bot.status_changed' && typeof payload.status === 'string') {
        applySessionPatch({ status: payload.status as 'running' | 'stopped' | 'error' });
      }
      if (message.event === 'trade.opened' || message.event === 'trade.closed') {
        // 6.1: trade_approved (position opened) now lands in the
        // decision log before trade_closed does — refresh on both so
        // "Recent activity" doesn't wait for a still-open position to
        // resolve before showing it was approved.
        setActivityRefreshKey((k) => k + 1);
      }
    },
    [applySessionPatch],
  );

  useBotEvents(onBotEvent);

  useEffect(() => {
    if (brokerGate !== 'ready') return;
    let cancelled = false;
    (async () => {
      try {
        const [historyRes, decisionRes] = await Promise.all([
          getHistory(1, 5),
          getDecisionLog(1, 5),
        ]);
        if (cancelled) return;
        setRecentTrades(historyRes.data);
        setRecentDecisions(decisionRes.data);
      } catch {
        // Non-critical for the Dashboard summary; Trading screen shows full detail + errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brokerGate, activityRefreshKey]);

  if (loading) {
    return <p className="text-text-secondary">Loading dashboard…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="type-display-sm">Dashboard</h1>
      </header>

      {brokerGate === 'no-broker' ? (
        <GlassCard>
          <p className="text-text-secondary">
            Link a broker account, then press Start Trading to watch live
            activity here.
          </p>
          <div className="mt-4">
            <Link to="/onboarding/broker">
              <Button>Link broker account</Button>
            </Link>
          </div>
        </GlassCard>
      ) : (
        <>
          <GlassCard>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="type-caption">Account balance</p>
                <p className="type-display-lg mt-1 text-accent-gold">
                  ${session ? session.active_trading_balance.toFixed(2) : '—'}
                </p>
              </div>
              {session ? (
                <div className="flex flex-wrap gap-2">
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
              ) : null}
            </div>

            {session ? (
              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border-subtle pt-6 md:grid-cols-4">
                <div>
                  <p className="type-caption">Peak equity</p>
                  <p className="type-data-base mt-1">${session.peak_equity.toFixed(2)}</p>
                </div>
                {session.bootstrap_phase ? (
                  <>
                    <div>
                      <p className="type-caption">Phase</p>
                      <StatusPill label="Bootstrap Phase" tone="warning" className="mt-1" />
                    </div>
                    {session.bootstrap_risk_ceiling_pct !== null ? (
                      <div>
                        <p className="type-caption">Risk ceiling</p>
                        <p className="type-data-base mt-1">
                          ~{(session.bootstrap_risk_ceiling_pct * 100).toFixed(1)}%
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div>
                    <p className="type-caption">Tier</p>
                    <p className="type-data-base mt-1">{session.current_tier}</p>
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-6">
              <Link to="/trading">
                <Button variant="secondary">Go to Trading</Button>
              </Link>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-3">Recent activity</h2>
            {recentTrades.length === 0 && recentDecisions.length === 0 ? (
              <p className="type-caption">
                No trades yet — link a broker account and press Start Trading to
                begin.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {recentDecisions.map((d) => (
                  <li key={d.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.9375rem]">{d.triggering_condition}</span>
                    <span className="type-caption whitespace-nowrap">
                      {new Date(d.timestamp).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
                {recentTrades.map((t) => (
                  <li key={t.id} className="flex items-baseline justify-between gap-3">
                    <span className="type-data-base">
                      {t.direction} · {t.lot_size.toFixed(2)} lots
                    </span>
                    <span
                      className={`type-data-base ${
                        (t.pnl ?? 0) >= 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {t.pnl === null ? '—' : `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
