"""
Option 2 Increment B — proves place_order/close_order's account-type
mismatch check (Layer 0) returns *before* calling order_send or any
other MT5 call downstream of that check, rather than merely observing
"no position exists afterward" (which a rejected-by-broker order would
also produce, and is a different, weaker claim).

Method: import server.py's functions directly (no HTTP layer, no
BotRuntime) and monkeypatch every mt5.* call that place_order/
close_order's code only reaches *after* the account-type check
(symbol_select, symbol_info, symbol_info_tick, positions_get,
order_send) with a tripwire that raises immediately if called. Then
call place_order/close_order with a deliberately wrong
expected_account_type. If the mismatch check truly short-circuits as
written, none of the tripwires fire and the functions still return
their normal 422 mismatch response. If any tripwire fires, that proves
an order (or a downstream lookup) was actually attempted before the
check stopped it -- a materially different, worse failure mode this
test exists specifically to rule out.

mt5.initialize/account_info/shutdown/last_error are left real and
unpatched -- they're read-only and are exactly what the check itself
needs to run.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import server as connector  # noqa: E402  (path setup must come first)

mt5 = connector.mt5

if mt5 is None:
    print("ABORT (not a failure): MetaTrader5 package is not installed.")
    sys.exit(0)


class Tripwire(Exception):
    pass


def make_tripwire(name):
    def _tripped(*args, **kwargs):
        raise Tripwire(f"{name} was called — the account-type check did not short-circuit before this")

    return _tripped


# Ground truth: what's actually attached right now, established via the
# real (unpatched) account_info(), same call the check itself makes.
if not mt5.initialize():
    print(f"ABORT (not a failure): MT5 initialize failed: {mt5.last_error()}")
    sys.exit(0)
info = mt5.account_info()
mt5.shutdown()
if info is None:
    print("ABORT (not a failure): account_info unavailable.")
    sys.exit(0)

real_type = connector.ACCOUNT_TRADE_MODES.get(info.trade_mode)
if real_type is None:
    print(f"ABORT (not a failure): unrecognized trade_mode {info.trade_mode}")
    sys.exit(0)

wrong_type = next(t for t in ("demo", "contest", "real") if t != real_type)
print(f"Real account_type is '{real_type}'; testing rejection against deliberately wrong '{wrong_type}'.")

# Patch every mt5 call that lives strictly downstream of the account-type
# check in both place_order and close_order's source (verified by
# reading server.py directly before writing this test):
#   place_order: check -> symbol_select -> symbol_info -> symbol_info_tick -> order_send
#   close_order: check -> positions_get -> symbol_info_tick -> order_send
# Any one of these firing means control flow reached past the check.
originals = {
    "order_send": mt5.order_send,
    "symbol_select": mt5.symbol_select,
    "symbol_info": mt5.symbol_info,
    "symbol_info_tick": mt5.symbol_info_tick,
    "positions_get": mt5.positions_get,
}
for name in originals:
    setattr(mt5, name, make_tripwire(f"mt5.{name}"))

# Positive control, checked before the real assertions: prove the
# tripwire mechanism itself actually raises when called, so a silent
# dud patch can't be mistaken for "the code never reached it." Without
# this, a tripwire that failed to attach would produce the exact same
# (mis-)passing output as a correctly-short-circuited check.
try:
    mt5.order_send({})
    print("FAIL - tripwire control: mt5.order_send did not raise when called directly — patch is not effective")
    sys.exit(1)
except Tripwire:
    print("TRIPWIRE_CONTROL_CONFIRMED_MECHANISM_WORKS")

failures = []
try:
    status, body = connector.place_order(
        {
            "symbol": "EURUSD",
            "direction": "BUY",
            "volume": 0.01,
            "expected_account_type": wrong_type,
        }
    )
    if status != 422:
        failures.append(f"place_order: expected 422, got {status}: {body}")
    elif body.get("ok") is not False:
        failures.append(f"place_order: expected ok=False, got {body}")
    elif body.get("actual_account_type") != real_type or body.get("expected_account_type") != wrong_type:
        failures.append(f"place_order: mismatch details wrong: {body}")
    else:
        print("PLACE_ORDER_MISMATCH_RETURNED_422_WITH_NO_DOWNSTREAM_CALL")

    status2, body2 = connector.close_order(
        {
            "ticket": 999999999,
            "expected_account_type": wrong_type,
        }
    )
    if status2 != 422:
        failures.append(f"close_order: expected 422, got {status2}: {body2}")
    elif body2.get("ok") is not False:
        failures.append(f"close_order: expected ok=False, got {body2}")
    else:
        print("CLOSE_ORDER_MISMATCH_RETURNED_422_WITH_NO_DOWNSTREAM_CALL")

except Tripwire as tw:
    failures.append(f"TRIPWIRE FIRED: {tw}")
finally:
    for name, original in originals.items():
        setattr(mt5, name, original)

if failures:
    for f in failures:
        print(f"FAIL - {f}")
    sys.exit(1)

print("OPTION2_B_LAYER0_NO_DOWNSTREAM_CALLS_PASS")
