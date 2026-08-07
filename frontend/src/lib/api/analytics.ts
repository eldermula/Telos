import { apiRequest } from './client';
import type { PerformanceRange } from './portfolio';

export type TradingMetricsResponse = {
  range: PerformanceRange;
  since: string | null;
  metrics: {
    trade_count: number;
    wins: number;
    losses: number;
    win_rate: number | null;
    net_pnl: number;
    avg_win: number | null;
    avg_loss: number | null;
    profit_factor: number | null;
    active_trading_balance: number | null;
    peak_equity: number | null;
    current_drawdown_pct: number | null;
  };
  series: Array<{
    closed_at: string;
    symbol: string;
    pnl: number;
    cumulative_pnl: number;
  }>;
};

export type BusinessMetricsResponse = {
  available: boolean;
  reason: string;
  metrics: null;
};

export function getTradingMetrics(
  range: PerformanceRange = '30d',
): Promise<TradingMetricsResponse> {
  return apiRequest<TradingMetricsResponse>(
    `/analytics/trading-metrics?range=${encodeURIComponent(range)}`,
  );
}

export function getBusinessMetrics(): Promise<BusinessMetricsResponse> {
  return apiRequest<BusinessMetricsResponse>('/analytics/business-metrics');
}
