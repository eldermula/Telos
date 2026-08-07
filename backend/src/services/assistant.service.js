'use strict';

/**
 * AI Assistant (06 §7 / FR-AI-1).
 *
 * Strictly read-only/advisory per settled FR-AI-2: no calls into
 * /trading/* or bot-runtime / placeOrder / closeOrder.
 *
 * Reply generation uses a deterministic rule-based stub until an LLM
 * provider decision is made (same pattern as Module 3 headline classify).
 */

const { pool } = require('../db/pool');
const { AppError } = require('../utils/app-error');
const { toMeta } = require('../utils/pagination');
const tradingEngine = require('../engine/trading-engine');

function toConversation(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    title: row.title || null,
  };
}

function toMessage(row) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
  };
}

async function assertConversationOwner(userId, conversationId) {
  const result = await pool.query(
    `SELECT id, user_id, created_at FROM ai_assistant_conversations WHERE id = $1`,
    [conversationId]
  );
  const row = result.rows[0];
  if (!row || row.user_id !== userId) {
    throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
  }
  return row;
}

async function createConversation(userId) {
  const result = await pool.query(
    `INSERT INTO ai_assistant_conversations (user_id)
     VALUES ($1)
     RETURNING id, created_at`,
    [userId]
  );
  return toConversation(result.rows[0]);
}

async function listConversations(userId, { limit = 25, offset = 0, page = 1 } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT c.id, c.created_at,
              (
                SELECT m.content FROM ai_assistant_messages m
                WHERE m.conversation_id = c.id AND m.role = 'user'
                ORDER BY m.created_at ASC
                LIMIT 1
              ) AS title
       FROM ai_assistant_conversations c
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM ai_assistant_conversations WHERE user_id = $1`,
      [userId]
    ),
  ]);
  return {
    data: rows.rows.map((row) => ({
      ...toConversation(row),
      title: row.title ? String(row.title).slice(0, 80) : 'New conversation',
    })),
    meta: toMeta({ page, limit }, count.rows[0].n),
  };
}

async function loadContextSnapshot(userId) {
  let instance = null;
  try {
    instance = await tradingEngine.ensureBotInstance(userId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_BROKER_CONNECTION') {
      return {
        has_broker: false,
        status: null,
        mode: null,
        balance: null,
        peak: null,
        open_trades: 0,
        closed_trades: 0,
        net_pnl: 0,
      };
    }
    throw err;
  }

  const [open, closed] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS n FROM trades WHERE bot_instance_id = $1 AND status = 'open'`,
      [instance.id]
    ),
    pool.query(
      `SELECT count(*)::int AS n, COALESCE(SUM(pnl), 0)::float AS net
       FROM trades WHERE bot_instance_id = $1 AND status = 'closed'`,
      [instance.id]
    ),
  ]);

  return {
    has_broker: true,
    status: instance.status,
    mode: instance.active_strategy_mode,
    balance: Number(instance.active_trading_balance),
    peak: Number(instance.peak_equity),
    open_trades: open.rows[0].n,
    closed_trades: closed.rows[0].n,
    net_pnl: Number(closed.rows[0].net),
  };
}

/**
 * Deterministic advisory reply. Never proposes or executes trades.
 */
function craftStubReply(userText, ctx) {
  const q = String(userText || '').toLowerCase();
  const lines = [];

  lines.push(
    'I’m the Telos advisory assistant (read-only). I can’t start/stop the bot or place orders.'
  );

  if (!ctx.has_broker) {
    lines.push(
      'No broker connection is linked yet — connect a broker under Onboarding before trading metrics are available.'
    );
  } else {
    lines.push(
      `Session snapshot: status=${ctx.status}, mode=${ctx.mode}, ` +
        `balance=${ctx.balance}, peak=${ctx.peak}, open=${ctx.open_trades}, ` +
        `closed=${ctx.closed_trades}, net_pnl=${ctx.net_pnl.toFixed(2)}.`
    );
  }

  if (/drawdown|risk|tier/.test(q)) {
    lines.push(
      'Risk sizing comes from APIRS tiers and circuit breakers. Review Analytics for realized drawdown from peak; Admin can tune tier ceilings without a redeploy.'
    );
  } else if (/strategy|switch/.test(q)) {
    lines.push(
      'Strategy A/B/HALTED transitions are logged in the decision log and surfaced as notifications when preferences allow.'
    );
  } else if (/pnl|profit|loss|performance/.test(q)) {
    lines.push(
      'For historical P&L detail, use Portfolio performance and Analytics trading metrics (or generate a CSV report).'
    );
  } else if (/help|what can/.test(q)) {
    lines.push(
      'Ask about session health, drawdown, strategy mode, or where to find reports/analytics. I won’t execute trading actions.'
    );
  } else {
    lines.push(
      'Ask about your session status, risk/drawdown, strategy mode, or where to find reports and analytics.'
    );
  }

  lines.push('[stub reply — LLM provider not configured]');
  return lines.join('\n\n');
}

