'use strict';

const { redis } = require('../db/redis');
const { clientIp } = require('../utils/client-ip');
const { AppError } = require('../utils/app-error');

/**
 * Phase 8 — general API rate limiting. `06_API_Specification.md`
 * Section 15 settles only the flat default (60/min GET, 10/min
 * state-changing); anything tighter than that for a specific
 * higher-blast-radius endpoint is this middleware's per-route
 * `{ max, windowSeconds }` override, not a new settled default.
 *
 * Same Redis `INCR` + `EXPIRE`-on-first-hit mechanism as the existing
 * `rate-limit-login.js` (left untouched — it's already correct and
 * IP-keyed for its one pre-auth route). This module generalizes the
 * same idea across every other route, both authenticated (keyed by
 * `req.user.id`) and the handful of pre-auth routes that need it
 * (keyed by IP, via `preAuth: true`).
 *
 * Applied as an explicit middleware argument on each route
 * (`router.get(path, rateLimit.read(), controller.fn)`), not as a
 * blanket router-level `.use()` — every route's actual threshold is
 * visible right at its declaration, and `req.route.path` (the route
 * *template*, e.g. `/risk-tiers/:tier`, not the resolved literal URL)
 * is only reliably populated once Express has matched that specific
 * route — which per-route middleware, unlike router-level `.use()`,
 * can depend on.
 */

const DEFAULT_READ_MAX = 60;
const DEFAULT_WRITE_MAX = 10;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_PREAUTH_MAX = 5;
const DEFAULT_PREAUTH_WINDOW_SECONDS = 15 * 60;

function bucketKey(req, identity) {
  // req.route.path is the matched route's template — keying on the
  // literal req.path/req.originalUrl instead would let a caller bypass
  // a limit on e.g. /admin/users/:id simply by varying the :id each
  // call, since every literal path would get its own fresh counter.
  const routeTemplate = req.route ? req.route.path : req.path;
  return `ratelimit:${identity}:${req.method}:${req.baseUrl}${routeTemplate}`;
}

function createRateLimiter({ max, windowSeconds, preAuth = false }) {
  return async function rateLimit(req, res, next) {
    try {
      const identity = preAuth ? clientIp(req) : req.user && req.user.id;
      if (!identity) {
        // Misconfiguration guard: an authenticated-mode limiter placed
        // before `authenticate` would have no req.user.id to key on.
        // Fail open rather than 500ing a real request over a wiring
        // bug — same posture as this module's other failure modes
        // below (a rate limiter should never be the reason a
        // legitimate request fails harder than the abuse it's meant
        // to stop).
        return next();
      }

      const key = bucketKey(req, identity);
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      if (count > max) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
      }
      next();
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      // Redis unavailable or some other infra hiccup — same
      // fail-open posture as above: never let the rate limiter itself
      // take the API down.
      console.error('[rate-limit] check failed, allowing request through:', err.message);
      next();
    }
  };
}

const rateLimit = {
  read(overrides = {}) {
    return createRateLimiter({
      max: overrides.max ?? DEFAULT_READ_MAX,
      windowSeconds: overrides.windowSeconds ?? DEFAULT_WINDOW_SECONDS,
    });
  },
  write(overrides = {}) {
    return createRateLimiter({
      max: overrides.max ?? DEFAULT_WRITE_MAX,
      windowSeconds: overrides.windowSeconds ?? DEFAULT_WINDOW_SECONDS,
    });
  },
  /**
   * IP-keyed, for the pre-auth routes that need tighter-than-general
   * protection (`09_Security.md` Section 7): signup and both
   * password-reset routes. Login keeps its own separate, untouched
   * `rateLimitLogin` — not migrated to this to avoid any behavior
   * drift on an already-verified path.
   */
  preAuth(overrides = {}) {
    return createRateLimiter({
      max: overrides.max ?? DEFAULT_PREAUTH_MAX,
      windowSeconds: overrides.windowSeconds ?? DEFAULT_PREAUTH_WINDOW_SECONDS,
      preAuth: true,
    });
  },
};

module.exports = { rateLimit };
