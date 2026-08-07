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
