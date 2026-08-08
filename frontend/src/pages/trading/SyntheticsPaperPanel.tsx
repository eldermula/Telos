import { useCallback, useEffect, useState } from 'react';
import { GlassCard } from '../../components/ui/GlassCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { StatusPill, botStatusTone } from '../../components/ui/StatusPill';
import {
  getSyntheticSession,
  startSyntheticSession,
  stopSyntheticSession,
  type SyntheticSession,
} from '../../lib/api/syntheticBot';
import { ApiError } from '../../types/api';

/**
 * Owner-facing paper Start/Stop for the synthetics pathway
 * (Volatility Indices). Separate from forex Start Trading —
 * own runtime, own status column, no live-order path.
 */
export function SyntheticsPaperPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [session, setSession] = useState<SyntheticSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<'start' | 'stop' | null>(null);

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

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      if (confirm === 'start') {
        setSession(await startSyntheticSession());
      } else if (confirm === 'stop') {
        setSession(await stopSyntheticSession());
      }
      setConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Synthetics action failed');
    } finally {
      setPending(false);
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

  return (
    <>
      <GlassCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="type-display-sm text-text-primary">Synthetics (paper)</h2>
            <p className="type-caption mt-1 max-w-xl text-text-secondary">
              Volatility Indices pathway — own runtime, no news correlation, paper mode
              only. Watchlist: Vol 10 / 25 / 50 / 75 / 100.
            </p>
          </div>
          {running ? (
            <Button variant="destructive" onClick={() => setConfirm('stop')}>
              Stop synthetics
            </Button>
          ) : (
            <Button onClick={() => setConfirm('start')}>Start synthetics</Button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <StatusPill
            label={`synthetics: ${session.synthetic_status}`}
            tone={botStatusTone(session.synthetic_status)}
            pulse={running}
          />
        </div>

        {error ? <p className="type-caption mt-3 text-danger">{error}</p> : null}
      </GlassCard>

      <Modal
        open={confirm !== null}
        title={confirm === 'start' ? 'Start synthetics paper bot' : 'Stop synthetics paper bot'}
        confirmLabel={confirm === 'start' ? 'Start synthetics' : 'Stop synthetics'}
        confirmVariant={confirm === 'start' ? 'primary' : 'destructive'}
        confirming={pending}
        onClose={() => setConfirm(null)}
        onConfirm={() => void onConfirm()}
      >
        {confirm === 'start' ? (
          <p>
            Starts the synthetics paper bot on Volatility Indices. No real MT5 orders are
            placed by this pathway. Forex and crypto runtimes are separate.
          </p>
        ) : (
          <p>
            Stops the synthetics paper bot from opening new positions. Any open paper
            position stays until it resolves against live quotes.
          </p>
        )}
      </Modal>
    </>
  );
}
