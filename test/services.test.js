'use strict';
/**
 * Exercises the service layer against a local mock of the EasyEcom API
 * (no framework dependencies, no network, no real credentials).   Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const makeJwt = (expOffsetSec, extra = {}) =>
  `${b64({ typ: 'JWT', alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + expOffsetSec, ...extra })}.c2ln`;

const GOOD = makeJwt(3600, { jti: 'good' });
const NEW_GOOD = makeJwt(7200, { jti: 'new' });
const API_KEY = 'test-api-key-123';

const calls = [];
let mode = 'normal'; // 'normal' | 'forbidden' | 'hang' | 'html'
const accepted = new Set([GOOD, NEW_GOOD]);

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const body = raw ? JSON.parse(raw) : undefined;
    const bearer = (req.headers.authorization || '').replace('Bearer ', '');
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: req.headers });
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (mode === 'hang') return; // never answer -> client timeout
    if (mode === 'html') { res.writeHead(200); return res.end('<html>oops</html>'); }
    if (!accepted.has(bearer)) return send(401, { message: 'Unauthenticated' });
    if (mode === 'forbidden') return send(403, { message: 'No permission' });

    if (url.pathname === '/webhook/v2/createOrder') return send(200, { code: 200, data: { Status: 200, InvoiceID: `INV-${body.orderNumber}` } });
    if (url.pathname === '/orders/V2/getAllOrders') {
      const { status_id, marketplaceId } = Object.fromEntries(url.searchParams);
      if (marketplaceId !== '114') return send(200, { message: 'Successful', data: { orders: [] } });
      if (status_id === '2') return send(200, { message: 'Successful', data: { orders: [{ invoice_id: 'I1' }, { invoice_id: 'I2' }] } });
      if (status_id === '3') return send(200, { message: 'Successful', data: { orders: [{ awb_number: 'AWB1' }, { awb_number: null }] } });
      if (status_id === '7') return send(200, { message: 'Successful', data: { orders: [
        { invoice_id: 'R1', suborders: [{ sku: 'S1-BL-S', sub_product_count: 2 }, { sku: 'S2-WH-S', sub_product_count: 1 }] },
        { invoice_id: 'R2', suborders: [{ sku: 'S1-RD-M', sub_product_count: 1 }] },
      ] } });
    }
    if (url.pathname === '/orders/confirm_order') return send(200, { code: 200, message: 'confirmed' });
    if (url.pathname === '/Manifest/Generate') return send(200, { code: 200, message: 'manifest ok' });
    if (url.pathname === '/orders/cancelOrder') return body.reference_code === 'MISSING' ? send(200, { code: 400, message: 'Order not found' }) : send(200, { code: 200, message: 'cancelled' });
    if (url.pathname === '/orders/markReturn') return send(200, { code: 200, message: 'returned' });
    return send(404, { message: 'nope' });
  });
});

let authService, orderService, jwtUtil, logger;

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    EE_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    EE_JWT: GOOD, EE_API_KEY: API_KEY, API_TIMEOUT_MS: '400', PERSIST_TOKEN: 'false',
    SESSION_SECRET: 'x', LOGIN_USERNAME: 'u', LOGIN_PASSWORD: 'p',
  });
  authService = require('../services/authService');
  orderService = require('../services/orderService');
  jwtUtil = require('../utils/jwt');
  logger = require('../utils/logger');
});
test.after(() => server.close());
test.beforeEach(() => { calls.length = 0; mode = 'normal'; });

test('jwt: decodes exp, rejects bad structure and missing exp', () => {
  const d = jwtUtil.decodeJwt(GOOD);
  assert.ok(d.exp > Date.now() / 1000);
  assert.throws(() => jwtUtil.decodeJwt('abc'), { code: 'TOKEN_INVALID' });
  assert.throws(() => jwtUtil.decodeJwt(`${b64({})}.${b64({ a: 1 })}.x`), { code: 'TOKEN_INVALID' });
  assert.equal(jwtUtil.decodeJwt(`Bearer ${GOOD}`).token, GOOD);
  assert.ok(!jwtUtil.maskToken(GOOD).includes(GOOD.slice(8, -8)));
});

test('logger redacts JWTs and the API key', () => {
  const out = logger.redact(`token ${GOOD} key ${API_KEY}`);
  assert.ok(!out.includes(GOOD) && !out.includes(API_KEY));
});

test('auth status is Authenticated for a valid token and never contains the token', () => {
  const s = authService.getStatus();
  assert.equal(s.state, 'valid');
  assert.equal(s.authenticated, true);
  assert.equal(s.message, 'Authenticated');
  assert.ok(!JSON.stringify(s).includes(GOOD));
});

test('create: sends original payload shape, allowed SKUs only, Bearer + x-api-key', async () => {
  const r = await orderService.createOrders(3);
  assert.equal(r.created, 3);
  assert.equal(r.outcome, 'success');
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.path, '/webhook/v2/createOrder');
    assert.equal(c.headers.authorization, `Bearer ${GOOD}`);
    assert.equal(c.headers['x-api-key'], API_KEY); // API docs: x-api-key + Bearer on every call
    assert.ok(['S1-BL-S', 'S2-WH-S', 'S1-RD-M'].includes(c.body.items[0].Sku));
    assert.ok([114, 946, 894, 659, 537].includes(c.body.marketplaceId));
    assert.match(c.body.orderNumber, /^[A-Z]{2}\d{8}\d{2}$/);
    assert.equal(c.body.items[0].OrderItemId, c.body.orderNumber);
    assert.equal(c.body.orderType, 'retailorder');
    assert.equal(c.body.customer[0].shipping.latitude, '12.900222');
  }
});

test('create: rejects invalid counts and invalid SKUs', async () => {
  await assert.rejects(orderService.createOrders(0), { code: 'INVALID_PAYLOAD' });
  await assert.rejects(orderService.createOrders(999), { code: 'INVALID_PAYLOAD' });
  await assert.rejects(orderService.createOrders('abc'), { code: 'INVALID_PAYLOAD' });
  const good = { orderType: 'r', marketplaceId: 1, orderNumber: 'A', orderDate: 'd', expDeliveryDate: 'd',
    items: [{ Sku: 'NIKE55', Quantity: '1' }], customer: [{ billing: {}, shipping: {} }] };
  assert.throws(() => orderService.validateOrderPayload(good), { code: 'INVALID_SKU' });
  assert.equal(calls.length, 0);
});

test('ship (= Manifest/Generate per docs): status 3 only, original payload, x-api-key', async () => {
  const r = await orderService.shipOrders();
  assert.equal(r.outcome, 'success');
  assert.equal(calls.filter((c) => c.path === '/orders/confirm_order').length, 0);
  assert.ok(calls.every((c) => c.query.status_id === undefined || c.query.status_id === '3'));
  const manifests = calls.filter((c) => c.path === '/Manifest/Generate');
  assert.deepEqual(manifests.map((c) => c.body), [{ carrier_id: '35249', marketplace_id: 114, awb_numbers: ['AWB1'] }]);
  assert.ok(calls.every((c) => c.headers['x-api-key'] === API_KEY));
});

test('return: status 7, first 2 per marketplace, original markReturn payload', async () => {
  const r = await orderService.returnOrders();
  assert.equal(r.outcome, 'success');
  const list = calls.find((c) => c.path === '/orders/V2/getAllOrders');
  assert.equal(list.query.status_id, '7');
  assert.ok(list.query.start_date && list.query.end_date);
  const marks = calls.filter((c) => c.path === '/orders/markReturn');
  assert.equal(marks.length, 2); // 3 candidates, limit 2
  assert.deepEqual(marks[0].body.items, [{ sku: 'S1-BL-S', quantity: 2, qc_pass: 0, inventory_status: '13' }]);
  assert.equal(marks[0].body.invoice_id, 'R1');
  assert.ok(!Number.isNaN(Date.parse(marks[0].body.return_date)));
});

test('cancel: POST /orders/cancelOrder {reference_code}; defaults to latest created order', async () => {
  const created = await orderService.createOrders(1);
  calls.length = 0;
  let r = await orderService.cancelOrder('');
  assert.equal(r.reference_code, created.results[0].orderNumber);
  assert.equal(r.outcome, 'success');
  assert.deepEqual(calls[0].body, { reference_code: created.results[0].orderNumber });
  assert.equal(calls[0].headers['x-api-key'], API_KEY);
  assert.equal(calls[0].headers.authorization, `Bearer ${GOOD}`);
  r = await orderService.cancelOrder('MISSING'); // API envelope code != 200
  assert.equal(r.outcome, 'failed');
  await assert.rejects(orderService.cancelOrder('bad code;'), { code: 'INVALID_PAYLOAD' });
});

test('403 is a permission error and does NOT invalidate the token', async () => {
  mode = 'forbidden';
  await assert.rejects(orderService.createOrders(1), { code: 'FORBIDDEN' });
  assert.equal(authService.getStatus().state, 'valid');
});

test('timeout and non-JSON responses map to friendly errors', async () => {
  mode = 'hang';
  let r = await orderService.createOrders(1); // per-item errors are recorded, not thrown
  assert.equal(r.outcome, 'failed');
  assert.equal(r.results[0].error.code, 'TIMEOUT');
  mode = 'html';
  r = await orderService.createOrders(1);
  assert.equal(r.outcome, 'failed');
  assert.equal(r.results[0].error.code, 'UNEXPECTED_RESPONSE');
});

test('API 401 locks actions; replacement token is verified against the API then re-enables', async () => {
  accepted.delete(GOOD); // server now revokes the current token
  await assert.rejects(orderService.createOrders(1), { code: 'TOKEN_INVALID' });
  let s = authService.getStatus();
  assert.equal(s.state, 'rejected');
  assert.equal(s.authenticated, false);
  // further actions are blocked locally without hitting the API
  calls.length = 0;
  await assert.rejects(orderService.createOrders(1), { code: 'TOKEN_INVALID' });
  assert.equal(calls.length, 0);

  // bad candidates
  await assert.rejects(authService.updateToken('garbage'), { code: 'TOKEN_INVALID' });
  await assert.rejects(authService.updateToken(makeJwt(-60)), { code: 'TOKEN_EXPIRED' });
  await assert.rejects(authService.updateToken(makeJwt(3600, { jti: 'unknown' })), { code: 'TOKEN_INVALID' }); // API says 401
  assert.equal(authService.getStatus().state, 'rejected'); // still locked

  // good candidate
  s = await authService.updateToken(NEW_GOOD);
  assert.equal(s.state, 'valid');
  const r = await orderService.createOrders(1);
  assert.equal(r.created, 1);
  assert.equal(calls.at(-1).headers.authorization, `Bearer ${NEW_GOOD}`);
});
