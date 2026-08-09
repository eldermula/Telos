import type {
  DecisionLogEntry,
  Paginated,
  Trade,
  TradingSession,
} from '../../types/trading';
import { apiRequest } from './client';

export function getSession() {
  return apiRequest<TradingSession>('/trading/session');
}

export function startSession() {
  return apiRequest<TradingSession>('/trading/session/start', { method: 'POST' });
}

export function stopSession() {
  return apiRequest<TradingSession>('/trading/session/stop', { method: 'POST' });
}

/**
 * Option 2 Layer 2 opt-in. Phrase must match the server-side constant
 * exactly (case-sensitive). Server rejects if the instance isn't
 * stopped, the account isn't real, or the phrase mismatches.
 */
export function confirmLiveSession(confirmationPhrase: string) {
  return apiRequest<TradingSession>('/trading/session/confirm-live', {
    method: 'POST',
    body: { confirmationPhrase },
  });
}

export type LiveAccountInfo = {
  broker_connection_id: string;
  broker_name: string;
  login: number;
  account_type: 'demo' | 'contest' | 'real';
  balance: number;
  equity: number;
  currency: string | null;
};

/** Fresh MT5 equity/balance for the Confirm Live modal — never the paper ledger. */
export function getLiveAccountInfo() {
  return apiRequest<LiveAccountInfo>('/trading/account-info');
}

/** Currently attached MT5 terminal (broker onboarding preview). No login-match. */
export type AttachedAccountInfo = {
  login: number;
  account_type: 'demo' | 'contest' | 'real';
  balance: number;
  equity: number;
  currency: string | null;
};

export function getAttachedAccountInfo() {
  return apiRequest<AttachedAccountInfo>('/trading/attached-account-info');
}

export function getPositions() {
  return apiRequest<Trade[]>('/trading/positions');
}

export function getOrders() {
  return apiRequest<Trade[]>('/trading/orders');
}

export function getHistory(page = 1, limit = 25) {
  return apiRequest<Paginated<Trade>>(`/trading/history?page=${page}&limit=${limit}`);
}

export function getDecisionLog(page = 1, limit = 25) {
  return apiRequest<Paginated<DecisionLogEntry>>(
    `/trading/decision-log?page=${page}&limit=${limit}`,
  );
}
