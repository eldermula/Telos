import { useEffect, useMemo, useState } from 'react';
import { getDecisionLog, getHistory, getPositions } from '../../lib/api/trading';
import { closeSyntheticPosition } from '../../lib/api/syntheticBot';
import type { DecisionLogEntry, Trade } from '../../types/trading';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { GlassCard } from '../../components/ui/GlassCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../types/api';

/** Up to 4 dp; trim trailing zeros. Nonzero lots must never render as "0.00". */
function formatLotSize(lotSize: number): string {
  if (!Number.isFinite(lotSize)) return '—';
  if (lotSize === 0) return '0';
  const fixed = lotSize.toFixed(4);
  if (Number(fixed) === 0) return String(lotSize);
  return fixed.replace(/\.?0+$/, '');
}

const historyColumns: DataTableColumn<Trade>[] = [
  { key: 'opened_at', header: 'Opened', render: (t) => new Date(t.opened_at).toLocaleString() },
  { key: 'direction', header: 'Direction', render: (t) => t.direction },
  {
    key: 'lot_size',
    header: 'Lot size',
    align: 'right',
    numeric: true,
    render: (t) => formatLotSize(t.lot_size),
  },
  {
    key: 'pnl',
    header: 'P&L',
    align: 'right',
    numeric: true,
    render: (t) =>
      t.pnl === null ? '—' : `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}`,
  },
];

const decisionColumns: DataTableColumn<DecisionLogEntry>[] = [
  {
    key: 'timestamp',
    header: 'Time',
    render: (d) => new Date(d.timestamp).toLocaleString(),
  },
  { key: 'decision_type', header: 'Decision', render: (d) => d.decision_type },
  {
    key: 'triggering_condition',
    header: 'Reason',
    render: (d) => d.triggering_condition,
  },
];

export function TradingTables({
  refreshKey = 0,
  onClosed,
}: {
  refreshKey?: number;
  onClosed?: () => void;
}) {
  const [positions, setPositions] = useState<Trade[]>([]);
  const [history, setHistory] = useState<Trade[]>([]);
  const [decisions, setDecisions] = useState<DecisionLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<Trade | null>(null);
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [positionsRes, historyRes, decisionsRes] = await Promise.all([
          getPositions(),
          getHistory(),
          getDecisionLog(),
        ]);
        if (cancelled) return;
        setPositions(positionsRes);
        setHistory(historyRes.data);
        setDecisions(decisionsRes.data);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Could not load trading data.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // refreshKey bumps on trade.closed / WS reconnect (05.7) to pull latest rows.
  }, [refreshKey]);

  const positionColumns: DataTableColumn<Trade>[] = useMemo(
    () => [
      {
        key: 'symbol',
        header: 'Symbol',
        render: (t) => t.symbol || '—',
      },
      { key: 'direction', header: 'Direction', render: (t) => t.direction },
      {
        key: 'entry_price',
        header: 'Entry',
        align: 'right',
        numeric: true,
        render: (t) => t.entry_price.toFixed(5),
      },
      {
        key: 'lot_size',
        header: 'Lot size',
        align: 'right',
        numeric: true,
        render: (t) => formatLotSize(t.lot_size),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (t) =>
          t.asset_class === 'synthetic' && t.status === 'open' ? (
            <Button variant="ghost" onClick={() => {
              setCloseError(null);
              setCloseTarget(t);
            }}>
              Close position
            </Button>
          ) : null,
      },
    ],
    [],
  );

  async function onConfirmClose() {
    if (!closeTarget) return;
    setClosePending(true);
    setCloseError(null);
    try {
      await closeSyntheticPosition(closeTarget.id);
      setCloseTarget(null);
      const [positionsRes, historyRes] = await Promise.all([
        getPositions(),
        getHistory(),
      ]);
      setPositions(positionsRes);
      setHistory(historyRes.data);
      onClosed?.();
    } catch (err) {
      setCloseError(
        err instanceof ApiError ? err.message : 'Close position failed.',
      );
    } finally {
      setClosePending(false);
    }
  }

  const closeSymbol = closeTarget?.symbol || 'this';

  return (
    <div className="flex flex-col gap-6">
      {error ? <p className="type-caption text-danger">{error}</p> : null}

      <GlassCard>
        <h2 className="type-heading mb-2">Open positions</h2>
        <DataTable
          rows={positions}
          getRowKey={(t) => t.id}
          columns={positionColumns}
          emptyMessage="No open positions."
        />
      </GlassCard>

      <GlassCard>
        <h2 className="type-heading mb-2">Trade history</h2>
        <DataTable
          rows={history}
          getRowKey={(t) => t.id}
          columns={historyColumns}
          emptyMessage="No trades yet — link a broker account and press Start Trading to begin."
        />
      </GlassCard>

      <GlassCard>
        <h2 className="type-heading mb-2">Decision log</h2>
        <DataTable
          rows={decisions}
          getRowKey={(d) => d.id}
          columns={decisionColumns}
          emptyMessage="No bot decisions logged yet."
        />
      </GlassCard>

      <Modal
        open={closeTarget !== null}
        title="Close position"
        confirmLabel="Close position"
        confirmVariant="destructive"
        confirming={closePending}
        onClose={() => {
          if (closePending) return;
          setCloseTarget(null);
          setCloseError(null);
        }}
        onConfirm={() => void onConfirmClose()}
      >
        <p>
          This closes your {closeSymbol} position at the current market price. Any
          profit or loss becomes final and updates your balance immediately.
        </p>
        {closeError ? <p className="type-caption mt-3 text-danger">{closeError}</p> : null}
      </Modal>
    </div>
  );
}
