import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { GlassCard } from '../../components/ui/GlassCard';
import { Input } from '../../components/ui/Input';
import { ConfirmLiveTradingModal } from '../trading/ConfirmLiveTradingModal';
import {
  LIVE_TRADING_CONFIRMATION_TTL_MINUTES,
} from '../../lib/liveTradingConfirmation';
import {
  confirmM5RealLiveTrading,
  confirmXauVwapLiveTrading,
  disableForexDemoConfirm,
  disableForexDemoDispatch,
  disableForexDemoManualTrade,
  disableM5RealDemoConfirm,
  disableM5RealDemoDispatch,
  disableXauVwapLiveDemoConfirm,
  disableXauVwapLiveDemoDispatch,
  disableSyntheticDemoConfirm,
  disableSyntheticDemoDispatch,
  disableSyntheticDemoManualTrade,
  enableForexDemoConfirm,
  enableForexDemoDispatch,
  enableForexDemoManualTrade,
  enableM5RealDemoConfirm,
  enableM5RealDemoDispatch,
  enableXauVwapLiveDemoConfirm,
  enableXauVwapLiveDemoDispatch,
  enableSyntheticDemoConfirm,
  enableSyntheticDemoDispatch,
  enableSyntheticDemoManualTrade,
  getAdminUser,
  getForexDemoConfirmStatus,
  getForexDemoDispatchStatus,
  getForexDemoManualTradeStatus,
  getM5PaperStatus,
  getM1PaperStatus,
  getXauVwapPaperStatus,
  getM5RealDemoConfirmStatus,
  getM5RealDemoDispatchStatus,
  getM5RealStatus,
  getXauVwapLiveDemoConfirmStatus,
  getXauVwapLiveDemoDispatchStatus,
  getXauVwapLiveStatus,
  getSyntheticDemoConfirmStatus,
  getSyntheticDemoDispatchStatus,
  getSyntheticDemoManualTradeStatus,
  getSystemHealth,
  listAdminUsers,
  listCandidateStrategies,
  listRiskTiers,
  patchCandidateStrategy,
  patchRiskTier,
  startM5PaperSession,
  startM1PaperSession,
  startXauVwapPaperSession,
  startM5RealSession,
  startXauVwapLiveSession,
  stopM5PaperSession,
  stopM1PaperSession,
  stopXauVwapPaperSession,
  stopM5RealSession,
  stopXauVwapLiveSession,
  type AdminUser,
  type AdminUserDetail,
  type CandidateStrategy,
  type ForexDemoConfirmStatus,
  type ForexDemoDispatchStatus,
  type ForexDemoManualTradeStatus,
  type M5PaperStatus,
  type M1PaperStatus,
  type XauVwapPaperStatus,
  type M5RealDemoConfirmStatus,
  type M5RealDemoDispatchStatus,
  type M5RealStatus,
  type XauVwapLiveDemoConfirmStatus,
  type XauVwapLiveDemoDispatchStatus,
  type XauVwapLiveStatus,
  type RiskTier,
  type SyntheticDemoConfirmStatus,
  type SyntheticDemoDispatchStatus,
  type SyntheticDemoManualTradeStatus,
  type SystemHealth,
} from '../../lib/api/admin';
import { ApiError } from '../../types/api';

