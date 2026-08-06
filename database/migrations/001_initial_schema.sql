-- 001_initial_schema.sql
-- Full Telos schema from docs/05_Database_Design.md Sections 1.2–1.4

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE connection_status AS ENUM ('connected', 'disconnected', 'error');
CREATE TYPE bot_status AS ENUM ('running', 'stopped', 'error');
CREATE TYPE strategy_mode AS ENUM ('STRATEGY_A', 'STRATEGY_B', 'HALTED');
CREATE TYPE trade_origin AS ENUM ('bot', 'manual');
CREATE TYPE trade_direction AS ENUM ('BUY', 'SELL');
CREATE TYPE trade_status AS ENUM ('open', 'closed');
CREATE TYPE decision_type AS ENUM (
  'strategy_switch',
  'profit_lock',
  'macro_circuit_breaker',
  'micro_circuit_breaker',
  'trade_approved',
  'trade_rejected'
);
CREATE TYPE notification_type AS ENUM (
  'bot_start',
  'bot_stop',
  'connection_error',
  'trading_error',
  'strategy_switch'
);
CREATE TYPE report_format AS ENUM ('pdf', 'csv');
CREATE TYPE assistant_message_role AS ENUM ('user', 'assistant');
CREATE TYPE strategy_source AS ENUM ('manual', 'ai_discovered');
CREATE TYPE strategy_status AS ENUM ('proposed', 'paper_testing', 'active', 'rejected');

-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- settings (1:1 with users)
CREATE TABLE settings (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- broker_connections
CREATE TABLE broker_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  broker_name TEXT NOT NULL,
  encrypted_credentials BYTEA NOT NULL,
  connection_status connection_status NOT NULL DEFAULT 'disconnected',
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_validated_at TIMESTAMPTZ
);

CREATE INDEX idx_broker_connections_user_id ON broker_connections (user_id);

-- bot_instances
CREATE TABLE bot_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  broker_connection_id UUID NOT NULL UNIQUE REFERENCES broker_connections (id) ON DELETE CASCADE,
  status bot_status NOT NULL DEFAULT 'stopped',
  active_strategy_mode strategy_mode NOT NULL DEFAULT 'STRATEGY_A',
  initial_balance NUMERIC NOT NULL,
  active_trading_balance NUMERIC NOT NULL,
  peak_equity NUMERIC NOT NULL,
  current_tier INT NOT NULL DEFAULT 0 CHECK (current_tier >= 0 AND current_tier <= 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_instances_user_id ON bot_instances (user_id);

-- trades
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_instance_id UUID NOT NULL REFERENCES bot_instances (id) ON DELETE CASCADE,
  origin trade_origin NOT NULL,
  direction trade_direction NOT NULL,
  entry_price NUMERIC NOT NULL,
  stop_price NUMERIC NOT NULL,
  target_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  lot_size NUMERIC NOT NULL,
  final_applied_position_risk NUMERIC NOT NULL,
  status trade_status NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  pnl NUMERIC
);

CREATE INDEX idx_trades_bot_instance_id ON trades (bot_instance_id);
CREATE INDEX idx_trades_status ON trades (status);

-- bot_decision_log
CREATE TABLE bot_decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_instance_id UUID NOT NULL REFERENCES bot_instances (id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision_type decision_type NOT NULL,
  triggering_condition TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_bot_decision_log_bot_instance_id ON bot_decision_log (bot_instance_id);
CREATE INDEX idx_bot_decision_log_timestamp ON bot_decision_log (timestamp);

-- notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  message TEXT NOT NULL,
  read_status BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON notifications (user_id);

-- reports
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  format report_format NOT NULL,
  file_path TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_user_id ON reports (user_id);

-- ai_assistant_conversations
CREATE TABLE ai_assistant_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_assistant_conversations_user_id ON ai_assistant_conversations (user_id);

-- ai_assistant_messages
CREATE TABLE ai_assistant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_assistant_conversations (id) ON DELETE CASCADE,
  role assistant_message_role NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_assistant_messages_conversation_id ON ai_assistant_messages (conversation_id);

-- admin_audit_log
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_admin_user_id ON admin_audit_log (admin_user_id);

-- risk_tier_config
CREATE TABLE risk_tier_config (
  tier INT PRIMARY KEY CHECK (tier >= 0 AND tier <= 7),
  completed_blocks_min INT NOT NULL,
  step_size NUMERIC NOT NULL,
  base_risk NUMERIC NOT NULL,
  max_risk_ceiling NUMERIC NOT NULL
);

-- candidate_strategies (05 Section 1.4)
CREATE TABLE candidate_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rule_set JSONB NOT NULL,
  description TEXT NOT NULL,
  source strategy_source NOT NULL,
  status strategy_status NOT NULL DEFAULT 'proposed',
  paper_trading_results JSONB,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  reviewed_by_admin BOOLEAN NOT NULL DEFAULT false
);
