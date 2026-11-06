'use strict';
const { Errors } = require('./errors');

/**
 * Decodes a JWT's header/payload WITHOUT verifying the signature.
 * We do not hold the signing secret; the real validity check is the API's own response.
 */
function decodeJwt(raw) {
  if (typeof raw !== 'string') throw Errors.tokenInvalid('Please paste a JWT.');
  const token = raw.trim().replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p, i) => (i < 2 ? !p : false) || !/^[A-Za-z0-9_-]*$/.test(p))) {
    throw Errors.tokenInvalid('That does not look like a JWT (expected three dot-separated parts).');
  }
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw Errors.tokenInvalid('The JWT header or payload could not be decoded.');
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') {
    throw Errors.tokenInvalid('The JWT header or payload could not be decoded.');
  }
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp)) {
    throw Errors.tokenInvalid('The JWT has no "exp" (expiry) claim, so it cannot be accepted.');
  }
  return { token, header, payload, exp, expiresAt: new Date(exp * 1000) };
}

/** Safe-to-display form of a token, e.g. "eyJ0eX…GcqM". Never the full value. */
function maskToken(token) {
  if (!token || token.length < 16) return '';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

module.exports = { decodeJwt, maskToken };
