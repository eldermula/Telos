import { apiRequest } from './client';
import type { TradingSession } from '../../types/trading';

/** Session shape from bot-status cache — includes Batch 1 synthetic ledger/confirm fields. */
export type SyntheticSession = TradingSession & {
  synthetic_status: 'running' | 'stopped' | 'error';
  /** Soft-halt for synthetics — monitoring continues; new opens blocked. */
  synthetic_halt_new_opens?: boolean;
  synthetic_real_trading_available: boolean;
  /** Backend TTL-filtered; null means not confirmed / expired. */
  synthetic_live_trading_confirmed_at: string | null;
  /** Testing-only surface of the admin Layer-2 demo-confirm toggle (server is the gate). */
  synthetic_allow_demo_confirm: boolean;
  synthetic_active_trading_balance: number | null;
  synthetic_peak_equity: number | null;
  synthetic_current_tier: number;
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

export function haltSyntheticNewOpensSession() {
  return apiRequest<SyntheticSession>('/bot/synthetic/halt-new-opens', {
    method: 'POST',
  });
}

export function resumeSyntheticNewOpensSession() {
  return apiRequest<SyntheticSession>('/bot/synthetic/resume-new-opens', {
    method: 'POST',
  });
}

/**
 * Synthetics Layer 2 — same phrase contract as forex confirm-live.
 * Writes synthetic_live_trading_confirmed_at only.
 */
export function confirmSyntheticLiveSession(confirmationPhrase: string) {
  return apiRequest<SyntheticSession>('/bot/synthetic/confirm-live', {
    method: 'POST',
    body: { confirmationPhrase },
  });
}

/** Production user Close for an open synthetic paper or real trade. */
export function closeSyntheticPosition(tradeId: string) {
  return apiRequest<{ trade: import('../../types/trading').Trade }>(
    `/bot/synthetic/positions/${tradeId}/close`,
    { method: 'POST' },
  );
}
