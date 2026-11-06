'use strict';

/**
 * Application error with a stable machine code, an HTTP status for our own API,
 * and a user-friendly message. Technical detail goes in `details` / `cause`
 * and is only ever logged server-side (plus a tiny safe subset sent to the UI).
 */
class AppError extends Error {
  constructor(code, message, { status = 500, details, cause } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.cause = cause;
  }
}

const Errors = {
  loginRequired: () => new AppError('LOGIN_REQUIRED', 'Please sign in to continue.', { status: 401 }),
  csrf: () => new AppError('CSRF', 'Your session could not be verified. Reload the page and try again.', { status: 403 }),
  tokenExpired: (message = 'JWT Token Expired. Please Enter a New Token.') =>
    new AppError('TOKEN_EXPIRED', message, { status: 401 }),
  tokenInvalid: (message = 'The JWT is invalid or was rejected by the API. Please enter a new token.', details) =>
    new AppError('TOKEN_INVALID', message, { status: 401, details }),
  forbidden: (details) =>
    new AppError('FORBIDDEN', 'The API denied this request: your account lacks permission for this action (HTTP 403). This is not a token-expiry problem.', { status: 403, details }),
  invalidSku: (sku) =>
    new AppError('INVALID_SKU', `Invalid SKU "${sku}". Allowed SKUs are configured on the server.`, { status: 400 }),
  invalidPayload: (message, details) =>
    new AppError('INVALID_PAYLOAD', message || 'The request payload is invalid.', { status: 400, details }),
  upstream: (message, details, cause) =>
    new AppError('UPSTREAM_ERROR', message || 'The order API returned an error. Please try again shortly.', { status: 502, details, cause }),
  timeout: () =>
    new AppError('TIMEOUT', 'The order API did not respond in time. Please try again.', { status: 504 }),
  network: (cause) =>
    new AppError('NETWORK_ERROR', 'Could not reach the order API. Check connectivity and try again.', { status: 502, cause }),
  unexpected: (message, details) =>
    new AppError('UNEXPECTED_RESPONSE', message || 'The order API returned a response in an unexpected format.', { status: 502, details }),
  notImplemented: (message, details) =>
    new AppError('NOT_IMPLEMENTED', message, { status: 501, details }),
  busy: (action) =>
    new AppError('BUSY', `"${action}" is already running. Please wait for it to finish.`, { status: 409 }),
  rateLimited: () =>
    new AppError('RATE_LIMITED', 'Too many attempts. Please try again later.', { status: 429 }),
};

/** Errors that mean "stop the whole operation" (every further call would fail the same way). */
const AUTH_FATAL = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID', 'FORBIDDEN']);
const isAuthFatal = (err) => err instanceof AppError && AUTH_FATAL.has(err.code);

module.exports = { AppError, Errors, isAuthFatal };
