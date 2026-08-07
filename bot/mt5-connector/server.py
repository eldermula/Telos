"""
Telos MT5 Connector — local Python service (04 System Architecture §3.6).
Validates broker credentials against a running MetaTrader 5 terminal.

Phase 2 demo mode (terminal already logged into MetaQuotes-Demo):
  POST /validate initializes the terminal and checks account_info.
  If `login` is provided, it must match the attached account login.
  Password/server are accepted for storage by the Backend but are not
  re-sent to MT5 in attach-mode validation (terminal session is already active).

Internal-only — never expose this port through Cloudflare Tunnel.
"""

from __future__ import annotations

import json
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    import MetaTrader5 as mt5
except ImportError:  # pragma: no cover
    mt5 = None

HOST = "127.0.0.1"
PORT = 3100

# 08_Bot_Architecture.md Section 13 / 09_Security.md Section 11 — the
# real/demo/contest distinction MT5 itself already tracks per account,
# surfaced here rather than left undetected. Detected automatically from
# the live terminal at validate time, not user-supplied, since a
# user-entered flag could be wrong (accidentally or otherwise) in
# exactly the case this exists to protect against.
ACCOUNT_TRADE_MODES = (
    {
        mt5.ACCOUNT_TRADE_MODE_DEMO: "demo",
        mt5.ACCOUNT_TRADE_MODE_CONTEST: "contest",
        mt5.ACCOUNT_TRADE_MODE_REAL: "real",
    }
    if mt5
    else {}
)


def validate(payload: dict) -> tuple[int, dict]:
    if mt5 is None:
        return 500, {
            "ok": False,
            "message": "MetaTrader5 package is not installed. Run: pip install MetaTrader5",
        }

    login_raw = payload.get("login")
    if login_raw is None or login_raw == "":
        return 400, {"ok": False, "message": "login is required"}

    try:
        expected_login = int(str(login_raw).strip())
    except ValueError:
        return 400, {"ok": False, "message": "login must be a numeric account id"}

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {
            "ok": False,
            "connection_status": "error",
            "message": f"MT5 initialize failed: {err}",
        }

    try:
        info = mt5.account_info()
        if info is None:
            err = mt5.last_error()
            return 422, {
                "ok": False,
                "connection_status": "error",
                "message": f"MT5 account_info unavailable: {err}",
            }

        if int(info.login) != expected_login:
            return 422, {
                "ok": False,
                "connection_status": "error",
                "message": "Attached MT5 account login does not match provided credentials.login",
            }

        account_type = ACCOUNT_TRADE_MODES.get(info.trade_mode)
        if account_type is None:
            # Fail closed rather than guess — an unrecognized trade_mode
            # is exactly the kind of thing this check exists to catch,
            # not something to silently default past.
            return 422, {
                "ok": False,
                "connection_status": "error",
                "message": f"Unrecognized MT5 account trade_mode: {info.trade_mode}",
            }

        return 200, {
            "ok": True,
            "connection_status": "connected",
            "account_login": int(info.login),
            "server": getattr(info, "server", None),
            "account_type": account_type,
        }
    finally:
        # Leave the terminal running; only detach this process's IPC handle.
        mt5.shutdown()


# 4.6a — order execution capability (04 System Architecture §3.6, Bot
# Architecture Module 7). Manually-triggered only for this increment —
# not called by BotRuntime's automatic tick loop (see 12_Roadmap.md
# Phase 4 / this revision's explicit 4.6b deferral).

FILLING_MODES = [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN] if mt5 else []


def send_with_filling_retry(request: dict):
    """Different brokers/symbols support different filling modes; retry
    across the common set rather than guessing one and failing outright."""
    last_result = None
    for filling in FILLING_MODES:
        request["type_filling"] = filling
        result = mt5.order_send(request)
        last_result = result
        if result is not None and result.retcode == mt5.TRADE_RETCODE_DONE:
            return result
        if result is not None and result.retcode != mt5.TRADE_RETCODE_INVALID_FILL:
            return result
    return last_result


