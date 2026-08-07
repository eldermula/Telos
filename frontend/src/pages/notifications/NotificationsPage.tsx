import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/GlassCard';
import {
  listNotifications,
  markNotificationRead,
  type NotificationItem,
} from '../../lib/api/notifications';
import { ApiError } from '../../types/api';

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const page = await listNotifications({ page: 1, limit: 50 });
    setItems(page.data);
    setTotal(page.meta.total);
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
              : 'Could not load notifications.',
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

  async function toggleRead(item: NotificationItem) {
    setBusyId(item.id);
    setError(null);
    try {
      const updated = await markNotificationRead(item.id, !item.read_status);
      setItems((prev) => prev.map((row) => (row.id === item.id ? updated : row)));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not update notification.',
      );
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-text-secondary">Loading notifications…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-display-sm">Notifications</h1>
          <p className="mt-1 text-text-secondary">
            Bot start/stop, strategy switches, and connection or trading errors.
          </p>
        </div>
        <Link to="/settings">
          <Button variant="secondary">Notification preferences</Button>
        </Link>
      </div>

      {error ? (
        <p className="rounded-[8px] border border-state-danger/40 bg-state-danger/10 px-4 py-3 text-state-danger">
          {error}
        </p>
      ) : null}

      <GlassCard>
        {items.length === 0 ? (
          <p className="text-text-secondary">
            No notifications yet — start trading to begin receiving bot events.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {items.map((item) => (
              <li
                key={item.id}
                className={`flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between ${
                  item.read_status ? 'opacity-70' : ''
                }`}
              >
                <div>
                  <p className="type-caption text-text-secondary">
                    {item.type.replaceAll('_', ' ')} · {formatWhen(item.created_at)}
                  </p>
                  <p className={item.read_status ? 'text-text-secondary' : 'text-text-primary'}>
                    {item.message}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={busyId === item.id}
                  onClick={() => void toggleRead(item)}
                >
                  {item.read_status ? 'Mark unread' : 'Mark read'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {total > items.length ? (
          <p className="mt-4 type-caption text-text-secondary">
            Showing {items.length} of {total}
          </p>
        ) : null}
      </GlassCard>
    </div>
  );
}
