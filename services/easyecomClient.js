'use strict';
/**
 * The only module that talks to EasyEcom. Adds the credentials, enforces a timeout and
 * translates every failure mode into an AppError (centralised HTTP error handling).
 */
const config = require('../config/apiConfig');
const logger = require('../utils/logger');
const authService = require('./authService');
const { Errors } = require('../utils/errors');

const { baseUrl, apiKey, timeoutMs, paths } = config.easyecom;

/**
 * @param {object} o
 * @param {'GET'|'POST'} o.method
 * @param {string} o.path
 * @param {object} [o.query]
 * @param {object} [o.body]
 * @param {boolean} [o.useApiKey=true]  API docs require x-api-key + Bearer on every call
 * @param {string} [o.token]            candidate token (token verification only)
 */
async function request({ method, path, query, body, useApiKey = true, token }) {
  const probing = Boolean(token);
  const bearer = token || authService.getTokenForRequest();

  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` };
  if (useApiKey) headers['x-api-key'] = apiKey;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    logger.error(`${method} ${url.pathname} failed:`, err);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw Errors.timeout();
    throw Errors.network(err);
  }

  const text = await res.text();
  let data = null;
  let parsed = true;
  if (text) {
    try { data = JSON.parse(text); } catch { parsed = false; }
  }
  const summary = { upstreamStatus: res.status, upstreamMessage: data && typeof data.message === 'string' ? data.message : undefined };
  logger.info(`${method} ${url.pathname}${url.search ? '?' + url.searchParams.toString() : ''} -> ${res.status}`);

  if (res.status === 401) {
    if (!probing) authService.markRejectedByApi();
    logger.warn('401 body:', text.slice(0, 300));
    throw !probing && authService.isExpired()
      ? Errors.tokenExpired()
      : Errors.tokenInvalid('The API did not accept this JWT (HTTP 401). Please enter a valid token.', summary);
  }
  if (res.status === 403) {
    logger.warn('403 body:', text.slice(0, 300));
    throw Errors.forbidden(summary);
  }
  if (res.status === 400 || res.status === 422) {
    logger.warn(`${res.status} body:`, text.slice(0, 500));
    throw Errors.invalidPayload(
      `The API rejected the request${summary.upstreamMessage ? `: ${summary.upstreamMessage}` : ' as invalid.'}`,
      summary
    );
  }
  if (res.status >= 500) {
    logger.error(`${res.status} body:`, text.slice(0, 500));
    throw Errors.upstream('The order API had a server error. Please try again shortly.', summary);
  }
  if (!res.ok) {
    logger.warn(`${res.status} body:`, text.slice(0, 500));
    throw Errors.upstream(`The order API responded with HTTP ${res.status}.`, summary);
  }
  if (!parsed || data === null || typeof data !== 'object') {
    logger.error('Non-JSON / empty 2xx body:', text.slice(0, 300));
    throw Errors.unexpected('The order API returned a response that is not valid JSON.', summary);
  }
  return { status: res.status, data };
}

/** Read-only call (same GET the source uses to list orders) to confirm the API accepts a token. */
async function verifyToken(token) {
  await request({
    method: 'GET',
    path: paths.getAllOrders,
    query: { status_id: config.business.statusIds.toConfirm, marketplaceId: config.business.marketplaceIds[0] },
    token,
  });
}

module.exports = {
  request,
  verifyToken,
  createOrder: (payload) => request({ method: 'POST', path: paths.createOrder, body: payload }),
  cancelOrder: (body) => request({ method: 'POST', path: paths.cancelOrder, body }),
  getAllOrders: (query) => request({ method: 'GET', path: paths.getAllOrders, query }),
  confirmOrder: (body) => request({ method: 'POST', path: paths.confirmOrder, body }),
  generateManifest: (body) => request({ method: 'POST', path: paths.manifestGenerate, body }),
  markReturn: (body) => request({ method: 'POST', path: paths.markReturn, body }),
};
