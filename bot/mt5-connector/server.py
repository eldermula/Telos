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

        return 200, {
            "ok": True,
            "connection_status": "connected",
            "account_login": int(info.login),
            "server": getattr(info, "server", None),
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

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
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

    if not mt5.initialize():
        err = mt5.last_error()
        return 422, {"ok": False, "message": f"MT5 initialize failed: {err}"}

    try:
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
        if parsed.path == "/positions":
            qs = parse_qs(parsed.query)
            symbol = (qs.get("symbol") or [None])[0]
            status, body = list_positions(symbol)
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