async function listMessages(userId, conversationId, { limit = 25, offset = 0, page = 1 } = {}) {
  await assertConversationOwner(userId, conversationId);
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, conversation_id, role, content, created_at
       FROM ai_assistant_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM ai_assistant_messages WHERE conversation_id = $1`,
      [conversationId]
    ),
  ]);
  return {
    data: rows.rows.map(toMessage),
    meta: toMeta({ page, limit }, count.rows[0].n),
  };
}

async function postMessage(userId, conversationId, content) {
  const text = String(content || '').trim();
  if (!text) {
    throw new AppError(422, 'VALIDATION_ERROR', 'content is required');
  }
  if (text.length > 4000) {
    throw new AppError(422, 'VALIDATION_ERROR', 'content must be at most 4000 characters');
  }

  await assertConversationOwner(userId, conversationId);
  const ctx = await loadContextSnapshot(userId);
  const reply = craftStubReply(text, ctx);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userMsg = await client.query(
      `INSERT INTO ai_assistant_messages (conversation_id, role, content)
       VALUES ($1, 'user', $2)
       RETURNING id, conversation_id, role, content, created_at`,
      [conversationId, text]
    );
    const assistantMsg = await client.query(
      `INSERT INTO ai_assistant_messages (conversation_id, role, content)
       VALUES ($1, 'assistant', $2)
       RETURNING id, conversation_id, role, content, created_at`,
      [conversationId, reply]
    );
    await client.query('COMMIT');
    return {
      user_message: toMessage(userMsg.rows[0]),
      assistant_message: toMessage(assistantMsg.rows[0]),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getInsights(userId) {
  const ctx = await loadContextSnapshot(userId);
  const insights = [];

  if (!ctx.has_broker) {
    insights.push({
      code: 'NO_BROKER',
      severity: 'info',
      message: 'No broker connection linked yet.',
    });
  } else {
    if (ctx.status === 'error') {
      insights.push({
        code: 'BOT_ERROR',
        severity: 'warning',
        message: 'Bot session is in error state — check Notifications and broker connection.',
      });
    }
    if (ctx.mode === 'STRATEGY_B') {
      insights.push({
        code: 'STRATEGY_B',
        severity: 'warning',
        message: 'Macro circuit breaker has switched the session to Strategy B (reduced risk).',
      });
    }
    if (ctx.mode === 'HALTED') {
      insights.push({
        code: 'HALTED',
        severity: 'critical',
        message: 'Session is HALTED — trading is stopped pending recovery/manual action.',
      });
    }
    if (ctx.peak > 0 && ctx.balance != null) {
      const dd = ((ctx.peak - ctx.balance) / ctx.peak) * 100;
      if (dd >= 20) {
        insights.push({
          code: 'ELEVATED_DRAWDOWN',
          severity: 'warning',
          message: `Current drawdown from peak is about ${dd.toFixed(1)}%.`,
        });
      }
    }
    if (ctx.open_trades > 0) {
      insights.push({
        code: 'OPEN_POSITIONS',
        severity: 'info',
        message: `There ${ctx.open_trades === 1 ? 'is' : 'are'} ${ctx.open_trades} open position(s).`,
      });
    }
    if (insights.length === 0) {
      insights.push({
        code: 'ALL_CLEAR',
        severity: 'info',
        message: 'No anomalies flagged from the current session snapshot.',
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    source: 'rule_based_stub',
    context: ctx,
    insights,
  };
}

module.exports = {
  createConversation,
  listConversations,
  listMessages,
  postMessage,
  getInsights,
  craftStubReply,
};