def get_symbol_info(symbol: str | None) -> tuple[int, dict]:
    if mt5 is None:
        return 500, {"ok": False, "message": "MetaTrader5 package is not installed."}
    if not symbol:
        return 400, {"ok": False, "message": "symbol query param is required"}

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
        if not mt5.symbol_select(symbol, True):
            return 422, {"ok": False, "message": f"Unable to select symbol {symbol}"}
        info = mt5.symbol_info(symbol)
        if info is None:
            return 422, {"ok": False, "message": f"symbol_info unavailable for {symbol}"}
        tick = mt5.symbol_info_tick(symbol)
        return 200, {
            "ok": True,
            "symbol": symbol,
            "volume_min": info.volume_min,
            "volume_max": info.volume_max,
            "volume_step": info.volume_step,
            "trade_mode": info.trade_mode,
            # SYMBOL_TRADE_MODE_FULL — anything else (incl. market closed
            # for the weekend) means order_send would be rejected.
            "trade_mode_full": info.trade_mode == mt5.SYMBOL_TRADE_MODE_FULL,
            "digits": info.digits,
            "point": info.point,
            "bid": tick.bid if tick else None,
            "ask": tick.ask if tick else None,
            "tick_time": tick.time if tick else None,
        }
    finally:
        mt5.shutdown()


# 08_Bot_Architecture.md Section 9.0/Module 2 — historical bars for
# technical indicators (ADX/ATR). No endpoint for this existed before
# the watchlist revision; a single current tick (/symbol-info) isn't
# enough to compute trend/volatility.

TIMEFRAMES = (
    {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    }
    if mt5
    else {}
)
MAX_RATES_COUNT = 1000


def get_rates(symbol: str | None, timeframe_raw: str | None, count_raw: str | None) -> tuple[int, dict]:
    if mt5 is None:
        return 500, {"ok": False, "message": "MetaTrader5 package is not installed."}
    if not symbol:
        return 400, {"ok": False, "message": "symbol query param is required"}

    timeframe = (timeframe_raw or "M15").upper()
    tf = TIMEFRAMES.get(timeframe)
    if tf is None:
        return 400, {
            "ok": False,
            "message": f"timeframe must be one of {sorted(TIMEFRAMES.keys())}",
        }

    try:
        count = int(count_raw) if count_raw else 100
    except ValueError:
        return 400, {"ok": False, "message": "count must be an integer"}
    if count <= 0 or count > MAX_RATES_COUNT:
        return 400, {"ok": False, "message": f"count must be between 1 and {MAX_RATES_COUNT}"}

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
        if not mt5.symbol_select(symbol, True):
            return 422, {"ok": False, "message": f"Unable to select symbol {symbol}"}
        rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
        if rates is None or len(rates) == 0:
            err = mt5.last_error()
            return 422, {"ok": False, "message": f"No rates available for {symbol}: {err}"}

        return 200, {
            "ok": True,
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": [
                {
                    "time": int(r["time"]),
                    "open": float(r["open"]),
                    "high": float(r["high"]),
                    "low": float(r["low"]),
                    "close": float(r["close"]),
                    "tick_volume": int(r["tick_volume"]),
                }
                for r in rates
            ],
        }
    finally:
        mt5.shutdown()


def list_positions(symbol: str | None) -> tuple[int, dict]:
    if mt5 is None:
        return 500, {"ok": False, "message": "MetaTrader5 package is not installed."}

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
        positions = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
        positions = positions or []
        return 200, {
            "ok": True,
            "positions": [
                {
                    "ticket": p.ticket,
                    "symbol": p.symbol,
                    "volume": p.volume,
                    "type": "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL",
                    "price_open": p.price_open,
                    "sl": p.sl,
                    "tp": p.tp,
                    "profit": p.profit,
                }
                for p in positions
            ],
        }
    finally:
        mt5.shutdown()