/** Admin accent per 07_UI_UX_Guide § open-questions settle (#5B7A9C). */
const ADMIN_ACCENT = '#5B7A9C';

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function confirmLiveRemainingSeconds(confirmedAt: string | null, nowMs = Date.now()): number {
  if (!confirmedAt) return 0;
  const confirmedMs = Date.parse(confirmedAt);
  if (!Number.isFinite(confirmedMs)) return 0;
  const ttlMs = LIVE_TRADING_CONFIRMATION_TTL_MINUTES * 60 * 1000;
  const remaining = Math.floor((confirmedMs + ttlMs - nowMs) / 1000);
  return remaining > 0 ? remaining : 0;
}

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<
    | 'health'
    | 'users'
    | 'tiers'
    | 'strategies'
    | 'demo'
    | 'm5paper'
    | 'm1paper'
    | 'xauvwappaper'
    | 'xauvwaplive'
  >('health');
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const [tiers, setTiers] = useState<RiskTier[]>([]);
  const [strategies, setStrategies] = useState<CandidateStrategy[]>([]);
  const [demoDispatch, setDemoDispatch] = useState<SyntheticDemoDispatchStatus | null>(null);
  const [demoConfirm, setDemoConfirm] = useState<SyntheticDemoConfirmStatus | null>(null);
  const [demoManualTrade, setDemoManualTrade] =
    useState<SyntheticDemoManualTradeStatus | null>(null);
  const [forexDemoDispatch, setForexDemoDispatch] =
    useState<ForexDemoDispatchStatus | null>(null);
  const [forexDemoConfirm, setForexDemoConfirm] = useState<ForexDemoConfirmStatus | null>(
    null,
  );
  const [forexDemoManualTrade, setForexDemoManualTrade] =
    useState<ForexDemoManualTradeStatus | null>(null);
  const [m5PaperStatus, setM5PaperStatus] = useState<M5PaperStatus | null>(null);
  const [m1PaperStatus, setM1PaperStatus] = useState<M1PaperStatus | null>(null);
  const [xauVwapPaperStatus, setXauVwapPaperStatus] = useState<XauVwapPaperStatus | null>(null);
  const [m5RealStatus, setM5RealStatus] = useState<M5RealStatus | null>(null);
  const [m5RealDemoDispatch, setM5RealDemoDispatch] =
    useState<M5RealDemoDispatchStatus | null>(null);
  const [m5RealDemoConfirm, setM5RealDemoConfirm] = useState<M5RealDemoConfirmStatus | null>(
    null,
  );
  const [xauVwapLiveStatus, setXauVwapLiveStatus] = useState<XauVwapLiveStatus | null>(null);
  const [xauVwapLiveDemoDispatch, setXauVwapLiveDemoDispatch] =
    useState<XauVwapLiveDemoDispatchStatus | null>(null);
  const [xauVwapLiveDemoConfirm, setXauVwapLiveDemoConfirm] =
    useState<XauVwapLiveDemoConfirmStatus | null>(null);
  const [demoDispatchMinutes, setDemoDispatchMinutes] = useState('15');
  const [demoConfirmMinutes, setDemoConfirmMinutes] = useState('15');
  const [demoManualTradeMinutes, setDemoManualTradeMinutes] = useState('15');
  const [forexDemoDispatchMinutes, setForexDemoDispatchMinutes] = useState('15');
  const [forexDemoConfirmMinutes, setForexDemoConfirmMinutes] = useState('15');
  const [forexDemoManualTradeMinutes, setForexDemoManualTradeMinutes] = useState('15');
  const [m5RealDemoDispatchMinutes, setM5RealDemoDispatchMinutes] = useState('30');
  const [m5RealDemoConfirmMinutes, setM5RealDemoConfirmMinutes] = useState('30');
  const [xauVwapLiveDemoDispatchMinutes, setXauVwapLiveDemoDispatchMinutes] = useState('30');
  const [xauVwapLiveDemoConfirmMinutes, setXauVwapLiveDemoConfirmMinutes] = useState('30');
  const [m5ConfirmModalOpen, setM5ConfirmModalOpen] = useState(false);
  const [m5Confirming, setM5Confirming] = useState(false);
  const [m5ConfirmedAt, setM5ConfirmedAt] = useState<string | null>(null);
  const [xauVwapLiveConfirmModalOpen, setXauVwapLiveConfirmModalOpen] = useState(false);
  const [xauVwapLiveConfirming, setXauVwapLiveConfirming] = useState(false);
  const [xauVwapLiveConfirmedAt, setXauVwapLiveConfirmedAt] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [editTier, setEditTier] = useState<RiskTier | null>(null);
  const [ceilingDraft, setCeilingDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [h, u, t, s, d, c, m, fd, fc, fm, m5, m1, xauV, m5r, m5rd, m5rc, xvl, xvld, xvlc] =
      await Promise.all([
      getSystemHealth(),
      listAdminUsers({ page: 1, limit: 50 }),
      listRiskTiers(),
      listCandidateStrategies(),
      getSyntheticDemoDispatchStatus(),
      getSyntheticDemoConfirmStatus(),
      getSyntheticDemoManualTradeStatus(),
      getForexDemoDispatchStatus(),
      getForexDemoConfirmStatus(),
      getForexDemoManualTradeStatus(),
      getM5PaperStatus(),
      getM1PaperStatus(),
      getXauVwapPaperStatus(),
      getM5RealStatus(),
      getM5RealDemoDispatchStatus(),
      getM5RealDemoConfirmStatus(),
      getXauVwapLiveStatus(),
      getXauVwapLiveDemoDispatchStatus(),
      getXauVwapLiveDemoConfirmStatus(),
    ]);
    setHealth(h);
    setUsers(u.data);
    setTiers(t.data);
    setStrategies(s.data);
    setDemoDispatch(d);
    setDemoConfirm(c);
    setDemoManualTrade(m);
    setForexDemoDispatch(fd);
    setForexDemoConfirm(fc);
    setForexDemoManualTrade(fm);
    setM5PaperStatus(m5);
    setM1PaperStatus(m1);
    setXauVwapPaperStatus(xauV);
    setM5RealStatus(m5r);
    setM5RealDemoDispatch(m5rd);
    setM5RealDemoConfirm(m5rc);
    setXauVwapLiveStatus(xvl);
    setXauVwapLiveDemoDispatch(xvld);
    setXauVwapLiveDemoConfirm(xvlc);
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load admin data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.role, refresh]);

  // Soft clock for remaining-time display on the M5 and XAU VWAP LIVE tabs.
  useEffect(() => {
    if (tab !== 'm5paper' && tab !== 'xauvwaplive') return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [tab]);

  // Refresh M5 paper/real status while the experimental tab is open.
  useEffect(() => {
    if (user?.role !== 'admin' || tab !== 'm5paper') return;
    const id = window.setInterval(() => {
      void refresh().catch(() => {
        /* keep last known status; banner already surfaces hard load errors */
      });
    }, 15000);
    return () => window.clearInterval(id);
  }, [user?.role, tab, refresh]);

  // Refresh XAU VWAP LIVE status while that tab is open.
  useEffect(() => {
    if (user?.role !== 'admin' || tab !== 'xauvwaplive') return;
    const id = window.setInterval(() => {
      void refresh().catch(() => {
        /* keep last known status; banner already surfaces hard load errors */
      });
    }, 15000);
    return () => window.clearInterval(id);
  }, [user?.role, tab, refresh]);

  if (user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  async function onSelectUser(id: string) {
    setError(null);
    try {
      setSelectedUser(await getAdminUser(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load user.');
    }
  }

  async function onConfirmTierPatch() {
    if (!editTier) return;
    const next = Number(ceilingDraft);
    if (!Number.isFinite(next) || next <= 0) {
      setError('max_risk_ceiling must be a positive number.');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await patchRiskTier(editTier.tier, { max_risk_ceiling: next });
      setEditTier(null);
      setMessage(`Tier ${editTier.tier} updated.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function onMarkReviewed(strategy: CandidateStrategy) {
    if (
      !window.confirm(
        `Mark "${strategy.name}" as reviewed by admin? This is recorded in the audit log.`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await patchCandidateStrategy(strategy.id, { reviewed_by_admin: true });
      setMessage(`Marked ${strategy.name} reviewed.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function onEnableDemoDispatch() {
    const minutes = Number.parseInt(demoDispatchMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('Dispatch duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable synthetics DEMO real-dispatch bypass (Layer 3) for ${minutes} minute(s)? ` +
          'Confirmed demo sessions may place real MT5 orders.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableSyntheticDemoDispatch(minutes);
      setDemoDispatch(status);
      setMessage(`Layer 3 demo-dispatch enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableDemoDispatch() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableSyntheticDemoDispatch();
      setDemoDispatch(status);
      setMessage('Layer 3 demo-dispatch disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onEnableDemoConfirm() {
    const minutes = Number.parseInt(demoConfirmMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('Confirm duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable synthetics DEMO confirm-live bypass (Layer 2) for ${minutes} minute(s)? ` +
          'Demo accounts may pass the confirm-live step. Layer 3 is still required to dispatch orders.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableSyntheticDemoConfirm(minutes);
      setDemoConfirm(status);
      setMessage(`Layer 2 demo-confirm enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableDemoConfirm() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableSyntheticDemoConfirm();
      setDemoConfirm(status);
      setMessage('Layer 2 demo-confirm disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onEnableDemoManualTrade() {
    const minutes = Number.parseInt(demoManualTradeMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('Manual test-trade duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable synthetics MANUAL test-dispatch/close for ${minutes} minute(s)? ` +
          'Allows POST /bot/synthetic/test-dispatch-real and test-close-real. ' +
          'Layer 2 + Layer 3 are still required for demo real execution.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableSyntheticDemoManualTrade(minutes);
      setDemoManualTrade(status);
      setMessage(`Manual test-trade enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableDemoManualTrade() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableSyntheticDemoManualTrade();
      setDemoManualTrade(status);
      setMessage('Synthetics manual test-trade disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onEnableForexDemoDispatch() {
    const minutes = Number.parseInt(forexDemoDispatchMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('Forex dispatch duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable forex DEMO real-dispatch bypass (Layer 3) for ${minutes} minute(s)? ` +
          'Confirmed demo sessions may place real MT5 orders on forex/gold.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableForexDemoDispatch(minutes);
      setForexDemoDispatch(status);
      setMessage(`Forex Layer 3 demo-dispatch enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableForexDemoDispatch() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableForexDemoDispatch();
      setForexDemoDispatch(status);
      setMessage('Forex Layer 3 demo-dispatch disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onEnableForexDemoConfirm() {
    const minutes = Number.parseInt(forexDemoConfirmMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('Forex confirm duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable forex DEMO confirm-live bypass (Layer 2) for ${minutes} minute(s)? ` +
          'Demo accounts may pass the confirm-live step. Layer 3 is still required to dispatch orders.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableForexDemoConfirm(minutes);
      setForexDemoConfirm(status);
      setMessage(`Forex Layer 2 demo-confirm enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableForexDemoConfirm() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableForexDemoConfirm();
      setForexDemoConfirm(status);
      setMessage('Forex Layer 2 demo-confirm disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onEnableForexDemoManualTrade() {
    const minutes = Number.parseInt(forexDemoManualTradeMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('Forex manual test-trade duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable forex MANUAL test-dispatch/close for ${minutes} minute(s)? ` +
          'Allows forex test-dispatch-real and test-close-real endpoints. ' +
          'Layer 2 + Layer 3 are still required for demo real execution.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableForexDemoManualTrade(minutes);
      setForexDemoManualTrade(status);
      setMessage(`Forex manual test-trade enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableForexDemoManualTrade() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableForexDemoManualTrade();
      setForexDemoManualTrade(status);
      setMessage('Forex manual test-trade disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onStartM5Paper() {
    if (
      !window.confirm(
        'Start the M5 PAPER-ONLY experimental session? This never places real ' +
          'orders — it only simulates entries/exits in memory using live M5 ' +
          'market data, purely for measurement.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await startM5PaperSession();
      setM5PaperStatus(status);
      setMessage('M5 paper-only session started.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Start failed.');
    }
  }

  async function onStopM5Paper() {
    setError(null);
    setMessage(null);
    try {
      const status = await stopM5PaperSession();
      setM5PaperStatus(status);
      setMessage('M5 paper-only session stopped.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stop failed.');
    }
  }

  async function onStartM1Paper() {
    if (
      !window.confirm(
        'Start the M1 PAPER-ONLY experimental session? This never places real ' +
          'orders — it only simulates entries/exits in memory using live M1 ' +
          'market data, purely for measurement.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await startM1PaperSession();
      setM1PaperStatus(status);
      setMessage('M1 paper-only session started.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Start failed.');
    }
  }

  async function onStopM1Paper() {
    setError(null);
    setMessage(null);
    try {
      const status = await stopM1PaperSession();
      setM1PaperStatus(status);
      setMessage('M1 paper-only session stopped.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stop failed.');
    }
  }

  async function onStartXauVwapPaper() {
    if (
      !window.confirm(
        'Start the XAUUSD VWAP p90 PAPER-ONLY experimental session? Candidate signal ' +
          'from a small backtest — NOT proven. Never places real orders.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await startXauVwapPaperSession();
      setXauVwapPaperStatus(status);
      setMessage('XAU VWAP paper-only session started.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Start failed.');
    }
  }

  async function onStopXauVwapPaper() {
    setError(null);
    setMessage(null);
    try {
      const status = await stopXauVwapPaperSession();
      setXauVwapPaperStatus(status);
      setMessage('XAU VWAP paper-only session stopped.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stop failed.');
    }
  }

  async function onConfirmM5RealLiveTrading(phrase: string) {
    setError(null);
    setMessage(null);
    setM5Confirming(true);
    try {
      const result = await confirmM5RealLiveTrading(phrase);
      setM5ConfirmedAt(result.m5_live_trading_confirmed_at);
      setM5ConfirmModalOpen(false);
      setMessage(
        `M5 real-dispatch live trading confirmed for bot_instance ${result.bot_instance_id} ` +
          `(account_type=${result.account_type}). Expires in ${LIVE_TRADING_CONFIRMATION_TTL_MINUTES} minutes if you don't Start; cleared on Stop.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Confirmation failed.');
      throw err;
    } finally {
      setM5Confirming(false);
    }
  }

  async function onStartM5Real() {
    if (
      !window.confirm(
        'Start the M5 REAL-DISPATCH experimental session? UNPROVEN LIVE — this CAN place ' +
          'real MT5 orders if Layer 1-3 are all armed. Testing-only. Do not start this ' +
          'unless you intend to test real order placement right now.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await startM5RealSession();
      setM5RealStatus(status);
      setMessage('M5 real-dispatch session started.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Start failed.');
    }
  }

  async function onStopM5Real() {
    setError(null);
    setMessage(null);
    try {
      const status = await stopM5RealSession();
      setM5RealStatus(status);
      setM5ConfirmedAt(null);
      setMessage('M5 real-dispatch session stopped. Confirm-live cleared.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stop failed.');
    }
  }

  async function onEnableM5RealDemoDispatch() {
    const minutes = Number.parseInt(m5RealDemoDispatchMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('M5 real dispatch duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable M5 real-dispatch DEMO bypass (Layer 3) for ${minutes} minute(s)? ` +
          'Confirmed demo sessions may place real MT5 orders via the M5 experiment.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableM5RealDemoDispatch(minutes);
      setM5RealDemoDispatch(status);
      setMessage(`M5 real Layer 3 demo-dispatch enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableM5RealDemoDispatch() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableM5RealDemoDispatch();
      setM5RealDemoDispatch(status);
      setMessage('M5 real Layer 3 demo-dispatch disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onEnableM5RealDemoConfirm() {
    const minutes = Number.parseInt(m5RealDemoConfirmMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('M5 real confirm duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable M5 real-dispatch DEMO confirm bypass (Layer 2) for ${minutes} minute(s)? ` +
          'Demo accounts may pass M5 confirm-live. Layer 3 is still required to dispatch.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableM5RealDemoConfirm(minutes);
      setM5RealDemoConfirm(status);
      setMessage(`M5 real Layer 2 demo-confirm enabled until ${status.enabled_until ?? '—'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableM5RealDemoConfirm() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableM5RealDemoConfirm();
      setM5RealDemoConfirm(status);
      setMessage('M5 real Layer 2 demo-confirm disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onConfirmXauVwapLiveTrading(phrase: string) {
    setError(null);
    setMessage(null);
    setXauVwapLiveConfirming(true);
    try {
      const result = await confirmXauVwapLiveTrading(phrase);
      setXauVwapLiveConfirmedAt(result.xau_vwap_live_trading_confirmed_at);
      setXauVwapLiveConfirmModalOpen(false);
      setMessage(
        `XAU VWAP LIVE trading confirmed for bot_instance ${result.bot_instance_id} ` +
          `(account_type=${result.account_type}). Expires in ${LIVE_TRADING_CONFIRMATION_TTL_MINUTES} minutes if you don't Start; cleared on Stop.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Confirmation failed.');
      throw err;
    } finally {
      setXauVwapLiveConfirming(false);
    }
  }

  async function onStartXauVwapLive() {
    if (
      !window.confirm(
        'Start the XAUUSD VWAP p90 LIVE session? REAL MONEY — this CAN place real MT5 ' +
          'orders if Layer 1-3 are all armed. Controlled live testing only. Do not start ' +
          'unless you intend to test real order placement right now.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await startXauVwapLiveSession();
      setXauVwapLiveStatus(status);
      setMessage('XAU VWAP LIVE session started.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Start failed.');
    }
  }

  async function onStopXauVwapLive() {
    setError(null);
    setMessage(null);
    try {
      const status = await stopXauVwapLiveSession();
      setXauVwapLiveStatus(status);
      setXauVwapLiveConfirmedAt(null);
      setMessage('XAU VWAP LIVE session stopped. Confirm-live cleared.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stop failed.');
    }
  }

  async function onEnableXauVwapLiveDemoDispatch() {
    const minutes = Number.parseInt(xauVwapLiveDemoDispatchMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('XAU VWAP LIVE dispatch duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable XAU VWAP LIVE DEMO bypass (Layer 3) for ${minutes} minute(s)? ` +
          'Confirmed demo sessions may place real MT5 orders via the XAU VWAP LIVE harness.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableXauVwapLiveDemoDispatch(minutes);
      setXauVwapLiveDemoDispatch(status);
      setMessage(
        `XAU VWAP LIVE Layer 3 demo-dispatch enabled until ${status.enabled_until ?? '—'}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableXauVwapLiveDemoDispatch() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableXauVwapLiveDemoDispatch();
      setXauVwapLiveDemoDispatch(status);
      setMessage('XAU VWAP LIVE Layer 3 demo-dispatch disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  async function onEnableXauVwapLiveDemoConfirm() {
    const minutes = Number.parseInt(xauVwapLiveDemoConfirmMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      setError('XAU VWAP LIVE confirm duration must be an integer from 1 to 30 minutes.');
      return;
    }
    if (
      !window.confirm(
        `Enable XAU VWAP LIVE DEMO confirm bypass (Layer 2) for ${minutes} minute(s)? ` +
          'Demo accounts may pass XAU VWAP confirm-live. Layer 3 is still required to dispatch.',
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const status = await enableXauVwapLiveDemoConfirm(minutes);
      setXauVwapLiveDemoConfirm(status);
      setMessage(
        `XAU VWAP LIVE Layer 2 demo-confirm enabled until ${status.enabled_until ?? '—'}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enable failed.');
    }
  }

  async function onDisableXauVwapLiveDemoConfirm() {
    setError(null);
    setMessage(null);
    try {
      const status = await disableXauVwapLiveDemoConfirm();
      setXauVwapLiveDemoConfirm(status);
      setMessage('XAU VWAP LIVE Layer 2 demo-confirm disabled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disable failed.');
    }
  }

  if (loading) {
    return <p className="text-text-secondary">Loading admin…</p>;
  }

  return (
    <div className="flex flex-col gap-6" style={{ ['--accent-admin' as string]: ADMIN_ACCENT }}>
      <div>
        <h1 className="type-display-sm" style={{ color: ADMIN_ACCENT }}>
          Admin
        </h1>
        <p className="mt-1 text-text-secondary">
          Users, system health, risk-tier tuning, candidate strategies, and testing toggles.
        </p>
      </div>

      {error ? (
        <p className="rounded-[8px] border border-state-danger/40 bg-state-danger/10 px-4 py-3 text-state-danger">
          {error}
        </p>
      ) : null}
      {message ? <p className="type-caption text-text-secondary">{message}</p> : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['health', 'System health'],
            ['users', 'Users'],
            ['tiers', 'Risk tiers'],
            ['strategies', 'Strategies'],
            ['demo', 'Demo dispatch'],
            ['m5paper', 'M5 (experimental)'],
            ['m1paper', 'M1 paper (experimental)'],
            ['xauvwappaper', 'XAU VWAP paper (experimental)'],
            ['xauvwaplive', 'XAUUSD VWAP p90 — LIVE (REAL MONEY)'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            variant={tab === id ? 'primary' : 'ghost'}
            onClick={() => setTab(id)}
            style={tab === id ? { backgroundColor: ADMIN_ACCENT, borderColor: ADMIN_ACCENT } : undefined}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === 'health' && health ? (
        <GlassCard>
          <h2 className="type-heading mb-4">System health</h2>
          <p className="mb-2">
            Status:{' '}
            <span style={{ color: health.status === 'ok' ? undefined : '#C45C5C' }}>
              {health.status}
            </span>
          </p>
          <ul className="type-caption space-y-1 text-text-secondary">
            <li>
              Postgres: {health.postgres.ok ? 'ok' : 'down'}
              {health.postgres.latency_ms != null ? ` (${health.postgres.latency_ms} ms)` : ''}
            </li>
            <li>
              Redis: {health.redis.ok ? 'ok' : 'down'}
              {health.redis.latency_ms != null ? ` (${health.redis.latency_ms} ms)` : ''}
            </li>
            <li>Users: {health.counts.users ?? '—'}</li>
            <li>Bots running: {health.counts.bots_running ?? '—'}</li>
            <li>Reports on disk records: {health.counts.reports ?? '—'}</li>
          </ul>
        </GlassCard>
      ) : null}

      {tab === 'users' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <GlassCard>
            <h2 className="type-heading mb-4">Users</h2>
            <DataTable
              emptyMessage="No users."
              getRowKey={(row) => row.id}
              columns={[
                { key: 'email', header: 'Email', render: (row) => row.email },
                { key: 'role', header: 'Role', render: (row) => row.role },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <Button variant="ghost" onClick={() => void onSelectUser(row.id)}>
                      Detail
                    </Button>
                  ),
                },
              ]}
              rows={users}
            />
          </GlassCard>
          <GlassCard>
            <h2 className="type-heading mb-4">User detail</h2>
            {!selectedUser ? (
              <p className="text-text-secondary">Select a user.</p>
            ) : (
              <div className="space-y-2 type-caption text-text-secondary">
                <p className="text-text-primary">{selectedUser.email}</p>
                <p>Role: {selectedUser.role}</p>
                <p>Trades: {selectedUser.trade_count}</p>
                <p>Brokers: {selectedUser.broker_connections.length}</p>
                <p>Bot instances: {selectedUser.bot_instances.length}</p>
              </div>
            )}
          </GlassCard>
        </div>
      ) : null}

      {tab === 'tiers' ? (
        <GlassCard>
          <h2 className="type-heading mb-4">Risk tiers</h2>
          <DataTable
            emptyMessage="No tiers."
            getRowKey={(row) => String(row.tier)}
            columns={[
              { key: 'tier', header: 'Tier', render: (row) => row.tier },
              {
                key: 'blocks',
                header: 'Blocks min',
                render: (row) => row.completed_blocks_min,
              },
              { key: 'step', header: 'Step', render: (row) => row.step_size },
              { key: 'base', header: 'Base', render: (row) => row.base_risk },
              {
                key: 'ceiling',
                header: 'Ceiling',
                render: (row) => row.max_risk_ceiling,
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) => (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditTier(row);
                      setCeilingDraft(String(row.max_risk_ceiling));
                    }}
                  >
                    Edit ceiling
                  </Button>
                ),
              },
            ]}
            rows={tiers}
          />

          {editTier ? (
            <div className="mt-6 max-w-md space-y-3 border-t border-border-subtle pt-4">
              <p className="text-text-primary">
                Update tier {editTier.tier} max_risk_ceiling. This writes an admin audit log
                entry and affects future APIRS sizing for that tier.
              </p>
              <Input
                label="max_risk_ceiling"
                type="number"
                step="0.001"
                value={ceilingDraft}
                onChange={(e) => setCeilingDraft(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={() => void onConfirmTierPatch()}>Confirm update</Button>
                <Button variant="ghost" onClick={() => setEditTier(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </GlassCard>
      ) : null}

      {tab === 'strategies' ? (
        <GlassCard>
          <h2 className="type-heading mb-4">Candidate strategies</h2>
          <DataTable
            emptyMessage="No strategies."
            getRowKey={(row) => row.id}
            columns={[
              { key: 'name', header: 'Name', render: (row) => row.name },
              { key: 'status', header: 'Status', render: (row) => row.status },
              { key: 'source', header: 'Source', render: (row) => row.source },
              {
                key: 'reviewed',
                header: 'Reviewed',
                render: (row) => (row.reviewed_by_admin ? 'yes' : 'no'),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) =>
                  row.reviewed_by_admin ? (
                    <span className="type-caption text-text-secondary">—</span>
                  ) : (
                    <Button variant="ghost" onClick={() => void onMarkReviewed(row)}>
                      Mark reviewed
                    </Button>
                  ),
              },
            ]}
            rows={strategies}
          />
        </GlassCard>
      ) : null}

      {tab === 'demo' ? (
        <div className="flex flex-col gap-6">
          <p className="type-caption text-state-danger">
            Dangerous testing-only infrastructure for synthetics and forex. Layer 2
            lets a demo account pass confirm-live; Layer 3 lets a confirmed session
            place real MT5 orders; the manual test-trade toggle gates test-dispatch-real
            / test-close-real. Each auto-expires (max 30 minutes). Not for real-account
            trading.
          </p>

          <h2 className="type-heading text-text-primary">Synthetics</h2>

          <GlassCard>
            <h2 className="type-heading mb-2">Synthetics — Demo confirm bypass (Layer 2)</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Controls whether a demo account can get through the confirm-live step. Does
              not by itself allow order placement — enable Layer 3 as well for dispatch.
            </p>
            {demoConfirm ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {demoConfirm.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {demoConfirm.enabled ? (
                  <>
                    <p>Until: {demoConfirm.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(demoConfirm.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={demoConfirmMinutes}
                onChange={(e) => setDemoConfirmMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableDemoConfirm()}>
                  Enable confirm bypass
                </Button>
                {demoConfirm?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableDemoConfirm()}>
                    Disable now
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Refresh status
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Synthetics — Demo dispatch bypass (Layer 3)</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Controls whether a confirmed session can actually dispatch real orders on a
              demo account. Requires Layer 2 (confirm) to have succeeded first.
            </p>
            {demoDispatch ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {demoDispatch.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {demoDispatch.enabled ? (
                  <>
                    <p>Until: {demoDispatch.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(demoDispatch.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={demoDispatchMinutes}
                onChange={(e) => setDemoDispatchMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableDemoDispatch()}>
                  Enable dispatch bypass
                </Button>
                {demoDispatch?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableDemoDispatch()}>
                    Disable now
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Refresh status
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Synthetics — Manual test-dispatch / close</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Gates the testing-only endpoints that force a real open or close outside the
              strategy loop (test-dispatch-real / test-close-real). Does not replace Layer
              2 or Layer 3 — those still control demo confirm and real dispatch.
            </p>
            {demoManualTrade ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {demoManualTrade.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {demoManualTrade.enabled ? (
                  <>
                    <p>Until: {demoManualTrade.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(demoManualTrade.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={demoManualTradeMinutes}
                onChange={(e) => setDemoManualTradeMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableDemoManualTrade()}>
                  Enable manual test-trade
                </Button>
                {demoManualTrade?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableDemoManualTrade()}>
                    Disable now
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Refresh status
                </Button>
              </div>
            </div>
          </GlassCard>

          <h2 className="type-heading text-text-primary">Forex</h2>

          <GlassCard>
            <h2 className="type-heading mb-2">Forex — Demo confirm bypass (Layer 2)</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Controls whether a demo account can get through the forex confirm-live step.
              Does not by itself allow order placement — enable Layer 3 as well for
              dispatch.
            </p>
            {forexDemoConfirm ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {forexDemoConfirm.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {forexDemoConfirm.enabled ? (
                  <>
                    <p>Until: {forexDemoConfirm.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(forexDemoConfirm.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={forexDemoConfirmMinutes}
                onChange={(e) => setForexDemoConfirmMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableForexDemoConfirm()}>
                  Enable confirm bypass
                </Button>
                {forexDemoConfirm?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableForexDemoConfirm()}>
                    Disable now
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Refresh status
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Forex — Demo dispatch bypass (Layer 3)</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Controls whether a confirmed forex session can actually dispatch real orders
              on a demo account. Requires Layer 2 (confirm) to have succeeded first.
            </p>
            {forexDemoDispatch ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {forexDemoDispatch.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {forexDemoDispatch.enabled ? (
                  <>
                    <p>Until: {forexDemoDispatch.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(forexDemoDispatch.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={forexDemoDispatchMinutes}
                onChange={(e) => setForexDemoDispatchMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableForexDemoDispatch()}>
                  Enable dispatch bypass
                </Button>
                {forexDemoDispatch?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableForexDemoDispatch()}>
                    Disable now
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Refresh status
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Forex — Manual test-dispatch / close</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Gates the testing-only endpoints that force a real forex open or close
              outside the strategy loop (test-dispatch-real / test-close-real). Does
              not replace Layer 2 or Layer 3 — those still control demo confirm and real
              dispatch.
            </p>
            {forexDemoManualTrade ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {forexDemoManualTrade.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {forexDemoManualTrade.enabled ? (
                  <>
                    <p>Until: {forexDemoManualTrade.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(forexDemoManualTrade.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={forexDemoManualTradeMinutes}
                onChange={(e) => setForexDemoManualTradeMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableForexDemoManualTrade()}>
                  Enable manual test-trade
                </Button>
                {forexDemoManualTrade?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableForexDemoManualTrade()}>
                    Disable now
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Refresh status
                </Button>
              </div>
            </div>
          </GlassCard>
        </div>
      ) : null}

      {tab === 'm5paper' ? (
        <div className="flex flex-col gap-6">
          <p className="type-caption text-state-danger">
            Experimental — PAPER-ONLY, not proven. Simulates entries/exits in
            memory using live M5 market data and the same strategy gates as the
            main engine, but never places a real order — there is no code path
            here that reaches the broker. Completely separate from the
            Trading page&apos;s M15 Start Trading control. See{' '}
            docs/14_M5_Forex_Paper_Experiment.md. Enabling real dispatch for M5
            is a deliberate future decision that requires explicit human
            review; this tool does not unlock it.
          </p>

          <GlassCard>
            <h2 className="type-heading mb-2">M5 forex/gold paper session</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Watchlist: {m5PaperStatus?.watchlist.join(', ') ?? '—'}. Ticks every{' '}
              {m5PaperStatus ? Math.round(m5PaperStatus.tickMs / 1000) : '—'}s.
              History is in-memory only and resets on backend restart.
            </p>
            {m5PaperStatus ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {m5PaperStatus.status === 'running' ? 'RUNNING' : 'stopped'}
                  </span>
                </p>
                {m5PaperStatus.startedAt ? <p>Started: {m5PaperStatus.startedAt}</p> : null}
                <p>Ticks so far: {m5PaperStatus.tickCount}</p>
                {m5PaperStatus.lastTickError ? (
                  <p className="text-state-danger">Last tick error: {m5PaperStatus.lastTickError}</p>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={() => void onStartM5Paper()}>
                Start M5 paper session
              </Button>
              {m5PaperStatus?.status === 'running' ? (
                <Button variant="ghost" onClick={() => void onStopM5Paper()}>
                  Stop
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => void refresh()}>
                Refresh status
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Open position (paper)</h2>
            {m5PaperStatus?.openTrade ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>
                  {m5PaperStatus.openTrade.symbol} {m5PaperStatus.openTrade.direction} @{' '}
                  {m5PaperStatus.openTrade.entryPrice} (lot {m5PaperStatus.openTrade.lotSize})
                </li>
                <li>Strategy: {m5PaperStatus.openTrade.strategyName}</li>
                <li>
                  Stop {m5PaperStatus.openTrade.stopPrice} / Target{' '}
                  {m5PaperStatus.openTrade.targetPrice}
                </li>
                <li>Opened: {m5PaperStatus.openTrade.openedAt}</li>
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No open paper position.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Recent closed paper trades</h2>
            {m5PaperStatus && m5PaperStatus.closedTrades.length > 0 ? (
              <DataTable
                emptyMessage="No closed trades yet."
                getRowKey={(row) => `${row.symbol}-${row.closedAt ?? row.openedAt}`}
                columns={[
                  { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
                  { key: 'direction', header: 'Dir', render: (row) => row.direction },
                  { key: 'strategy', header: 'Strategy', render: (row) => row.strategyName },
                  { key: 'outcome', header: 'Outcome', render: (row) => row.outcome ?? '—' },
                  {
                    key: 'pnl',
                    header: 'PnL',
                    numeric: true,
                    render: (row) => (row.pnl != null ? row.pnl.toFixed(2) : '—'),
                  },
                  { key: 'closedAt', header: 'Closed', render: (row) => row.closedAt ?? '—' },
                ]}
                rows={m5PaperStatus.closedTrades}
              />
            ) : (
              <p className="type-caption text-text-secondary">No closed trades yet.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Decision log (most recent first)</h2>
            {m5PaperStatus && m5PaperStatus.decisionLog.length > 0 ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                {m5PaperStatus.decisionLog.slice(0, 20).map((entry, i) => (
                  <li key={`${entry.at}-${i}`}>
                    {entry.at} — {entry.type}
                    {entry.symbol ? ` — ${entry.symbol}` : ''}
                    {entry.direction ? ` ${entry.direction}` : ''}
                    {entry.reason ? ` (${entry.reason})` : ''}
                    {entry.message ? ` — ${entry.message}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No decisions logged yet.</p>
            )}
          </GlassCard>

          <h2 className="type-heading text-state-danger">
            M5 Real-Dispatch — Experimental, has not yet completed a proven live trade
          </h2>
          <p className="type-caption text-state-danger">
            Testing-only. Unlike the paper session above, this CAN place real MT5 orders.
            Separate module/singleton from paper, reachable only from this admin tab — never
            from the Trading page (that stays M15 until M5 has genuinely completed live
            trades and a separate decision promotes it). Requires Layer 1
            (M5_REAL_TRADING_ENABLED env, server-side only), Layer 2 (confirm-live below,
            independent of forex&apos;s own confirm-live), and — on a demo account only —
            Layer 3 (demo-dispatch bypass below). See docs/14_M5_Forex_Paper_Experiment.md.
          </p>

          <GlassCard>
            <h2 className="type-heading mb-2">Gate status (auto-refreshes every 15s)</h2>
            <div className="mb-2 space-y-1 type-caption text-text-secondary">
              <p>
                Session:{' '}
                <span
                  className="text-text-primary"
                  style={
                    m5RealStatus?.status === 'error' ? { color: '#C45C5C' } : undefined
                  }
                >
                  {m5RealStatus ? m5RealStatus.status.toUpperCase() : '—'}
                </span>
                {m5RealStatus?.botInstanceId
                  ? ` · botInstanceId ${m5RealStatus.botInstanceId}`
                  : ' · botInstanceId null'}
              </p>
              <p>
                Layer 1 kill switch:{' '}
                <span className="text-text-primary">
                  {m5RealStatus?.realTradingEnabled ? 'ENABLED' : 'disabled'}
                </span>
              </p>
              <p>
                Confirm-live remaining:{' '}
                <span className="text-text-primary">
                  {confirmLiveRemainingSeconds(m5ConfirmedAt, nowTick) > 0
                    ? formatRemaining(confirmLiveRemainingSeconds(m5ConfirmedAt, nowTick))
                    : 'not armed / expired'}
                </span>
                {m5ConfirmedAt ? ` (since ${m5ConfirmedAt})` : ''}
              </p>
              <p>
                Demo-confirm remaining:{' '}
                <span className="text-text-primary">
                  {m5RealDemoConfirm?.enabled
                    ? formatRemaining(m5RealDemoConfirm.remaining_seconds)
                    : 'disabled'}
                </span>
              </p>
              <p>
                Demo-dispatch remaining:{' '}
                <span className="text-text-primary">
                  {m5RealDemoDispatch?.enabled
                    ? formatRemaining(m5RealDemoDispatch.remaining_seconds)
                    : 'disabled'}
                </span>
              </p>
              {m5RealStatus?.haltReason ? (
                <p className="text-state-danger">Halt reason: {m5RealStatus.haltReason}</p>
              ) : null}
            </div>
            <Button variant="ghost" onClick={() => void refresh()}>
              Refresh status now
            </Button>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Layer 2 — M5 confirm-live (this admin account)</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Independent of forex&apos;s live_trading_confirmed_at and synthetics&apos; own
              confirmation — confirming here does not confirm or affect M15 forex, and vice
              versa. Uses the same deliberate-typing phrase modal as forex Confirm Live.
              Requires a real account, or a demo account with the Layer 2 demo-confirm bypass
              below enabled. The M5 real session must be stopped to confirm. Expires after{' '}
              {LIVE_TRADING_CONFIRMATION_TTL_MINUTES} minutes if you don&apos;t Start; cleared
              on every Stop.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                onClick={() => {
                  setError(null);
                  setM5ConfirmModalOpen(true);
                }}
                disabled={m5RealStatus?.status === 'running'}
              >
                Confirm M5 live trading…
              </Button>
              <Button variant="ghost" onClick={() => void refresh()}>
                Refresh status
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Layer 2 bypass — M5 demo confirm-live</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Lets a demo account pass M5 confirm-live above. Independent of forex/synthetic
              demo-confirm. Does not by itself allow order placement — Layer 3 below is still
              required to dispatch.
            </p>
            {m5RealDemoConfirm ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {m5RealDemoConfirm.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {m5RealDemoConfirm.enabled ? (
                  <>
                    <p>Until: {m5RealDemoConfirm.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(m5RealDemoConfirm.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={m5RealDemoConfirmMinutes}
                onChange={(e) => setM5RealDemoConfirmMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableM5RealDemoConfirm()}>
                  Enable demo-confirm (30 min)
                </Button>
                {m5RealDemoConfirm?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableM5RealDemoConfirm()}>
                    Disable now
                  </Button>
                ) : null}
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Layer 3 bypass — M5 demo real-dispatch</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Lets a confirmed M5 real session actually dispatch real orders on a demo
              account. Independent of forex/synthetic demo-dispatch. Requires Layer 2
              (confirm) to have succeeded first. Not needed on a real account.
            </p>
            {m5RealDemoDispatch ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {m5RealDemoDispatch.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {m5RealDemoDispatch.enabled ? (
                  <>
                    <p>Until: {m5RealDemoDispatch.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(m5RealDemoDispatch.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={m5RealDemoDispatchMinutes}
                onChange={(e) => setM5RealDemoDispatchMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onEnableM5RealDemoDispatch()}>
                  Enable demo-dispatch (30 min)
                </Button>
                {m5RealDemoDispatch?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableM5RealDemoDispatch()}>
                    Disable now
                  </Button>
                ) : null}
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">M5 real-dispatch session</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Watchlist: {m5RealStatus?.watchlist.join(', ') ?? '—'}. Ticks every{' '}
              {m5RealStatus ? Math.round(m5RealStatus.tickMs / 1000) : '—'}s. Re-verifies
              Layer 1-3 on every tick — if any gate degrades mid-session (confirm-live
              expiring, a demo bypass being disabled), this halts to an error state rather
              than falling back to paper. No resume-after-backend-restart for an open real
              position — the broker-side stop/target still protects it, but this harness
              will not track it after a restart.
            </p>
            {m5RealStatus ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span
                    className="text-text-primary"
                    style={
                      m5RealStatus.status === 'error' ? { color: '#C45C5C' } : undefined
                    }
                  >
                    {m5RealStatus.status.toUpperCase()}
                  </span>
                </p>
                {m5RealStatus.startedAt ? <p>Started: {m5RealStatus.startedAt}</p> : null}
                <p>Ticks so far: {m5RealStatus.tickCount}</p>
                {m5RealStatus.haltReason ? (
                  <p className="text-state-danger">Halt reason: {m5RealStatus.haltReason}</p>
                ) : null}
                {m5RealStatus.lastTickError ? (
                  <p className="text-state-danger">
                    Last tick error: {m5RealStatus.lastTickError}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                onClick={() => void onStartM5Real()}
                disabled={m5RealStatus?.status === 'running'}
              >
                Start M5 real session
              </Button>
              {m5RealStatus?.status === 'running' || m5RealStatus?.status === 'error' ? (
                <Button variant="ghost" onClick={() => void onStopM5Real()}>
                  Stop M5 real session
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => void refresh()}>
                Refresh status
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Open position (real)</h2>
            {m5RealStatus?.openTrade ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>
                  {m5RealStatus.openTrade.symbol} {m5RealStatus.openTrade.direction} @{' '}
                  {m5RealStatus.openTrade.entryPrice} (lot {m5RealStatus.openTrade.lotSize})
                </li>
                <li>Broker ticket: {m5RealStatus.openTrade.brokerTicket}</li>
                <li>Strategy: {m5RealStatus.openTrade.strategyName}</li>
                <li>
                  Stop {m5RealStatus.openTrade.stopPrice} / Target{' '}
                  {m5RealStatus.openTrade.targetPrice}
                </li>
                <li>Opened: {m5RealStatus.openTrade.openedAt}</li>
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No open real position.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Recent closed real trades</h2>
            {m5RealStatus && m5RealStatus.closedTrades.length > 0 ? (
              <DataTable
                emptyMessage="No closed trades yet."
                getRowKey={(row) => `${row.brokerTicket}-${row.closedAt ?? row.openedAt}`}
                columns={[
                  { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
                  { key: 'direction', header: 'Dir', render: (row) => row.direction },
                  { key: 'ticket', header: 'Ticket', render: (row) => row.brokerTicket },
                  {
                    key: 'pnl',
                    header: 'PnL',
                    numeric: true,
                    render: (row) => (row.pnl != null ? row.pnl.toFixed(2) : '—'),
                  },
                  { key: 'closedAt', header: 'Closed', render: (row) => row.closedAt ?? '—' },
                ]}
                rows={m5RealStatus.closedTrades}
              />
            ) : (
              <p className="type-caption text-text-secondary">No closed trades yet.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Real-dispatch decision log (most recent first)</h2>
            {m5RealStatus && m5RealStatus.decisionLog.length > 0 ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                {m5RealStatus.decisionLog.slice(0, 20).map((entry, i) => (
                  <li key={`${entry.at}-${i}`}>
                    {entry.at} — {entry.type}
                    {entry.symbol ? ` — ${entry.symbol}` : ''}
                    {entry.direction ? ` ${entry.direction}` : ''}
                    {entry.brokerTicket ? ` ticket=${entry.brokerTicket}` : ''}
                    {entry.reason ? ` (${entry.reason})` : ''}
                    {entry.message ? ` — ${entry.message}` : ''}
                    {entry.halt ? ' [HALT]' : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No decisions logged yet.</p>
            )}
          </GlassCard>

          <ConfirmLiveTradingModal
            open={m5ConfirmModalOpen}
            confirming={m5Confirming}
            allowDemoConfirm={Boolean(m5RealDemoConfirm?.enabled)}
            onClose={() => {
              if (!m5Confirming) setM5ConfirmModalOpen(false);
            }}
            onConfirm={onConfirmM5RealLiveTrading}
          />
        </div>
      ) : null}

      {tab === 'm1paper' ? (
        <div className="flex flex-col gap-6">
          <p className="type-caption text-state-danger">
            Experimental — PAPER-ONLY, not proven. Simulates entries/exits in
            memory using live M1 market data and the same strategy gates as the
            main engine, but never places a real order — there is no code path
            here that reaches the broker. Completely separate from the Trading
            page&apos;s M15 Start Trading control and from M5 paper/real. See{' '}
            docs/15_M1_Forex_Paper_Experiment.md. Enabling real dispatch for M1
            is a deliberate future decision that requires explicit human review;
            this tool does not unlock it.
          </p>

          <GlassCard>
            <h2 className="type-heading mb-2">M1 forex/gold paper session</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Watchlist: {m1PaperStatus?.watchlist.join(', ') ?? '—'}. Ticks every{' '}
              {m1PaperStatus ? Math.round(m1PaperStatus.tickMs / 1000) : '—'}s.
              History is in-memory only and resets on backend restart.
            </p>
            {m1PaperStatus ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {m1PaperStatus.status === 'running' ? 'RUNNING' : 'stopped'}
                  </span>
                </p>
                {m1PaperStatus.startedAt ? <p>Started: {m1PaperStatus.startedAt}</p> : null}
                <p>Ticks so far: {m1PaperStatus.tickCount}</p>
                {m1PaperStatus.lastTickError ? (
                  <p className="text-state-danger">Last tick error: {m1PaperStatus.lastTickError}</p>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={() => void onStartM1Paper()}>
                Start M1 paper session
              </Button>
              {m1PaperStatus?.status === 'running' ? (
                <Button variant="ghost" onClick={() => void onStopM1Paper()}>
                  Stop
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => void refresh()}>
                Refresh status
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Open position (paper)</h2>
            {m1PaperStatus?.openTrade ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>
                  {m1PaperStatus.openTrade.symbol} {m1PaperStatus.openTrade.direction} @{' '}
                  {m1PaperStatus.openTrade.entryPrice} (lot {m1PaperStatus.openTrade.lotSize})
                </li>
                <li>Strategy: {m1PaperStatus.openTrade.strategyName}</li>
                <li>
                  Stop {m1PaperStatus.openTrade.stopPrice} / Target{' '}
                  {m1PaperStatus.openTrade.targetPrice}
                </li>
                <li>Opened: {m1PaperStatus.openTrade.openedAt}</li>
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No open paper position.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Recent closed paper trades</h2>
            {m1PaperStatus && m1PaperStatus.closedTrades.length > 0 ? (
              <DataTable
                emptyMessage="No closed trades yet."
                getRowKey={(row) => `${row.symbol}-${row.closedAt ?? row.openedAt}`}
                columns={[
                  { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
                  { key: 'direction', header: 'Dir', render: (row) => row.direction },
                  { key: 'strategy', header: 'Strategy', render: (row) => row.strategyName },
                  { key: 'outcome', header: 'Outcome', render: (row) => row.outcome ?? '—' },
                  {
                    key: 'pnl',
                    header: 'PnL',
                    numeric: true,
                    render: (row) => (row.pnl != null ? row.pnl.toFixed(2) : '—'),
                  },
                  { key: 'closedAt', header: 'Closed', render: (row) => row.closedAt ?? '—' },
                ]}
                rows={m1PaperStatus.closedTrades}
              />
            ) : (
              <p className="type-caption text-text-secondary">No closed trades yet.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Decision log (most recent first)</h2>
            {m1PaperStatus && m1PaperStatus.decisionLog.length > 0 ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                {m1PaperStatus.decisionLog.slice(0, 20).map((entry, i) => (
                  <li key={`${entry.at}-${i}`}>
                    {entry.at} — {entry.type}
                    {entry.symbol ? ` — ${entry.symbol}` : ''}
                    {entry.direction ? ` ${entry.direction}` : ''}
                    {entry.reason ? ` (${entry.reason})` : ''}
                    {entry.message ? ` — ${entry.message}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No decisions logged yet.</p>
            )}
          </GlassCard>
        </div>
      ) : null}

      {tab === 'xauvwappaper' ? (
        <div className="flex flex-col gap-6">
          <p className="type-caption text-state-danger">
            Experimental — PAPER-ONLY, candidate signal, not proven. XAUUSD M5 only:
            intraday VWAP p90 stretch-reversion (trade toward VWAP on empirical p90
            cross). Simulates entries/exits in memory using live M5 data — never places
            a real order. Based on a ~3.5-day costed backtest (n=16, E[R]=+0.31) —
            requires extended paper validation before any real-dispatch consideration.
            See docs/16_XAU_VWAP_Paper_Experiment.md. No confirm-live, no real-trading
            flag, no path to placeOrder for this strategy.
          </p>

          <GlassCard>
            <h2 className="type-heading mb-2">XAUUSD VWAP p90 paper session</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Symbol: {xauVwapPaperStatus?.symbol ?? 'XAUUSD'}. Timeframe:{' '}
              {xauVwapPaperStatus?.timeframe ?? 'M5'}. Bars per tick:{' '}
              {xauVwapPaperStatus?.barCount ?? '—'}. Ticks every{' '}
              {xauVwapPaperStatus ? Math.round(xauVwapPaperStatus.tickMs / 1000) : '—'}s.
            </p>
            {xauVwapPaperStatus ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {xauVwapPaperStatus.status === 'running' ? 'RUNNING' : 'stopped'}
                  </span>
                </p>
                {xauVwapPaperStatus.startedAt ? (
                  <p>Started: {xauVwapPaperStatus.startedAt}</p>
                ) : null}
                <p>Ticks so far: {xauVwapPaperStatus.tickCount}</p>
                {xauVwapPaperStatus.lastTickError ? (
                  <p className="text-state-danger">
                    Last tick error: {xauVwapPaperStatus.lastTickError}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={() => void onStartXauVwapPaper()}>
                Start XAU VWAP paper session
              </Button>
              {xauVwapPaperStatus?.status === 'running' ? (
                <Button variant="ghost" onClick={() => void onStopXauVwapPaper()}>
                  Stop
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => void refresh()}>
                Refresh status
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Open position (paper)</h2>
            {xauVwapPaperStatus?.openTrade ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>
                  {xauVwapPaperStatus.openTrade.symbol}{' '}
                  {xauVwapPaperStatus.openTrade.direction} @{' '}
                  {xauVwapPaperStatus.openTrade.entryPrice} (lot{' '}
                  {xauVwapPaperStatus.openTrade.lotSize})
                </li>
                <li>Strategy: {xauVwapPaperStatus.openTrade.strategyName}</li>
                <li>
                  p90 threshold at signal: {xauVwapPaperStatus.openTrade.p90Threshold}
                </li>
                <li>
                  Stop {xauVwapPaperStatus.openTrade.stopPrice} / Target{' '}
                  {xauVwapPaperStatus.openTrade.targetPrice}
                </li>
                <li>Opened: {xauVwapPaperStatus.openTrade.openedAt}</li>
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No open paper position.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Closed trades (paper)</h2>
            {xauVwapPaperStatus && xauVwapPaperStatus.closedTrades.length > 0 ? (
              <DataTable
                emptyMessage="No closed trades yet."
                getRowKey={(row) => `${row.symbol}-${row.closedAt ?? row.openedAt}`}
                columns={[
                  { key: 'direction', header: 'Dir', render: (row) => row.direction },
                  { key: 'entryPrice', header: 'Entry', render: (row) => row.entryPrice },
                  { key: 'closePrice', header: 'Exit', render: (row) => row.closePrice ?? '—' },
                  {
                    key: 'pnl',
                    header: 'PnL',
                    numeric: true,
                    render: (row) => (row.pnl != null ? row.pnl.toFixed(2) : '—'),
                  },
                  { key: 'outcome', header: 'Outcome', render: (row) => row.outcome ?? '—' },
                  { key: 'closedAt', header: 'Closed', render: (row) => row.closedAt ?? '—' },
                ]}
                rows={xauVwapPaperStatus.closedTrades}
              />
            ) : (
              <p className="type-caption text-text-secondary">No closed trades yet.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Decision log (most recent first)</h2>
            {xauVwapPaperStatus && xauVwapPaperStatus.decisionLog.length > 0 ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                {xauVwapPaperStatus.decisionLog.slice(0, 20).map((entry, i) => (
                  <li key={`${entry.at}-${i}`}>
                    {entry.at} — {entry.type}
                    {entry.symbol ? ` — ${entry.symbol}` : ''}
                    {entry.direction ? ` ${entry.direction}` : ''}
                    {entry.p90Threshold != null ? ` p90=${entry.p90Threshold}` : ''}
                    {entry.reason ? ` (${entry.reason})` : ''}
                    {entry.message ? ` — ${entry.message}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No decisions logged yet.</p>
            )}
          </GlassCard>
        </div>
      ) : null}

      {tab === 'xauvwaplive' ? (
        <div className="flex flex-col gap-6">
          <p className="rounded-[8px] border border-state-danger/60 bg-state-danger/15 px-4 py-3 type-caption text-state-danger">
            <strong>REAL MONEY — CONTROLLED LIVE TESTING.</strong> Unlike the XAU VWAP paper tab,
            this harness CAN place real MT5 orders on XAUUSD when Layers 0–3 are armed. Admin-only
            — never exposed on the Trading page. See docs/17_XAU_VWAP_Live_Strategy.md. Do not start
            unless you intend to test real order placement right now.
          </p>

          <GlassCard>
            <h2 className="type-heading mb-2">Gate status (auto-refreshes every 15s)</h2>
            <div className="mb-2 space-y-1 type-caption text-text-secondary">
              <p>
                Strategy status:{' '}
                <span
                  className="text-text-primary"
                  style={
                    xauVwapLiveStatus?.uiStatus === 'BLOCKED' ? { color: '#C45C5C' } : undefined
                  }
                >
                  {xauVwapLiveStatus?.uiStatus ?? '—'}
                </span>
                {' · '}
                Session:{' '}
                <span
                  className="text-text-primary"
                  style={
                    xauVwapLiveStatus?.status === 'error' ? { color: '#C45C5C' } : undefined
                  }
                >
                  {xauVwapLiveStatus ? xauVwapLiveStatus.status.toUpperCase() : '—'}
                </span>
                {xauVwapLiveStatus?.botInstanceId
                  ? ` · botInstanceId ${xauVwapLiveStatus.botInstanceId}`
                  : ' · botInstanceId null'}
              </p>
              <p>
                Instrument:{' '}
                <span className="text-text-primary">{xauVwapLiveStatus?.instrument ?? 'XAUUSD'}</span>
                {' · '}
                Timeframe:{' '}
                <span className="text-text-primary">{xauVwapLiveStatus?.timeframe ?? 'M5'}</span>
              </p>
              <p>
                Layer 1 kill switch:{' '}
                <span className="text-text-primary">
                  {xauVwapLiveStatus?.liveTradingEnabled ? 'ENABLED' : 'disabled'}
                </span>
              </p>
              <p>
                Emergency stop:{' '}
                <span
                  className="text-text-primary"
                  style={
                    xauVwapLiveStatus?.emergencyStopActive ? { color: '#C45C5C' } : undefined
                  }
                >
                  {xauVwapLiveStatus?.emergencyStopActive ? 'ACTIVE' : 'off'}
                </span>
              </p>
              <p>
                Broker / execution mode:{' '}
                <span className="text-text-primary">
                  {xauVwapLiveStatus?.brokerStatus
                    ? `${xauVwapLiveStatus.brokerStatus.account_type} · ${xauVwapLiveStatus.brokerStatus.mode}`
                    : '—'}
                </span>
              </p>
              <p>
                Confirm-live remaining:{' '}
                <span className="text-text-primary">
                  {confirmLiveRemainingSeconds(xauVwapLiveConfirmedAt, nowTick) > 0
                    ? formatRemaining(confirmLiveRemainingSeconds(xauVwapLiveConfirmedAt, nowTick))
                    : 'not armed / expired'}
                </span>
                {xauVwapLiveConfirmedAt ? ` (since ${xauVwapLiveConfirmedAt})` : ''}
              </p>
              <p>
                Demo-confirm remaining:{' '}
                <span className="text-text-primary">
                  {xauVwapLiveDemoConfirm?.enabled
                    ? formatRemaining(xauVwapLiveDemoConfirm.remaining_seconds)
                    : 'disabled'}
                </span>
              </p>
              <p>
                Demo-dispatch remaining:{' '}
                <span className="text-text-primary">
                  {xauVwapLiveDemoDispatch?.enabled
                    ? formatRemaining(xauVwapLiveDemoDispatch.remaining_seconds)
                    : 'disabled'}
                </span>
              </p>
              {xauVwapLiveStatus?.haltReason ? (
                <p className="text-state-danger">Halt reason: {xauVwapLiveStatus.haltReason}</p>
              ) : null}
            </div>
            <Button variant="ghost" onClick={() => void refresh()}>
              Refresh status now
            </Button>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Market snapshot</h2>
            {xauVwapLiveStatus?.lastMarketSnapshot?.ok !== false ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>
                  VWAP:{' '}
                  {xauVwapLiveStatus?.lastMarketSnapshot?.vwap != null
                    ? xauVwapLiveStatus.lastMarketSnapshot.vwap.toFixed(2)
                    : '—'}
                </li>
                <li>
                  p90 threshold:{' '}
                  {xauVwapLiveStatus?.lastMarketSnapshot?.p90Threshold != null
                    ? xauVwapLiveStatus.lastMarketSnapshot.p90Threshold.toFixed(4)
                    : '—'}
                </li>
                <li>
                  Spread:{' '}
                  {xauVwapLiveStatus?.lastMarketSnapshot?.spread != null
                    ? xauVwapLiveStatus.lastMarketSnapshot.spread.toFixed(4)
                    : '—'}
                </li>
                <li>
                  ATR:{' '}
                  {xauVwapLiveStatus?.lastMarketSnapshot?.atr != null
                    ? xauVwapLiveStatus.lastMarketSnapshot.atr.toFixed(4)
                    : '—'}
                </li>
                <li>
                  Stop distance:{' '}
                  {xauVwapLiveStatus?.lastMarketSnapshot?.stopDistance != null
                    ? xauVwapLiveStatus.lastMarketSnapshot.stopDistance.toFixed(4)
                    : '—'}
                </li>
                <li>
                  Target distance:{' '}
                  {xauVwapLiveStatus?.lastMarketSnapshot?.targetDistance != null
                    ? xauVwapLiveStatus.lastMarketSnapshot.targetDistance.toFixed(4)
                    : '—'}
                </li>
                <li>
                  Risk allocation:{' '}
                  {xauVwapLiveStatus?.lastMarketSnapshot?.appliedRisk != null
                    ? `${(xauVwapLiveStatus.lastMarketSnapshot.appliedRisk * 100).toFixed(2)}%`
                    : '—'}
                </li>
                {xauVwapLiveStatus?.lastMarketSnapshot?.at ? (
                  <li>Snapshot at: {xauVwapLiveStatus.lastMarketSnapshot.at}</li>
                ) : null}
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">
                Snapshot unavailable
                {xauVwapLiveStatus?.lastMarketSnapshot?.reason
                  ? ` (${xauVwapLiveStatus.lastMarketSnapshot.reason})`
                  : ''}
                .
              </p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Strategy performance</h2>
            {xauVwapLiveStatus ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>
                  Strategy P&amp;L:{' '}
                  <span className="text-text-primary">
                    {xauVwapLiveStatus.strategyPnl.toFixed(2)}
                  </span>
                </li>
                <li>Live trade count: {xauVwapLiveStatus.liveTradeCount}</li>
                <li>
                  Win rate:{' '}
                  {xauVwapLiveStatus.winRate != null
                    ? `${(xauVwapLiveStatus.winRate * 100).toFixed(1)}%`
                    : '—'}
                </li>
                <li>
                  Average R:{' '}
                  {xauVwapLiveStatus.averageR != null
                    ? xauVwapLiveStatus.averageR.toFixed(2)
                    : '—'}
                </li>
                <li>Max drawdown: {xauVwapLiveStatus.maxDrawdown.toFixed(2)}</li>
                <li>
                  Last execution: {xauVwapLiveStatus.lastExecutionAt ?? '—'}
                </li>
                <li>Signals detected: {xauVwapLiveStatus.signalsDetected}</li>
                <li>
                  Orders attempted / rejected: {xauVwapLiveStatus.ordersAttempted} /{' '}
                  {xauVwapLiveStatus.ordersRejected}
                </li>
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">Status unavailable.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Layer 2 — XAU VWAP confirm-live (this admin account)</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Independent of M15 forex, M5 real-dispatch, and synthetics confirm-live. Uses the same
              deliberate-typing phrase modal. Requires a real account, or a demo account with the
              Layer 2 demo-confirm bypass below. The XAU VWAP LIVE session must be stopped to
              confirm. Expires after {LIVE_TRADING_CONFIRMATION_TTL_MINUTES} minutes if you
              don&apos;t Start; cleared on every Stop.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                onClick={() => {
                  setError(null);
                  setXauVwapLiveConfirmModalOpen(true);
                }}
                disabled={xauVwapLiveStatus?.status === 'running'}
              >
                Confirm XAU VWAP LIVE trading…
              </Button>
              <Button variant="ghost" onClick={() => void refresh()}>
                Refresh status
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Layer 2 bypass — XAU VWAP demo confirm-live</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Lets a demo account pass XAU VWAP confirm-live above. Does not by itself allow order
              placement — Layer 3 below is still required to dispatch.
            </p>
            {xauVwapLiveDemoConfirm ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {xauVwapLiveDemoConfirm.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {xauVwapLiveDemoConfirm.enabled ? (
                  <>
                    <p>Until: {xauVwapLiveDemoConfirm.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(xauVwapLiveDemoConfirm.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={xauVwapLiveDemoConfirmMinutes}
                onChange={(e) => setXauVwapLiveDemoConfirmMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  onClick={() => void onEnableXauVwapLiveDemoConfirm()}
                >
                  Enable demo-confirm
                </Button>
                {xauVwapLiveDemoConfirm?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableXauVwapLiveDemoConfirm()}>
                    Disable now
                  </Button>
                ) : null}
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Layer 3 bypass — XAU VWAP demo real-dispatch</h2>
            <p className="mb-4 type-caption text-text-secondary">
              Lets a confirmed XAU VWAP LIVE session actually dispatch real orders on a demo account.
              Requires Layer 2 (confirm) to have succeeded first. Not needed on a real account.
            </p>
            {xauVwapLiveDemoDispatch ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span className="text-text-primary">
                    {xauVwapLiveDemoDispatch.enabled ? 'ENABLED' : 'disabled'}
                  </span>
                </p>
                {xauVwapLiveDemoDispatch.enabled ? (
                  <>
                    <p>Until: {xauVwapLiveDemoDispatch.enabled_until ?? '—'}</p>
                    <p>Remaining: {formatRemaining(xauVwapLiveDemoDispatch.remaining_seconds)}</p>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex max-w-md flex-col gap-3">
              <Input
                label="Duration (minutes, 1–30)"
                type="number"
                min={1}
                max={30}
                step={1}
                value={xauVwapLiveDemoDispatchMinutes}
                onChange={(e) => setXauVwapLiveDemoDispatchMinutes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  onClick={() => void onEnableXauVwapLiveDemoDispatch()}
                >
                  Enable demo-dispatch
                </Button>
                {xauVwapLiveDemoDispatch?.enabled ? (
                  <Button variant="ghost" onClick={() => void onDisableXauVwapLiveDemoDispatch()}>
                    Disable now
                  </Button>
                ) : null}
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">XAU VWAP LIVE session</h2>
            <p className="mb-4 type-caption text-text-secondary">
              {xauVwapLiveStatus?.strategyLabel ?? 'XAUUSD VWAP p90 — LIVE'}. Ticks every{' '}
              {xauVwapLiveStatus ? Math.round(xauVwapLiveStatus.tickMs / 1000) : '—'}s.
              Re-verifies Layer 1-3 on every tick — if any gate degrades mid-session, this halts to
              an error state rather than falling back to paper.
            </p>
            {xauVwapLiveStatus ? (
              <div className="mb-4 space-y-1 type-caption text-text-secondary">
                <p>
                  Status:{' '}
                  <span
                    className="text-text-primary"
                    style={
                      xauVwapLiveStatus.status === 'error' ? { color: '#C45C5C' } : undefined
                    }
                  >
                    {xauVwapLiveStatus.status.toUpperCase()}
                  </span>
                </p>
                {xauVwapLiveStatus.startedAt ? (
                  <p>Started: {xauVwapLiveStatus.startedAt}</p>
                ) : null}
                <p>Ticks so far: {xauVwapLiveStatus.tickCount}</p>
                <p>Candles observed: {xauVwapLiveStatus.candlesObserved}</p>
                {xauVwapLiveStatus.haltReason ? (
                  <p className="text-state-danger">Halt reason: {xauVwapLiveStatus.haltReason}</p>
                ) : null}
                {xauVwapLiveStatus.lastTickError ? (
                  <p className="text-state-danger">
                    Last tick error: {xauVwapLiveStatus.lastTickError}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-text-secondary">Status unavailable.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                onClick={() => void onStartXauVwapLive()}
                disabled={xauVwapLiveStatus?.status === 'running'}
              >
                Start XAU VWAP LIVE session
              </Button>
              {xauVwapLiveStatus?.status === 'running' || xauVwapLiveStatus?.status === 'error' ? (
                <Button variant="ghost" onClick={() => void onStopXauVwapLive()}>
                  Stop XAU VWAP LIVE session
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => void refresh()}>
                Refresh status
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Last signal</h2>
            {xauVwapLiveStatus?.lastSignal ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>At: {xauVwapLiveStatus.lastSignal.at}</li>
                <li>Outcome: {xauVwapLiveStatus.lastSignal.outcome}</li>
                {xauVwapLiveStatus.lastSignal.details ? (
                  <li>Details: {JSON.stringify(xauVwapLiveStatus.lastSignal.details)}</li>
                ) : null}
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No signal recorded yet.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Last order</h2>
            {xauVwapLiveStatus?.lastOrder ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>At: {xauVwapLiveStatus.lastOrder.at}</li>
                <li>
                  {xauVwapLiveStatus.lastOrder.symbol} {xauVwapLiveStatus.lastOrder.direction} @{' '}
                  {xauVwapLiveStatus.lastOrder.entryPrice} (lot {xauVwapLiveStatus.lastOrder.lotSize})
                </li>
                <li>Broker ticket: {xauVwapLiveStatus.lastOrder.brokerTicket}</li>
                <li>Status: {xauVwapLiveStatus.lastOrder.status ?? '—'}</li>
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No order recorded yet.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Open position (real money)</h2>
            {xauVwapLiveStatus?.openTrade ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                <li>
                  {xauVwapLiveStatus.openTrade.symbol} {xauVwapLiveStatus.openTrade.direction} @{' '}
                  {xauVwapLiveStatus.openTrade.entryPrice} (lot {xauVwapLiveStatus.openTrade.lotSize})
                </li>
                <li>Broker ticket: {xauVwapLiveStatus.openTrade.brokerTicket}</li>
                <li>Strategy: {xauVwapLiveStatus.openTrade.strategyName}</li>
                {xauVwapLiveStatus.openTrade.p90Threshold != null ? (
                  <li>p90 at signal: {xauVwapLiveStatus.openTrade.p90Threshold}</li>
                ) : null}
                <li>
                  Stop {xauVwapLiveStatus.openTrade.stopPrice} / Target{' '}
                  {xauVwapLiveStatus.openTrade.targetPrice}
                </li>
                <li>
                  Risk allocation:{' '}
                  {(xauVwapLiveStatus.openTrade.appliedRisk * 100).toFixed(2)}%
                </li>
                <li>Opened: {xauVwapLiveStatus.openTrade.openedAt}</li>
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No open real position.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Recent closed real trades</h2>
            {xauVwapLiveStatus && xauVwapLiveStatus.closedTrades.length > 0 ? (
              <DataTable
                emptyMessage="No closed trades yet."
                getRowKey={(row) => `${row.brokerTicket}-${row.closedAt ?? row.openedAt}`}
                columns={[
                  { key: 'direction', header: 'Dir', render: (row) => row.direction },
                  { key: 'ticket', header: 'Ticket', render: (row) => row.brokerTicket },
                  {
                    key: 'pnl',
                    header: 'PnL',
                    numeric: true,
                    render: (row) => (row.pnl != null ? row.pnl.toFixed(2) : '—'),
                  },
                  {
                    key: 'realizedR',
                    header: 'R',
                    numeric: true,
                    render: (row) =>
                      row.realizedR != null ? row.realizedR.toFixed(2) : '—',
                  },
                  { key: 'closedAt', header: 'Closed', render: (row) => row.closedAt ?? '—' },
                ]}
                rows={xauVwapLiveStatus.closedTrades}
              />
            ) : (
              <p className="type-caption text-text-secondary">No closed trades yet.</p>
            )}
          </GlassCard>

          <GlassCard>
            <h2 className="type-heading mb-2">Decision log (most recent first)</h2>
            {xauVwapLiveStatus && xauVwapLiveStatus.decisionLog.length > 0 ? (
              <ul className="type-caption space-y-1 text-text-secondary">
                {xauVwapLiveStatus.decisionLog.slice(0, 20).map((entry, i) => (
                  <li key={`${entry.at}-${i}`}>
                    {entry.at} — {entry.type}
                    {entry.symbol ? ` — ${entry.symbol}` : ''}
                    {entry.direction ? ` ${entry.direction}` : ''}
                    {entry.brokerTicket ? ` ticket=${entry.brokerTicket}` : ''}
                    {entry.p90Threshold != null ? ` p90=${entry.p90Threshold}` : ''}
                    {entry.reason ? ` (${entry.reason})` : ''}
                    {entry.message ? ` — ${entry.message}` : ''}
                    {entry.halt ? ' [HALT]' : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-caption text-text-secondary">No decisions logged yet.</p>
            )}
          </GlassCard>

          <ConfirmLiveTradingModal
            open={xauVwapLiveConfirmModalOpen}
            confirming={xauVwapLiveConfirming}
            allowDemoConfirm={Boolean(xauVwapLiveDemoConfirm?.enabled)}
            onClose={() => {
              if (!xauVwapLiveConfirming) setXauVwapLiveConfirmModalOpen(false);
            }}
            onConfirm={onConfirmXauVwapLiveTrading}
          />
        </div>
      ) : null}
    </div>
  );
}
