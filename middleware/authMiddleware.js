'use strict';
const crypto = require('crypto');
const { Errors } = require('../utils/errors');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
/** Constant-time string comparison (hashing equalises lengths). */
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

/** Page guard: redirect to /login. API guard: JSON 401. */
const requireLogin = (kind = 'page') => (req, res, next) => {
  if (req.session && req.session.user) return next();
  if (kind === 'api') return next(Errors.loginRequired());
  return res.redirect('/login');
};

/** Session-bound CSRF token, required on every non-GET request (header or form field). */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf) || '';
  if (!sent || !safeEqual(sent, req.session.csrf)) return next(Errors.csrf());
  return next();
}

/** Minimal in-memory login throttle: 5 failures / 15 min / IP. */
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const loginThrottle = {
  check(ip) {
    const rec = attempts.get(ip);
    if (rec && Date.now() - rec.first < WINDOW_MS && rec.count >= MAX_FAILS) throw Errors.rateLimited();
  },
  fail(ip) {
    const rec = attempts.get(ip);
    if (!rec || Date.now() - rec.first >= WINDOW_MS) attempts.set(ip, { first: Date.now(), count: 1 });
    else rec.count++;
  },
  reset(ip) { attempts.delete(ip); },
};

module.exports = { requireLogin, csrf, safeEqual, loginThrottle };
