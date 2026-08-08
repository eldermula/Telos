import type { BrokerAccountType } from './api';

export type BotStatus = 'running' | 'stopped' | 'error';
export type StrategyMode = 'STRATEGY_A' | 'STRATEGY_B' | 'HALTED';

export type TradingSession = {
  bot_instance_id: string;
  status: BotStatus;
  /** Crypto paper runtime — independent of forex `status`. */
  crypto_status?: BotStatus;
  /** Synthetics paper runtime — independent of forex/crypto status. */
  synthetic_status?: BotStatus;
  active_strategy_mode: StrategyMode;
  current_tier: number;
  active_trading_balance: number;
  peak_equity: number;
  bootstrap_phase: boolean;
  bootstrap_risk_ceiling_pct: number | null;
  // Option 2 Increment D — Layer 2 surface. `real_trading_available`
  // tells the UI whether to offer the Confirm Live action at all
  // (REAL_TRADING_ENABLED && account_type === 'real'); the other two
  // are the raw inputs that feed that decision + the current
  // confirmation state (null when never confirmed OR past the
  // 15-minute TTL).
  account_type: BrokerAccountType;
  real_trading_available: boolean;
  live_trading_confirmed_at: string | null;
  updated_at: string;
};

export type TradeDirection = 'BUY' | 'SELL';
export type TradeStatus = 'open' | 'closed';

export type Trade = {
  id: string;
  direction: TradeDirection;
  entry_price: number;
  stop_price: number;
  target_price: number;
  exit_price: number | null;
  lot_size: number;
  final_applied_position_risk: number;
  status: TradeStatus;
  opened_at: string;
  closed_at: string | null;
  pnl: number | null;
};

export type DecisionType =
  | 'strategy_switch'
  | 'profit_lock'
  | 'macro_circuit_breaker'
  | 'micro_circuit_breaker'
  | 'trade_approved'
  | 'trade_rejected';

export type DecisionLogEntry = {
  id: string;
  timestamp: string;
  decision_type: DecisionType;
  triggering_condition: string;
  details: Record<string, unknown>;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
};

export type Paginated<T> = {
  data: T[];
  meta: PaginationMeta;
};
