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
        if self.path == "/health":
            self._send(200, {"status": "ok", "mt5_package": mt5 is not None})
            return
        self._send(404, {"ok": False, "message": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/validate":
            self._send(404, {"ok": False, "message": "Not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, {"ok": False, "message": "Invalid JSON"})
            return

        # Never log payload — contains broker password.
        try:
            status, body = validate(payload if isinstance(payload, dict) else {})
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
