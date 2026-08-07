import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { GlassCard } from '../../components/ui/GlassCard';
import {
  getBusinessMetrics,
  getTradingMetrics,
  type BusinessMetricsResponse,
  type TradingMetricsResponse,
} from '../../lib/api/analytics';
import type { PerformanceRange } from '../../lib/api/portfolio';
import { ApiError } from '../../types/api';

const RANGES: PerformanceRange[] = ['7d', '30d', '90d', 'all'];

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

export function AnalyticsPage() {
  const [range, setRange] = useState<PerformanceRange>('30d');
  const [trading, setTrading] = useState<TradingMetricsResponse | null>(null);
  const [business, setBusiness] = useState<BusinessMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextRange: PerformanceRange) => {
    setError(null);
    const [tradingRes, businessRes] = await Promise.all([
      getTradingMetrics(nextRange),
      getBusinessMetrics(),
    ]);
    setTrading(tradingRes);
    setBusiness(businessRes);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load(range);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Could not load analytics.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, range]);

  if (loading) {
    return <p className="text-text-secondary">Loading analytics…</p>;
  }

  const m = trading?.metrics;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-display-sm">Analytics</h1>
          <p className="mt-1 text-text-secondary">
            Trading performance metrics computed from your closed trades.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <Button
              key={r}
              variant={r === range ? 'primary' : 'ghost'}
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-[8px] border border-state-danger/40 bg-state-danger/10 px-4 py-3 text-state-danger">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Net P&L" value={formatNumber(m?.net_pnl)} />
        <MetricCard
          label="Win rate"
          value={m?.win_rate == null ? '—' : `${(m.win_rate * 100).toFixed(1)}%`}
        />
        <MetricCard label="Profit factor" value={formatNumber(m?.profit_factor)} />
        <MetricCard
          label="Current drawdown"
          value={
            m?.current_drawdown_pct == null
              ? '—'
              : `${(m.current_drawdown_pct * 100).toFixed(1)}%`
          }
        />
        <MetricCard label="Avg win" value={formatNumber(m?.avg_win)} />
        <MetricCard label="Avg loss" value={formatNumber(m?.avg_loss)} />
        <MetricCard label="Wins" value={String(m?.wins ?? 0)} />
        <MetricCard label="Losses" value={String(m?.losses ?? 0)} />
      </div>

      <GlassCard>
        <h2 className="type-heading mb-4">P&L series</h2>
        <DataTable
          emptyMessage="No closed trades in this range yet."
          getRowKey={(row) => row.id}
          columns={[
            { key: 'closed_at', header: 'Closed', render: (row) => row.closed_at },
            { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
            {
              key: 'pnl',
              header: 'P&L',
              align: 'right',
              numeric: true,
              render: (row) => row.pnl,
            },
            {
              key: 'cumulative_pnl',
              header: 'Cumulative',
              align: 'right',
              numeric: true,
              render: (row) => row.cumulative_pnl,
            },
          ]}
          rows={(trading?.series ?? [])
            .slice()
            .reverse()
            .map((point, index) => ({
              id: `${point.closed_at}-${index}`,
              closed_at: new Date(point.closed_at).toLocaleString(),
              symbol: point.symbol,
              pnl: formatNumber(point.pnl),
              cumulative_pnl: formatNumber(point.cumulative_pnl),
            }))}
        />
      </GlassCard>

      <GlassCard>
        <h2 className="type-heading mb-2">Business metrics</h2>
        <p className="text-text-secondary">
          {business?.available
            ? 'Business metrics are available.'
            : business?.reason ||
              'Business-level analytics are not configured yet.'}
        </p>
      </GlassCard>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard>
      <p className="type-caption text-text-secondary">{label}</p>
      <p className="type-data-lg mt-1">{value}</p>
    </GlassCard>
  );
}
