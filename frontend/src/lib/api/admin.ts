import { apiRequest } from './client';

export type AdminUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
  updated_at: string;
};

export type AdminUserDetail = AdminUser & {
  broker_connections: Array<{
    id: string;
    broker_name: string;
    connection_status: string;
    account_type: string;
    linked_at: string;
    last_validated_at: string | null;
  }>;
  bot_instances: Array<{
    id: string;
    status: string;
    active_strategy_mode: string;
    active_trading_balance: number;
    peak_equity: number;
    current_tier: number;
    updated_at: string;
  }>;
  trade_count: number;
};

export type SystemHealth = {
  status: 'ok' | 'degraded';
  checked_at: string;
  duration_ms: number;
  postgres: { ok: boolean; latency_ms: number | null; error: string | null };
  redis: { ok: boolean; latency_ms: number | null; error: string | null };
  counts: {
    users: number | null;
    bots_running: number | null;
    reports: number | null;
  };
};

export type RiskTier = {
  tier: number;
  completed_blocks_min: number;
  step_size: number;
  base_risk: number;
  max_risk_ceiling: number;
};

export type CandidateStrategy = {
  id: string;
  name: string;
  description: string;
  source: string;
  status: string;
  reviewed_by_admin: boolean;
  discovered_at: string;
  activated_at: string | null;
};

export function listAdminUsers(params?: {
  page?: number;
  limit?: number;
}): Promise<{ data: AdminUser[]; meta: { page: number; limit: number; total: number } }> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest(`/admin/users${suffix}`);
}

export function getAdminUser(id: string): Promise<AdminUserDetail> {
  return apiRequest(`/admin/users/${id}`);
}

export function getSystemHealth(): Promise<SystemHealth> {
  return apiRequest('/admin/system-health');
}

export function listRiskTiers(): Promise<{ data: RiskTier[] }> {
  return apiRequest('/admin/risk-tiers');
}

export function patchRiskTier(
  tier: number,
  body: Partial<Pick<RiskTier, 'step_size' | 'base_risk' | 'max_risk_ceiling'>>,
): Promise<RiskTier> {
  return apiRequest(`/admin/risk-tiers/${tier}`, { method: 'PATCH', body });
}

export function listCandidateStrategies(status?: string): Promise<{ data: CandidateStrategy[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiRequest(`/admin/candidate-strategies${qs}`);
}

export function patchCandidateStrategy(
  id: string,
  body: { reviewed_by_admin?: boolean; status?: string },
): Promise<CandidateStrategy> {
  return apiRequest(`/admin/candidate-strategies/${id}`, { method: 'PATCH', body });
}

export type SyntheticDemoDispatchStatus = {
  enabled: boolean;
  enabled_until: string | null;
  remaining_seconds: number;
  updated_at?: string | null;
  updated_by_admin_user_id?: string | null;
};

export function getSyntheticDemoDispatchStatus(): Promise<SyntheticDemoDispatchStatus> {
  return apiRequest('/admin/synthetic/demo-dispatch-status');
}

export function enableSyntheticDemoDispatch(minutes: number): Promise<SyntheticDemoDispatchStatus> {
  return apiRequest('/admin/synthetic/demo-dispatch-enable', {
    method: 'POST',
    body: { minutes },
  });
}

export function disableSyntheticDemoDispatch(): Promise<SyntheticDemoDispatchStatus> {
  return apiRequest('/admin/synthetic/demo-dispatch-disable', { method: 'POST' });
}

/** Same shape as dispatch status — Layer 2 confirm-live bypass. */
export type SyntheticDemoConfirmStatus = SyntheticDemoDispatchStatus;

export function getSyntheticDemoConfirmStatus(): Promise<SyntheticDemoConfirmStatus> {
  return apiRequest('/admin/synthetic/demo-confirm-status');
}

export function enableSyntheticDemoConfirm(minutes: number): Promise<SyntheticDemoConfirmStatus> {
  return apiRequest('/admin/synthetic/demo-confirm-enable', {
    method: 'POST',
    body: { minutes },
  });
}

export function disableSyntheticDemoConfirm(): Promise<SyntheticDemoConfirmStatus> {
  return apiRequest('/admin/synthetic/demo-confirm-disable', { method: 'POST' });
}

/** Same shape — manual test-dispatch/close gate. */
export type SyntheticDemoManualTradeStatus = SyntheticDemoDispatchStatus;

export function getSyntheticDemoManualTradeStatus(): Promise<SyntheticDemoManualTradeStatus> {
  return apiRequest('/admin/synthetic/demo-manual-trade-status');
}

export function enableSyntheticDemoManualTrade(
  minutes: number,
): Promise<SyntheticDemoManualTradeStatus> {
  return apiRequest('/admin/synthetic/demo-manual-trade-enable', {
    method: 'POST',
    body: { minutes },
  });
}

export function disableSyntheticDemoManualTrade(): Promise<SyntheticDemoManualTradeStatus> {
  return apiRequest('/admin/synthetic/demo-manual-trade-disable', { method: 'POST' });
}