def place_order(payload: dict) -> tuple[int, dict]:
    if mt5 is None:
        return 500, {"ok": False, "message": "MetaTrader5 package is not installed."}

    symbol = str(payload.get("symbol") or "").strip()
    direction = str(payload.get("direction") or "").strip().upper()
    volume_raw = payload.get("volume")
    expected_account_type = str(payload.get("expected_account_type") or "").strip().lower()

    if not symbol:
        return 400, {"ok": False, "message": "symbol is required"}
    if direction not in ("BUY", "SELL"):
        return 400, {"ok": False, "message": "direction must be BUY or SELL"}
    try:
        volume = float(volume_raw)
    except (TypeError, ValueError):
        return 400, {"ok": False, "message": "volume must be a number"}
    if volume <= 0:
        return 400, {"ok": False, "message": "volume must be positive"}
    # Layer 0 of Option 2's gating design (CHANGELOG.md) — required, not
    # optional: an omittable check isn't a real safety layer. Every
    # caller, including the pre-existing 4.6a manual path, must state
    # which account type it believes it's trading against, verified below
    # against what's actually attached, before order_send is ever called.
    if expected_account_type not in ("demo", "contest", "real"):
        return 400, {
            "ok": False,
            "message": "expected_account_type is required and must be one of demo/contest/real",
        }

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
        account = mt5.account_info()
        if account is None:
            err = mt5.last_error()
            return 422, {"ok": False, "message": f"MT5 account_info unavailable: {err}"}
        actual_account_type = ACCOUNT_TRADE_MODES.get(account.trade_mode)
        if actual_account_type is None:
            # Same fail-closed treatment as validate()'s equivalent branch
            # — an unrecognized trade_mode is not something to guess past.
            return 422, {
                "ok": False,
                "message": f"Unrecognized MT5 account trade_mode: {account.trade_mode}",
            }
        if actual_account_type != expected_account_type:
            return 422, {
                "ok": False,
                "message": (
                    f"Account type mismatch: caller expected '{expected_account_type}' but the "
                    f"attached terminal is '{actual_account_type}' — refusing to place order"
                ),
                "expected_account_type": expected_account_type,
                "actual_account_type": actual_account_type,
            }

        if not mt5.symbol_select(symbol, True):
            return 422, {"ok": False, "message": f"Unable to select symbol {symbol}"}

        info = mt5.symbol_info(symbol)
        if info is None:
            return 422, {"ok": False, "message": f"symbol_info unavailable for {symbol}"}
        if info.trade_mode != mt5.SYMBOL_TRADE_MODE_FULL:
            return 422, {
                "ok": False,
                "message": (
                    f"Symbol {symbol} trading is not fully enabled "
                    f"(trade_mode={info.trade_mode}) — market may be closed"
                ),
            }

        tick = mt5.symbol_info_tick(symbol)
        if tick is None or tick.ask == 0 or tick.bid == 0:
            return 422, {"ok": False, "message": f"No live tick for {symbol} — market likely closed"}

        order_type = mt5.ORDER_TYPE_BUY if direction == "BUY" else mt5.ORDER_TYPE_SELL
        price = tick.ask if direction == "BUY" else tick.bid

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "price": price,
            "deviation": 20,
            "magic": 20260806,
            "comment": "telos-4.6a",
            "type_time": mt5.ORDER_TIME_GTC,
        }
        sl = payload.get("sl")
        tp = payload.get("tp")
        if sl:
            request["sl"] = float(sl)
        if tp:
            request["tp"] = float(tp)

        result = send_with_filling_retry(request)
        if result is None:
            err = mt5.last_error()
            return 422, {"ok": False, "message": f"order_send returned None: {err}"}
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return 422, {
                "ok": False,
                "message": f"order_send failed: retcode={result.retcode} comment={result.comment}",
                "retcode": result.retcode,
            }

        return 200, {
            "ok": True,
            "ticket": result.order,
            "deal": result.deal,
            "volume": result.volume,
            "price": result.price,
            "symbol": symbol,
            "direction": direction,
        }
    finally:
        mt5.shutdown()


