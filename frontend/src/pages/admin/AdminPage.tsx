import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { GlassCard } from '../../components/ui/GlassCard';
import { Input } from '../../components/ui/Input';
import {
  disableSyntheticDemoConfirm,
  disableSyntheticDemoDispatch,
  enableSyntheticDemoConfirm,
  enableSyntheticDemoDispatch,
  getAdminUser,
  getSyntheticDemoConfirmStatus,
  getSyntheticDemoDispatchStatus,
  getSystemHealth,
  listAdminUsers,
  listCandidateStrategies,
  listRiskTiers,
  patchCandidateStrategy,
  patchRiskTier,
  type AdminUser,
  type AdminUserDetail,
  type CandidateStrategy,
  type RiskTier,
  type SyntheticDemoConfirmStatus,
  type SyntheticDemoDispatchStatus,
  type SystemHealth,
} from '../../lib/api/admin';
import { ApiError } from '../../types/api';

/** Admin accent per 07_UI_UX_Guide § open-questions settle (#5B7A9C). */
const ADMIN_ACCENT = '#5B7A9C';

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'health' | 'users' | 'tiers' | 'strategies' | 'demo'>('health');
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const [tiers, setTiers] = useState<RiskTier[]>([]);
  const [strategies, setStrategies] = useState<CandidateStrategy[]>([]);
  const [demoDispatch, setDemoDispatch] = useState<SyntheticDemoDispatchStatus | null>(null);
  const [demoConfirm, setDemoConfirm] = useState<SyntheticDemoConfirmStatus | null>(null);
  const [demoDispatchMinutes, setDemoDispatchMinutes] = useState('15');
  const [demoConfirmMinutes, setDemoConfirmMinutes] = useState('15');
  const [editTier, setEditTier] = useState<RiskTier | null>(null);
  const [ceilingDraft, setCeilingDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [h, u, t, s, d, c] = await Promise.all([
      getSystemHealth(),
      listAdminUsers({ page: 1, limit: 50 }),
      listRiskTiers(),
      listCandidateStrategies(),
      getSyntheticDemoDispatchStatus(),
      getSyntheticDemoConfirmStatus(),
    ]);
    setHealth(h);
    setUsers(u.data);
    setTiers(t.data);
    setStrategies(s.data);
    setDemoDispatch(d);
    setDemoConfirm(c);
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load admin data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.role, refresh]);

  if (user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  async function onSelectUser(id: string) {
    setError(null);
    try {
      setSelectedUser(await getAdminUser(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load user.');
    }
  }

  async function onConfirmTierPatch() {
    if (!editTier) return;
    const next = Number(ceilingDraft);
    if (!Number.isFinite(next) || next <= 0) {
      setError('max_risk_ceiling must be a positive number.');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await patchRiskTier(editTier.tier, { max_risk_ceiling: next });
      setEditTier(null);
      setMessage(`Tier ${editTier.tier} updated.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function onMarkReviewed(strategy: CandidateStrategy) {
    if (
      !window.confirm(
        `Mark "${strategy.name}" as reviewed by admin? This is recorded in the audit log.`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await patchCandidateStrategy(strategy.id, { reviewed_by_admin: true });
      setMessage(`Marked ${strategy.name} reviewed.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function onEnableDemoDispatch() {
    const minutes = Number.parseInt(demoDispatchMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('Dispatch duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable synthetics DEMO real-dispatch bypass (Layer 3) for ${minutes} minute(s)? ` +
          'Confirmed demo sessions may place real MT5 orders.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableSyntheticDemoDispatch(minutes);
      setDemoDispatch(status);
      setMessage(`Layer 3 demo-dispatch enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableDemoDispatch() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableSyntheticDemoDispatch();
      setDemoDispatch(status);
      setMessage('Layer 3 demo-dispatch disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onEnableDemoConfirm() {
    const minutes = Number.parseInt(demoConfirmMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('Confirm duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable synthetics DEMO confirm-live bypass (Layer 2) for ${minutes} minute(s)? ` +
          'Demo accounts may pass the confirm-live step. Layer 3 is still required to dispatch orders.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableSyntheticDemoConfirm(minutes);
      setDemoConfirm(status);
      setMessage(`Layer 2 demo-confirm enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableDemoConfirm() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableSyntheticDemoConfirm();
      setDemoConfirm(status);
      setMessage('Layer 2 demo-confirm disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  if (loading) {
    return <p className="text-text-secondary">Loading admin…</p>;
  }

  return (
    <div className="flex flex-col gap-6" style={{ ['--accent-admin' as string]: ADMIN_ACCENT }}>
      <div>
        <h1 className="type-display-sm" style={{ color: ADMIN_ACCENT }}>
          Admin
        </h1>
        <p className="mt-1 text-text-secondary">
          Users, system health, risk-tier tuning, candidate strategies, and testing toggles.
        </p>
      </div>

      {error ? (
        <p className="rounded-[8px] border border-state-danger/40 bg-state-danger/10 px-4 py-3 text-state-danger">
          {error}
        </p>
      ) : null}
      {message ? <p className="type-caption text-text-secondary">{message}</p> : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['health', 'System health'],
            ['users', 'Users'],
            ['tiers', 'Risk tiers'],
            ['strategies', 'Strategies'],
            ['demo', 'Demo dispatch'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            variant={tab === id ? 'primary' : 'ghost'}
            onClick={() => setTab(id)}
            style={tab === id ? { backgroundColor: ADMIN_ACCENT, borderColor: ADMIN_ACCENT } : undefined}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === 'health' && health ? (
        <GlassCard>
          <h2 className="type-heading mb-4">System health</h2>
          <p className="mb-2">
            Status:{' '}
            <span style={{ color: health.status === 'ok' ? undefined : '#C45C5C' }}>
              {health.status}
            </span>
          </p>
          <ul className="type-caption space-y-1 text-text-secondary">
            <li>
              Postgres: {health.postgres.ok ? 'ok' : 'down'}
              {health.postgres.latency_ms != null ? ` (${health.postgres.latency_ms} ms)` : ''}
            </li>
            <li>
              Redis: {health.redis.ok ? 'ok' : 'down'}
              {health.redis.latency_ms != null ? ` (${health.redis.latency_ms} ms)` : ''}
            </li>
            <li>Users: {health.counts.users ?? '—'}</li>
            <li>Bots running: {health.counts.bots_running ?? '—'}</li>
            <li>Reports on disk records: {health.counts.reports ?? '—'}</li>
          </ul>
        </GlassCard>
      ) : null}

      {tab === 'users' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <GlassCard>
            <h2 className="type-heading mb-4">Users</h2>
            <DataTable
              emptyMessage="No users."
              getRowKey={(row) => row.id}
              columns={[
                { key: 'email', header: 'Email', render: (row) => row.email },
                { key: 'role', header: 'Role', render: (row) => row.role },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <Button variant="ghost" onClick={() => void onSelectUser(row.id)}>
                      Detail
                    </Button>
                  ),
                },
              ]}
              rows={users}
            />
          </GlassCard>
          <GlassCard>
            <h2 className="type-heading mb-4">User detail</h2>
            {!selectedUser ? (
              <p className="text-text-secondary">Select a user.</p>
            ) : (
              <div className="space-y-2 type-caption text-text-secondary">
                <p className="text-text-primary">{selectedUser.email}</p>
                <p>Role: {selectedUser.role}</p>
                <p>Trades: {selectedUser.trade_count}</p>
                <p>Brokers: {selectedUser.broker_connections.length}</p>
                <p>Bot instances: {selectedUser.bot_instances.length}</p>
              </div>
            )}
          </GlassCard>
        </div>
      ) : null}

      {tab === 'tiers' ? (
        <GlassCard>
          <h2 className="type-heading mb-4">Risk tiers</h2>
          <DataTable
            emptyMessage="No tiers."
            getRowKey={(row) => String(row.tier)}
            columns={[
              { key: 'tier', header: 'Tier', render: (row) => row.tier },
              {
                key: 'blocks',
                header: 'Blocks min',
                render: (row) => row.completed_blocks_min,
              },
              { key: 'step', header: 'Step', render: (row) => row.step_size },
              { key: 'base', header: 'Base', render: (row) => row.base_risk },
              {
                key: 'ceiling',
                header: 'Ceiling',
                render: (row) => row.max_risk_ceiling,
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) => (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditTier(row);
                      setCeilingDraft(String(row.max_risk_ceiling));
                    }}
                  >
                    Edit ceiling
                  </Button>
                ),
              },
            ]}
            rows={tiers}
          />

          {editTier ? (
            <div className="mt-6 max-w-md space-y-3 border-t border-border-subtle pt-4">
              <p className="text-text-primary">
                Update tier {editTier.tier} max_risk_ceiling. This writes an admin audit log
                entry and affects future APIRS sizing for that tier.
              </p>
              <Input
                label="max_risk_ceiling"
                type="number"
                step="0.001"
                value={ceilingDraft}
                onChange={(e) => setCeilingDraft(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={() => void onConfirmTierPatch()}>Confirm update</Button>
                <Button variant="ghost" onClick={() => setEditTier(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </GlassCard>
      ) : null}

      {tab === 'strategies' ? (
        <GlassCard>
          <h2 className="type-heading mb-4">Candidate strategies</h2>
          <DataTable
            emptyMessage="No strategies."
            getRowKey={(row) => row.id}
            columns={[
              { key: 'name', header: 'Name', render: (row) => row.name },
              { key: 'status', header: 'Status', render: (row) => row.status },
              { key: 'source', header: 'Source', render: (row) => row.source },
              {
                key: 'reviewed',
                header: 'Reviewed',
                render: (row) => (row.reviewed_by_admin ? 'yes' : 'no'),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) =>
                  row.reviewed_by_admin ? (
                    <span className="type-caption text-text-secondary">—</span>
                  ) : (
                    <Button variant="ghost" onClick={() => void onMarkReviewed(row)}>
                      Mark reviewed
                    </Button>
                  ),
              },
            ]}
            rows={strategies}
          />
        </GlassCard>
      ) : null}

      {tab === 'demo' ? (
        <div className="flex flex-col gap-6">
          <p className="type-caption text-state-danger">
            Dangerous testing-only infrastructure. Both layers are needed for end-to-end
            demo real-dispatch: Layer 2 lets a demo account pass confirm-live; Layer 3 lets
            a confirmed session place real MT5 orders. Each auto-expires (max 30 minutes).
            Not for real-account trading.
          </p>

          <GlassCard>
            <h2 className="type-heading mb-2">Demo confirm bypass (Layer 2)</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Controls whether a demo account can get through the confirm-live step. Does
              not by itself allow order placement — enable Layer 3 as well for dispatch.
            </p>
            {demoConfirm ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {demoConfirm.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {demoConfirm.enabled ? (
                  <>
                    <p>Until: {demoConfirm.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(demoConfirm.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={demoConfirmMinutes}
                onChange={(e) => setDemoConfirmMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableDemoConfirm()}>
                  Enable confirm bypass
                </Button>
                {demoConfirm?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableDemoConfirm()}>
                    Disable now
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Refresh status
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Demo dispatch bypass (Layer 3)</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Controls whether a confirmed session can actually dispatch real orders on a
              demo account. Requires Layer 2 (confirm) to have succeeded first.
            </p>
            {demoDispatch ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {demoDispatch.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {demoDispatch.enabled ? (
                  <>
                    <p>Until: {demoDispatch.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(demoDispatch.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={demoDispatchMinutes}
                onChange={(e) => setDemoDispatchMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableDemoDispatch()}>
                  Enable dispatch bypass
                </Button>
                {demoDispatch?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableDemoDispatch()}>
                    Disable now
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Refresh status
                </Button>
              </div>
            </div>
          </GlassCard>
        </div>
      ) : null}
    </div>
  );
}
