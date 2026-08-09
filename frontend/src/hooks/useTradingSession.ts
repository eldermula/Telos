import { useCallback, useEffect, useRef, useState } from 'react';
import { listBrokerConnections } from '../lib/api/broker';
import * as tradingApi from '../lib/api/trading';
import { ApiError } from '../types/api';
import type { TradingSession } from '../types/trading';

type BrokerGate = 'checking' | 'no-broker' | 'ready';

export function useTradingSession() {
  const [session, setSession] = useState<TradingSession | null>(null);
  const [brokerGate, setBrokerGate] = useState<BrokerGate>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<
    'start' | 'stop' | 'halt' | 'resume' | 'confirm-live' | null
  >(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const connections = await listBrokerConnections();
      if (connections.length === 0 || connections[0].connection_status !== 'connected') {
        setBrokerGate('no-broker');
        setSession(null);
        return;
      }
      setBrokerGate('ready');
      const current = await tradingApi.getSession();
      setSession(current);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_BROKER_CONNECTION') {
        setBrokerGate('no-broker');
        setSession(null);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not load trading session.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const start = useCallback(async () => {
    setActionPending('start');
    setError(null);
    try {
      const updated = await tradingApi.startSession();
      setSession(updated);
      setBrokerGate('ready');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not start trading. Try again.',
      );
      throw err;
    } finally {
      setActionPending(null);
    }
  }, []);

  const stop = useCallback(async () => {
    setActionPending('stop');
    setError(null);
    try {
      const updated = await tradingApi.stopSession();
      setSession(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not stop trading. Try again.',
      );
      throw err;
    } finally {
      setActionPending(null);
    }
  }, []);

  const haltNewOpens = useCallback(async () => {
    setActionPending('halt');
    setError(null);
    try {
      const updated = await tradingApi.haltNewOpensSession();
      setSession(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not halt new trades. Try again.',
      );
      throw err;
    } finally {
      setActionPending(null);
    }
  }, []);

  const resumeNewOpens = useCallback(async () => {
    setActionPending('resume');
    setError(null);
    try {
      const updated = await tradingApi.resumeNewOpensSession();
      setSession(updated);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not resume new trades. Try again.',
      );
      throw err;
    } finally {
      setActionPending(null);
    }
  }, []);

  const confirmLive = useCallback(async (confirmationPhrase: string) => {
    setActionPending('confirm-live');
    setError(null);
    try {
      const updated = await tradingApi.confirmLiveSession(confirmationPhrase);
      setSession(updated);
      return updated;
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not confirm live trading. Try again.',
      );
      throw err;
    } finally {
      setActionPending(null);
    }
  }, []);

  const applySessionPatch = useCallback((patch: Partial<TradingSession>) => {
    setSession((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  return {
    session,
    sessionRef,
    brokerGate,
    loading,
    error,
    actionPending,
    start,
    stop,
    haltNewOpens,
    resumeNewOpens,
    confirmLive,
    reload: load,
    applySessionPatch,
  };
}

export type UseTradingSessionResult = ReturnType<typeof useTradingSession>;