def close_order(payload: dict) -> tuple[int, dict]:
    if mt5 is None:
        return 500, {"ok": False, "message": "MetaTrader5 package is not installed."}

    try:
        ticket = int(payload.get("ticket"))
    except (TypeError, ValueError):
        return 400, {"ok": False, "message": "ticket must be an integer position id"}

    # Layer 0 — same required check as place_order, and for the same
    # reason: closing a real position is just as sensitive as opening
    # one, arguably more so (a bug here closes the wrong account's
    # position), so this gets no exemption either.
    expected_account_type = str(payload.get("expected_account_type") or "").strip().lower()
    if expected_account_type not in ("demo", "contest", "real"):
        return 400, {
            "ok": False,
            "message": "expected_account_type is required and must be one of demo/contest/real",
        }

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
        account = mt5.account_info()
        if account is None:
            err = mt5.last_error()
            return 422, {"ok": False, "message": f"MT5 account_info unavailable: {err}"}
        actual_account_type = ACCOUNT_TRADE_MODES.get(account.trade_mode)
        if actual_account_type is None:
            return 422, {
                "ok": False,
                "message": f"Unrecognized MT5 account trade_mode: {account.trade_mode}",
            }
        if actual_account_type != expected_account_type:
            return 422, {
                "ok": False,
                "message": (
                    f"Account type mismatch: caller expected '{expected_account_type}' but the "
                    f"attached terminal is '{actual_account_type}' — refusing to close order"
                ),
                "expected_account_type": expected_account_type,
                "actual_account_type": actual_account_type,
            }

        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            return 404, {"ok": False, "message": f"No open position with ticket {ticket}"}
        pos = positions[0]

        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            return 422, {"ok": False, "message": f"No live tick for {pos.symbol}"}

        if pos.type == mt5.POSITION_TYPE_BUY:
            order_type = mt5.ORDER_TYPE_SELL
            price = tick.bid
        else:
            order_type = mt5.ORDER_TYPE_BUY
            price = tick.ask

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": order_type,
            "position": pos.ticket,
            "price": price,
            "deviation": 20,
            "magic": 20260806,
            "comment": "telos-4.6a-close",
            "type_time": mt5.ORDER_TIME_GTC,
        }

        result = send_with_filling_retry(request)
        if result is None:
            err = mt5.last_error()
            return 422, {"ok": False, "message": f"order_send returned None: {err}"}
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return 422, {
                "ok": False,
                "message": f"close failed: retcode={result.retcode} comment={result.comment}",
                "retcode": result.retcode,
            }

        return 200, {
            "ok": True,
            "ticket": ticket,
            "closed_volume": result.volume,
            "close_price": result.price,
        }
    finally:
        mt5.shutdown()


# Option 2 Increment B — real balance/equity read, needed both by
# real-mode position sizing (percentage risk only stays coherent
# against the real account balance, not the internal paper ledger) and
# by syncing bot_instances.active_trading_balance/peak_equity for
# real-mode instances (broker as source of truth, per CHANGELOG.md).
# Read-only, no expected_account_type gating needed here — nothing is
# risked by reading it, unlike place_order/close_order.


def get_account_info() -> tuple[int, dict]:
    if mt5 is None:
        return 500, {"ok": False, "message": "MetaTrader5 package is not installed."}

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
        info = mt5.account_info()
        if info is None:
            err = mt5.last_error()
            return 422, {"ok": False, "message": f"MT5 account_info unavailable: {err}"}

        account_type = ACCOUNT_TRADE_MODES.get(info.trade_mode)
        if account_type is None:
            return 422, {
                "ok": False,
                "message": f"Unrecognized MT5 account trade_mode: {info.trade_mode}",
            }

        return 200, {
            "ok": True,
            "login": int(info.login),
            "account_type": account_type,
            "balance": float(info.balance),
            "equity": float(info.equity),
            "currency": getattr(info, "currency", None),
        }
    finally:
        mt5.shutdown()


