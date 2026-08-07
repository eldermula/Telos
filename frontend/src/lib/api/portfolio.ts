import { apiRequest } from './client';

export type PortfolioHolding = {
  symbol: string;
  net_lot_size: number;
  net_direction: 'BUY' | 'SELL' | 'FLAT';
  open_count: number;
  positions: Array<{
    id: string;
    direction: 'BUY' | 'SELL';
    entry_price: number;
    stop_price: number;
    target_price: number;
    lot_size: number;
    final_applied_position_risk: number;
    opened_at: string;
  }>;
};

export type PortfolioHoldingsResponse = {
  holdings: PortfolioHolding[];
  as_of: string;
};

export type PerformanceRange = '7d' | '30d' | '90d' | 'all';

export type PortfolioPerformanceResponse = {
  range: PerformanceRange;
  since: string | null;
  summary: {
    trade_count: number;
    wins: number;
    losses: number;
    win_rate: number | null;
    net_pnl: number;
  };
  series: Array<{
    trade_id: string;
    symbol: string;
    direction: 'BUY' | 'SELL';
    pnl: number;
    cumulative_pnl: number;
    closed_at: string;
  }>;
};

export function getHoldings(): Promise<PortfolioHoldingsResponse> {
  return apiRequest<PortfolioHoldingsResponse>('/portfolio/holdings');
}

export function getPerformance(
  range: PerformanceRange = '30d',
): Promise<PortfolioPerformanceResponse> {
  return apiRequest<PortfolioPerformanceResponse>(
    `/portfolio/performance?range=${encodeURIComponent(range)}`,
  );
}
