import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { GlassCard } from '../../components/ui/GlassCard';
import {
  getHoldings,
  getPerformance,
  type PerformanceRange,
  type PortfolioHolding,
  type PortfolioPerformanceResponse,
} from '../../lib/api/portfolio';
import { ApiError } from '../../types/api';

const RANGES: PerformanceRange[] = ['7d', '30d', '90d', 'all'];

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

type HoldingRow = {
  id: string;
  symbol: string;
  net_direction: string;
  net_lot_size: string;
  open_count: number;
};

type PerfRow = {
  id: string;
  closed_at: string;
  symbol: string;
  direction: string;
  pnl: string;
  cumulative_pnl: string;
};

export function PortfolioPage() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [performance, setPerformance] = useState<PortfolioPerformanceResponse | null>(null);
  const [range, setRange] = useState<PerformanceRange>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextRange: PerformanceRange) => {
    setError(null);
    const [holdingsRes, performanceRes] = await Promise.all([
      getHoldings(),
      getPerformance(nextRange),
    ]);
    setHoldings(holdingsRes.holdings);
    setPerformance(performanceRes);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load(range);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Could not load portfolio.',
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
    return <p className="text-text-secondary">Loading portfolio…</p>;
  }

  const summary = performance?.summary;
  const holdingRows: HoldingRow[] = holdings.map((h) => ({
    id: h.symbol,
    symbol: h.symbol,
    net_direction: h.net_direction,
    net_lot_size: formatNumber(h.net_lot_size, 4),
    open_count: h.open_count,
  }));
  const perfRows: PerfRow[] = (performance?.series ?? [])
    .slice()
    .reverse()
    .map((point) => ({
      id: point.trade_id,
      closed_at: new Date(point.closed_at).toLocaleString(),
      symbol: point.symbol,
      direction: point.direction,
      pnl: formatNumber(point.pnl),
      cumulative_pnl: formatNumber(point.cumulative_pnl),
    }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="type-display-sm">Portfolio</h1>
        <p className="mt-1 text-text-secondary">
          Open holdings and closed-trade performance from your Telos trading
          session.
        </p>
      </div>

      {error ? (
        <p className="rounded-[8px] border border-state-danger/40 bg-state-danger/10 px-4 py-3 text-state-danger">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <GlassCard>
          <p className="type-caption text-text-secondary">Net P&L ({range})</p>
          <p className="type-data-lg mt-1">{formatNumber(summary?.net_pnl)}</p>
        </GlassCard>
        <GlassCard>
          <p className="type-caption text-text-secondary">Win rate</p>
          <p className="type-data-lg mt-1">
            {summary?.win_rate == null
              ? '—'
              : `${(summary.win_rate * 100).toFixed(1)}%`}
          </p>
        </GlassCard>
        <GlassCard>
          <p className="type-caption text-text-secondary">Closed trades</p>
          <p className="type-data-lg mt-1">{summary?.trade_count ?? 0}</p>
        </GlassCard>
      </div>

      <GlassCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-heading">Open holdings</h2>
          <Link to="/trading">
            <Button variant="secondary">View trading</Button>
          </Link>
        </div>
        <DataTable
          emptyMessage="No open positions — link a broker and press Start Trading to begin."
          getRowKey={(row) => row.id}
          columns={[
            { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
            { key: 'net_direction', header: 'Direction', render: (row) => row.net_direction },
            {
              key: 'net_lot_size',
              header: 'Net lots',
              align: 'right',
              numeric: true,
              render: (row) => row.net_lot_size,
            },
            {
              key: 'open_count',
              header: 'Open',
              align: 'right',
              numeric: true,
              render: (row) => row.open_count,
            },
          ]}
          rows={holdingRows}
        />
      </GlassCard>

      <GlassCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-heading">Performance</h2>
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
        <DataTable
          emptyMessage="No closed trades in this range yet."
          getRowKey={(row) => row.id}
          columns={[
            { key: 'closed_at', header: 'Closed', render: (row) => row.closed_at },
            { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
            { key: 'direction', header: 'Side', render: (row) => row.direction },
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
          rows={perfRows}
        />
      </GlassCard>
    </div>
  );
}