# Option 2 Increment B — close-time reconciliation. Once a ticket
# disappears from positions_get (Increment E's real-mode monitor sees
# this as "the broker closed it"), positions_get alone can no longer
# tell us the final price/pnl — that lives in history_deals_get instead.
# Filters to the DEAL_ENTRY_OUT (closing) deal specifically; a position
# can have multiple deals (partial closes, the opening deal itself), and
# only the closing deal's price/profit is the answer this endpoint
# exists to give. If more than one closing deal exists (partial closes),
# the chronologically last one is treated as the final resolution.


def get_order_history(ticket_raw: str | None) -> tuple[int, dict]:
    if mt5 is None:
        return 500, {"ok": False, "message": "MetaTrader5 package is not installed."}
    try:
        ticket = int(ticket_raw)
    except (TypeError, ValueError):
        return 400, {"ok": False, "message": "ticket query param must be an integer"}

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
        deals = mt5.history_deals_get(position=ticket)
        if deals is None or len(deals) == 0:
            return 404, {"ok": False, "message": f"No historical deals found for ticket {ticket}"}

        closing_deals = [d for d in deals if d.entry == mt5.DEAL_ENTRY_OUT]
        if not closing_deals:
            return 404, {
                "ok": False,
                "message": f"No closing deal found for ticket {ticket} (position may still be open)",
            }
        deal = sorted(closing_deals, key=lambda d: d.time)[-1]

        return 200, {
            "ok": True,
            "ticket": ticket,
            "close_price": deal.price,
            "profit": deal.profit,
            "close_time": int(deal.time),
            "volume": deal.volume,
        }
    finally:
        mt5.shutdown()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        # Avoid logging request bodies (may contain broker passwords).
        print(f"[mt5-connector] {self.command} {self.path} -> {fmt % args}")

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send(200, {"status": "ok", "mt5_package": mt5 is not None})
            return
        if parsed.path == "/symbol-info":
            qs = parse_qs(parsed.query)
            symbol = (qs.get("symbol") or [None])[0]
            status, body = get_symbol_info(symbol)
            self._send(status, body)
            return
        if parsed.path == "/rates":
            qs = parse_qs(parsed.query)
            symbol = (qs.get("symbol") or [None])[0]
            timeframe = (qs.get("timeframe") or [None])[0]
            count = (qs.get("count") or [None])[0]
            status, body = get_rates(symbol, timeframe, count)
            self._send(status, body)
            return
        if parsed.path == "/positions":
            qs = parse_qs(parsed.query)
            symbol = (qs.get("symbol") or [None])[0]
            status, body = list_positions(symbol)
            self._send(status, body)
            return
        if parsed.path == "/account-info":
            status, body = get_account_info()
            self._send(status, body)
            return
        if parsed.path == "/order/history":
            qs = parse_qs(parsed.query)
            ticket = (qs.get("ticket") or [None])[0]
            status, body = get_order_history(ticket)
            self._send(status, body)
            return
        self._send(404, {"ok": False, "message": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/validate", "/order/place", "/order/close"):
            self._send(404, {"ok": False, "message": "Not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, {"ok": False, "message": "Invalid JSON"})
            return
        payload = payload if isinstance(payload, dict) else {}

        # Never log payload on /validate — contains broker password.
        try:
            if self.path == "/validate":
                status, body = validate(payload)
            elif self.path == "/order/place":
                status, body = place_order(payload)
            else:
                status, body = close_order(payload)
            self._send(status, body)
        except Exception as exc:  # pragma: no cover
            traceback.print_exc()
            self._send(
                500,
                {"ok": False, "message": f"Unexpected connector error: {exc.__class__.__name__}"},
            )


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[mt5-connector] listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
