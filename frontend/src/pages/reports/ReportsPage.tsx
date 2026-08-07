import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { GlassCard } from '../../components/ui/GlassCard';
import { Input } from '../../components/ui/Input';
import {
  createReport,
  downloadReport,
  listReports,
  type Report,
} from '../../lib/api/reports';
import { ApiError } from '../../types/api';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [periodStart, setPeriodStart] = useState(() => daysAgoIsoDate(30));
  const [periodEnd, setPeriodEnd] = useState(() => todayIsoDate());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const page = await listReports({ page: 1, limit: 50 });
    setReports(page.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load reports.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      await createReport({
        period_start: periodStart,
        period_end: periodEnd,
        format: 'csv',
      });
      await refresh();
      setMessage('Report generated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate report.');
    } finally {
      setCreating(false);
    }
  }

  async function onDownload(id: string) {
    setError(null);
    try {
      await downloadReport(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    }
  }

  if (loading) {
    return <p className="text-text-secondary">Loading reports…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="type-display-sm">Reports</h1>
        <p className="mt-1 text-text-secondary">
          Generate a CSV summary of closed trades for a selected period.
        </p>
      </div>

      {error ? (
        <p className="rounded-[8px] border border-state-danger/40 bg-state-danger/10 px-4 py-3 text-state-danger">
          {error}
        </p>
      ) : null}
      {message ? <p className="type-caption text-text-secondary">{message}</p> : null}

      <GlassCard>
        <h2 className="type-heading mb-4">Generate report</h2>
        <form className="flex max-w-xl flex-col gap-4" onSubmit={onCreate}>
          <Input
            label="Period start"
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            required
          />
          <Input
            label="Period end"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            required
          />
          <p className="type-caption text-text-secondary">
            Format: CSV (PDF generation is pending a library decision).
          </p>
          <div>
            <Button type="submit" disabled={creating}>
              {creating ? 'Generating…' : 'Generate CSV'}
            </Button>
          </div>
        </form>
      </GlassCard>

      <GlassCard>
        <h2 className="type-heading mb-4">Previous reports</h2>
        <DataTable
          emptyMessage="No reports yet."
          getRowKey={(row) => row.id}
          columns={[
            {
              key: 'period',
              header: 'Period',
              render: (row) => `${row.period_start} → ${row.period_end}`,
            },
            { key: 'format', header: 'Format', render: (row) => row.format },
            {
              key: 'generated_at',
              header: 'Generated',
              render: (row) => new Date(row.generated_at).toLocaleString(),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => (
                <Button variant="ghost" onClick={() => void onDownload(row.id)}>
                  Download
                </Button>
              ),
            },
          ]}
          rows={reports}
        />
      </GlassCard>
    </div>
  );
}
