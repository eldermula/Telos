import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/GlassCard';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { StatusPill, strategyModeTone } from '../../components/ui/StatusPill';
import { DataTable } from '../../components/ui/DataTable';

type DemoRow = { id: string; symbol: string; pnl: string };

const demoRows: DemoRow[] = [
  { id: '1', symbol: 'EURUSD', pnl: '+12.40' },
  { id: '2', symbol: 'GBPUSD', pnl: '-4.10' },
];

/** Increment 5.2 showcase — kept at /dev/ui for visual regression while building screens. */
export function UiShowcasePage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="type-caption uppercase tracking-[0.12em]">Increment 5.2</p>
        <h1 className="type-display-sm mt-1 text-accent-gold">Component library</h1>
      </header>

      <GlassCard>
        <h2 className="type-heading">Buttons & status</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill label="connected" tone="success" />
          <StatusPill label="running" tone="success" pulse />
          <StatusPill label="STRATEGY_A" tone={strategyModeTone('STRATEGY_A')} />
          <StatusPill label="HALTED" tone={strategyModeTone('HALTED')} />
        </div>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open confirm modal
          </Button>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="type-heading mb-4">Form input</h2>
        <Input label="Email" type="email" placeholder="you@firm.com" />
      </GlassCard>

      <GlassCard>
        <h2 className="type-heading mb-2">Data table</h2>
        <DataTable
          rows={demoRows}
          getRowKey={(r: DemoRow) => r.id}
          emptyMessage="No rows"
          columns={[
            { key: 'symbol', header: 'Symbol', render: (r: DemoRow) => r.symbol },
            {
              key: 'pnl',
              header: 'P&L',
              align: 'right',
              numeric: true,
              render: (r: DemoRow) => r.pnl,
            },
          ]}
        />
      </GlassCard>

      <Modal
        open={modalOpen}
        title="Stop Trading"
        confirmLabel="Stop Trading"
        confirmVariant="destructive"
        onClose={() => setModalOpen(false)}
        onConfirm={() => setModalOpen(false)}
      >
        <p>
          This stops the bot from placing new trades. Open positions stay open.
        </p>
      </Modal>
    </div>
  );
}
