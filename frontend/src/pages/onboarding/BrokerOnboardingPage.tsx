import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createBrokerConnection,
  deleteBrokerConnection,
  listBrokerConnections,
  updateBrokerConnection,
} from '../../lib/api/broker';
import {
  getAttachedAccountInfo,
  type AttachedAccountInfo,
} from '../../lib/api/trading';
import { ApiError, type BrokerConnection } from '../../types/api';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/GlassCard';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { StatusPill, brokerStatusTone } from '../../components/ui/StatusPill';

const BROKER_OPTIONS = [{ value: 'deriv', label: 'Deriv' }] as const;
const PREVIEW_DEBOUNCE_MS = 500;

export function BrokerOnboardingPage() {
  const [connection, setConnection] = useState<BrokerConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [broker, setBroker] = useState('deriv');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [attached, setAttached] = useState<AttachedAccountInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const list = await listBrokerConnections();
    setConnection(list[0] ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Could not load broker connection.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Live attach preview: debounce Login typing → read-only connector
  // account-info (never authenticates with typed credentials).
  useEffect(() => {
    const trimmed = login.trim();
    if (!trimmed) {
      setAttached(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      setPreviewError(null);
      void (async () => {
        try {
          const info = await getAttachedAccountInfo();
          if (cancelled) return;
          setAttached(info);
        } catch (err) {
          if (cancelled) return;
          setAttached(null);
          setPreviewError(
            err instanceof ApiError
              ? err.message
              : 'Could not read the attached MT5 terminal.',
          );
        } finally {
          if (!cancelled) setPreviewLoading(false);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [login]);

  async function onLink(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const credentials = {
        login: login.trim(),
        password,
        server: server.trim(),
      };
      if (connection && updating) {
        await updateBrokerConnection(connection.id, credentials);
      } else {
        await createBrokerConnection(credentials);
      }
      setLogin('');
      setPassword('');
      setServer('');
      setUpdating(false);
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Broker connection failed. Check your credentials and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onDisconnect() {
    if (!connection) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteBrokerConnection(connection.id);
      setConnection(null);
      setDisconnectOpen(false);
      setUpdating(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Disconnect failed. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const loginMatchesAttached =
    attached != null &&
    login.trim() !== '' &&
    String(attached.login) === login.trim();

  const currency = attached?.currency ? ` ${attached.currency}` : '';

  if (loading) {
    return <p className="text-text-secondary">Loading broker connection…</p>;
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header>
        <h1 className="type-display-sm">Broker connection</h1>
        <p className="mt-1 text-text-secondary">
          Link your Deriv MT5 account. Telos never takes custody of trading
          funds.
        </p>
      </header>

      {connection && !updating ? (
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="type-caption">Linked broker</p>
              <p className="type-heading mt-1 uppercase">{connection.broker_name}</p>
              <p className="mt-2 type-caption">
                Linked {new Date(connection.linked_at).toLocaleString()}
              </p>
              {connection.last_validated_at ? (
                <p className="type-caption">
                  Last validated{' '}
                  {new Date(connection.last_validated_at).toLocaleString()}
                </p>
              ) : null}
            </div>
            <StatusPill
              label={connection.connection_status}
              tone={brokerStatusTone(connection.connection_status)}
            />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setUpdating(true)}>
              Update credentials
            </Button>
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
              Disconnect broker
            </Button>
            <Link
              to="/dashboard"
              className="inline-flex items-center text-text-secondary hover:text-text-primary"
            >
              Back to dashboard
            </Link>
          </div>
        </GlassCard>
      ) : (
        <GlassCard>
          <h2 className="type-heading">
            {updating ? 'Update MT5 credentials' : 'Link MT5 account'}
          </h2>
          <p className="mt-2 text-text-secondary">
            Log into this account in your MT5 desktop terminal first, then enter
            its account number below to link it. Telos detects the account type
            automatically.
          </p>
          <form className="mt-4 flex flex-col gap-4" onSubmit={onLink} autoComplete="off">
            <Select
              label="Broker"
              name="mt5-broker"
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
              options={[...BROKER_OPTIONS]}
            />
            <Input
              label="Login"
              name="mt5-login"
              autoComplete="off"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />

            {login.trim() ? (
              <div className="flex flex-col gap-2">
                {previewLoading ? (
                  <p className="type-caption text-text-secondary">
                    Reading attached MT5 terminal…
                  </p>
                ) : null}
                {previewError ? (
                  <p className="type-caption text-text-secondary">{previewError}</p>
                ) : null}
                {attached && !previewLoading ? (
                  <>
                    <dl className="grid grid-cols-2 gap-3 rounded-[12px] border border-border-subtle bg-bg-surface p-3">
                      <div>
                        <dt className="type-caption">Login</dt>
                        <dd className="type-data-base mt-0.5 text-text-primary">
                          {attached.login}
                        </dd>
                      </div>
                      <div>
                        <dt className="type-caption">Account type</dt>
                        <dd className="type-data-base mt-0.5 capitalize text-text-primary">
                          {attached.account_type}
                        </dd>
                      </div>
                      <div>
                        <dt className="type-caption">Balance</dt>
                        <dd className="type-data-base mt-0.5 text-text-primary">
                          {attached.balance.toFixed(2)}
                          {currency}
                        </dd>
                      </div>
                    </dl>
                    {loginMatchesAttached ? (
                      <p className="type-caption text-success">
                        Matches your MT5 terminal
                      </p>
                    ) : (
                      <p className="type-caption text-text-secondary">
                        MT5 desktop is currently logged into a different account.
                        Log into the account you want to link, then try again.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}

            <Input
              label="Password"
              name="mt5-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              label="Server"
              name="mt5-server"
              autoComplete="off"
              required
              placeholder="Deriv-Demo"
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
            <p className="type-caption">
              Your credentials are encrypted and never stored in this browser.
            </p>
            {error ? <p className="type-caption text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? 'Connecting…'
                  : updating
                    ? 'Save credentials'
                    : 'Link broker account'}
              </Button>
              {updating ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setUpdating(false);
                    setPassword('');
                    setLogin('');
                    setServer('');
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </GlassCard>
      )}

      {error && connection && !updating ? (
        <p className="type-caption text-danger">{error}</p>
      ) : null}

      <Modal
        open={disconnectOpen}
        title="Disconnect broker"
        confirmLabel="Disconnect broker"
        confirmVariant="destructive"
        confirming={submitting}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={() => void onDisconnect()}
      >
        <p>
          This removes the stored broker link from Telos. It does not close open
          positions or move funds at your broker.
        </p>
      </Modal>
    </div>
  );
}
