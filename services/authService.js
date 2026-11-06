'use strict';
/**
 * Holds the current EasyEcom JWT (server-side only) and answers "is it usable?".
 *
 * Expiry detection has two independent signals:
 *   1. the `exp` claim (decoded, NOT signature-verified) - lets us warn before calling the API
 *   2. the API's own 401 response - the authoritative answer, handled in easyecomClient
 */
const fs = require('fs');
const path = require('path');
const config = require('../config/apiConfig');
const logger = require('../utils/logger');
const { decodeJwt, maskToken } = require('../utils/jwt');
const { Errors } = require('../utils/errors');

const RUNTIME_FILE = path.join(config.rootDir, '.runtime', 'jwt.json');

const state = {
  token: null,
  exp: null, // seconds since epoch
  rejectedByApi: false,
};

function setToken(decoded) {
  state.token = decoded.token;
  state.exp = decoded.exp;
  state.rejectedByApi = false;
}

function init() {
  let initial = null;
  try {
    if (config.easyecom.initialJwt) initial = decodeJwt(config.easyecom.initialJwt);
  } catch (err) {
    logger.warn('Configured EE_JWT could not be decoded:', err.message);
  }
  if (initial) setToken(initial);

  // A token replaced from the dashboard (persisted) wins if it expires later than the .env one.
  if (config.easyecom.persistToken) {
    try {
      const saved = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
      const decoded = decodeJwt(saved.token);
      if (!initial || decoded.exp > initial.exp) {
        setToken(decoded);
        logger.info(`Loaded replacement JWT from .runtime (${maskToken(decoded.token)})`);
      }
    } catch {
      /* no persisted token - fine */
    }
  }
}

function persist() {
  if (!config.easyecom.persistToken) return;
  try {
    fs.mkdirSync(path.dirname(RUNTIME_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify({ token: state.token }), { mode: 0o600 });
  } catch (err) {
    logger.warn('Could not persist replacement JWT:', err.message);
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

function isExpired() {
  return state.exp !== null && state.exp <= nowSec();
}

/** Status object that is safe to send to the browser (never contains the token). */
function getStatus() {
  const base = { tokenHint: maskToken(state.token) };
  if (!state.token) {
    return { ...base, state: 'missing', authenticated: false, expiresAt: null, secondsRemaining: null,
      message: 'No JWT is configured. Please enter a token.' };
  }
  const secondsRemaining = state.exp - nowSec();
  const expiresAt = new Date(state.exp * 1000).toISOString();
  if (secondsRemaining <= 0) {
    return { ...base, state: 'expired', authenticated: false, expiresAt, secondsRemaining: 0,
      message: 'JWT Token Expired. Please Enter a New Token.' };
  }
  if (state.rejectedByApi) {
    return { ...base, state: 'rejected', authenticated: false, expiresAt, secondsRemaining,
      message: 'The API rejected the current JWT (HTTP 401). Please enter a new token.' };
  }
  return { ...base, state: 'valid', authenticated: true, expiresAt, secondsRemaining, message: 'Authenticated' };
}

/** Returns the raw token for an outgoing API call, or throws if it is known to be unusable. */
function getTokenForRequest() {
  if (!state.token) throw Errors.tokenInvalid('No JWT is configured. Please enter a token.');
  if (isExpired()) throw Errors.tokenExpired();
  if (state.rejectedByApi) throw Errors.tokenInvalid('The API rejected the current JWT. Please enter a new token.');
  return state.token;
}

function markRejectedByApi() {
  if (state.rejectedByApi) return;
  state.rejectedByApi = true;
  logger.warn(`API returned 401 for token ${maskToken(state.token)} - token marked unusable`);
}

/**
 * Validates and installs a replacement token:
 *   structure -> exp claim in the future -> real API probe (must be accepted) -> install.
 */
async function updateToken(raw) {
  const decoded = decodeJwt(raw); // throws TOKEN_INVALID on bad structure / missing exp
  if (decoded.exp <= nowSec() + 30) {
    throw Errors.tokenExpired('That token is already expired. Please paste a newer one.');
  }
  const client = require('./easyecomClient'); // lazy: avoids a circular require
  await client.verifyToken(decoded.token); // throws on 401/403/timeout/etc.

  setToken(decoded);
  persist();
  logger.info(`JWT replaced (${maskToken(decoded.token)}), expires ${new Date(decoded.exp * 1000).toISOString()}`);
  return getStatus();
}

init();

module.exports = { getStatus, getTokenForRequest, markRejectedByApi, isExpired, updateToken };
