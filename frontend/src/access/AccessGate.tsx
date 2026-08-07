import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ApiError } from '../types/api';
import * as accessGateApi from '../lib/api/access-gate';

type AccessGateContextValue = {
  ready: boolean;
  unlocked: boolean;
  configured: boolean;
  unlock: (attempt: string) => Promise<void>;
};

const AccessGateContext = createContext<AccessGateContextValue | null>(null);

export function AccessGateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const status = await accessGateApi.getAccessGateStatus(controller.signal);
        setConfigured(status.configured);
        setUnlocked(status.unlocked);
      } catch (err) {
        // If the status call itself fails (backend down), don't lock the
        // user behind a gate they can't clear — Auth/errors will surface.
        if (!controller.signal.aborted) {
          setConfigured(false);
          setUnlocked(true);
          console.error('[access-gate] status check failed:', err);
        }
      } finally {
        if (!controller.signal.aborted) setReady(true);
      }
    })();
    return () => controller.abort();
  }, []);

  const unlock = useCallback(async (attempt: string) => {
    await accessGateApi.verifyAccessGate(attempt);
    setUnlocked(true);
  }, []);

  return (
    <AccessGateContext.Provider value={{ ready, unlocked, configured, unlock }}>
      {children}
    </AccessGateContext.Provider>
  );
}

export function useAccessGate() {
  const ctx = useContext(AccessGateContext);
  if (!ctx) throw new Error('useAccessGate must be used within AccessGateProvider');
  return ctx;
}

export function AccessGateBarrier({ children }: { children: ReactNode }) {
  const { ready, unlocked, configured } = useAccessGate();
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-canvas">
        <p className="type-caption text-text-muted">Loading…</p>
      </div>
    );
  }
  if (configured && !unlocked) {
    return <AccessGatePage />;
  }
  return children;
}

function AccessGatePage() {
  const { unlock } = useAccessGate();
  const [attempt, setAttempt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await unlock(attempt);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not verify. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="type-display-sm text-text-primary">Telos</h1>
        <p className="type-body mt-3 text-text-muted">
          Enter the access passphrase to continue.
        </p>
        <form className="mt-8 flex flex-col gap-4" onSubmit={onSubmit}>
          <label className="flex flex-col gap-2">
            <span className="type-caption text-text-muted">Passphrase</span>
            <textarea
              className="min-h-28 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 type-body text-text-primary outline-none focus:border-accent-gold"
              value={attempt}
              onChange={(e) => setAttempt(e.target.value)}
              required
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {error ? <p className="type-caption text-danger">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting || !attempt.trim()}
            className="rounded-md bg-accent-gold px-4 py-2 type-body text-bg-canvas disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
