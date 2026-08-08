import { apiRequest } from './client';
import type { TradingSession } from '../../types/trading';

/** Session shape includes synthetic_status (same cache payload as forex/crypto). */
export type SyntheticSession = TradingSession & {
  synthetic_status: 'running' | 'stopped' | 'error';
};

export function getSyntheticSession() {
  return apiRequest<SyntheticSession>('/bot/synthetic/session');
}

export function startSyntheticSession() {
  return apiRequest<SyntheticSession>('/bot/synthetic/start', { method: 'POST' });
}

export function stopSyntheticSession() {
  return apiRequest<SyntheticSession>('/bot/synthetic/stop', { method: 'POST' });
}
