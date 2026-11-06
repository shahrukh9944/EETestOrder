'use strict';
/**
 * Business logic for the four dashboard actions. Ported from the original server/app.js
 * (createOrder, manifest/shipped, cancelOrder, return). Cancel comes from the EasyEcom API docs.
 *
 * Error policy: an auth/permission error aborts the whole action (every further call would fail
 * identically); any other per-item error is recorded and the loop continues - the same
 * "continue with next order even if one fails" behaviour as the original.
 */
const config = require('../config/apiConfig');
const logger = require('../utils/logger');
const client = require('./easyecomClient');
const { buildOrderPayload, formatDateTime } = require('./dataGenerator');
const { Errors, AppError, isAuthFatal } = require('../utils/errors');

const { skus, marketplaceIds, statusIds, parcel, returnItem } = config.business;

let totalInvoicesCreated = 0; // original `invoiceCount`
const createdOrders = []; // order numbers created this run (default target for Cancel)
const allowedSkus = new Set(skus);

const describe = (err) => ({
  code: err instanceof AppError ? err.code : 'UNKNOWN',
  message: err instanceof AppError ? err.message : 'Unexpected error',
  ...(err.details || {}),
});

function outcome(ok, failed) {
  if (ok === 0 && failed === 0) return 'nothing';
  if (failed === 0) return 'success';
  return ok === 0 ? 'failed' : 'partial';
}

/** Validates a createOrder payload before it is sent (invalid SKU / invalid payload errors). */
function validateOrderPayload(p) {
  if (!p || typeof p !== 'object') throw Errors.invalidPayload('Order payload is missing.');
  for (const key of ['orderType', 'marketplaceId', 'orderNumber', 'orderDate', 'expDeliveryDate']) {
    if (p[key] === undefined || p[key] === null || p[key] === '') throw Errors.invalidPayload(`Order payload is missing "${key}".`);
  }
  if (!Array.isArray(p.items) || p.items.length === 0) throw Errors.invalidPayload('Order payload has no items.');
  for (const item of p.items) {
    if (!allowedSkus.has(item.Sku)) throw Errors.invalidSku(item.Sku);
    if (!(Number(item.Quantity) > 0)) throw Errors.invalidPayload(`Invalid quantity for SKU ${item.Sku}.`);
  }
  if (!Array.isArray(p.customer) || !p.customer[0]?.billing || !p.customer[0]?.shipping) {
    throw Errors.invalidPayload('Order payload needs billing and shipping details.');
  }
}

/** Reads `data.data.orders` as the original did; anything else is an unexpected response. */
function extractOrders(response) {
  const orders = response.data?.data?.orders;
  if (!Array.isArray(orders)) {
    throw Errors.unexpected('The order list response did not contain data.orders.', { upstreamMessage: response.data?.message });
  }
  return orders;
}

// ---------------------------------------------------------------- 1. CREATE
async function createOrders(rawCount) {
  const count = rawCount === undefined || rawCount === '' ? 1 : Number(rawCount);
  const max = config.business.maxOrdersPerRequest;
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw Errors.invalidPayload(`Number of orders must be a whole number between 1 and ${max}.`);
  }

  const results = [];
  let created = 0;
  for (let i = 0; i < count; i++) {
    const payload = buildOrderPayload();
    validateOrderPayload(payload);
    try {
      const { data } = await client.createOrder(payload);
      // Same success rule as the original: Status 200 + an InvoiceID (top level or under .data)
      const invoiceId = data?.InvoiceID ?? data?.data?.InvoiceID ?? null;
      const status = data?.Status ?? data?.data?.Status ?? null;
      if (status === 200 && invoiceId) {
        created++;
        totalInvoicesCreated++;
        createdOrders.push({ orderNumber: payload.orderNumber, cancelled: false });
        results.push({ orderNumber: payload.orderNumber, sku: payload.items[0].Sku, ok: true, invoiceId });
      } else {
        logger.warn('createOrder: InvoiceID missing or status not 200');
        results.push({ orderNumber: payload.orderNumber, sku: payload.items[0].Sku, ok: false,
          error: { code: 'UNEXPECTED_RESPONSE', message: 'InvoiceID missing or status not 200.', apiMessage: data?.message } });
      }
    } catch (err) {
      if (isAuthFatal(err)) throw err;
      logger.error(`createOrder ${payload.orderNumber} failed:`, err);
      results.push({ orderNumber: payload.orderNumber, sku: payload.items[0].Sku, ok: false, error: describe(err) });
    }
  }
  const failed = count - created;
  return {
    action: 'create', outcome: outcome(created, failed),
    summary: `${created} of ${count} order(s) created.${failed ? ` ${failed} failed.` : ''}`,
    requested: count, created, failed, totalInvoicesSoFar: totalInvoicesCreated, results,
  };
}

// ---------------------------------------------------------------- 2. SHIPPED
/**
 * "Shipped Order" = Manifest/Generate (that is how the API docs label it):
 *   every order with status_id=3 -> POST Manifest/Generate (per AWB)
 * Optional (CONFIRM_BEFORE_SHIP=true): first confirm every status_id=2 order via confirm_order.
 */
async function shipOrders() {
  const confirm = [];
  const manifest = [];
  const errors = [];

  for (const mkt of config.business.confirmBeforeShip ? marketplaceIds : []) {
    try {
      const orders = extractOrders(await client.getAllOrders({ status_id: statusIds.toConfirm, marketplaceId: mkt }));
      for (const invoice_id of orders.map((o) => o.invoice_id)) {
        try {
          const { data } = await client.confirmOrder({ ...parcel, invoice_id });
          confirm.push({ marketplaceId: mkt, invoice_id, ok: true, response: data });
        } catch (err) {
          if (isAuthFatal(err)) throw err;
          logger.error(`confirm_order ${invoice_id} failed:`, err);
          confirm.push({ marketplaceId: mkt, invoice_id, ok: false, error: describe(err) });
        }
      }
    } catch (err) {
      if (isAuthFatal(err)) throw err;
      logger.error(`confirm: listing marketplace ${mkt} failed:`, err);
      errors.push({ step: 'confirm', marketplaceId: mkt, ...describe(err) });
    }
  }

  for (const mkt of marketplaceIds) {
    try {
      const orders = extractOrders(await client.getAllOrders({ status_id: statusIds.toManifest, marketplaceId: mkt }));
      for (const awb_number of orders.map((o) => o.awb_number).filter(Boolean)) {
        try {
          const { data } = await client.generateManifest({
            carrier_id: config.business.carrierId, marketplace_id: mkt, awb_numbers: [awb_number],
          });
          manifest.push({ marketplaceId: mkt, awb_number, ok: true, response: data });
        } catch (err) {
          if (isAuthFatal(err)) throw err;
          logger.error(`Manifest/Generate ${awb_number} failed:`, err);
          manifest.push({ marketplaceId: mkt, awb_number, ok: false, error: describe(err) });
        }
      }
    } catch (err) {
      if (isAuthFatal(err)) throw err;
      logger.error(`manifest: listing marketplace ${mkt} failed:`, err);
      errors.push({ step: 'manifest', marketplaceId: mkt, ...describe(err) });
    }
  }

  const okCount = confirm.filter((r) => r.ok).length + manifest.filter((r) => r.ok).length;
  const failCount = confirm.filter((r) => !r.ok).length + manifest.filter((r) => !r.ok).length + errors.length;
  return {
    action: 'ship', outcome: outcome(okCount, failCount),
    summary: okCount + failCount === 0
      ? 'No orders were waiting to be manifested.'
      : `Manifested ${manifest.filter((r) => r.ok).length}${config.business.confirmBeforeShip ? `, confirmed ${confirm.filter((r) => r.ok).length}` : ''}; ${failCount} failure(s).`,
    confirmed: confirm, manifested: manifest, errors,
  };
}

// ---------------------------------------------------------------- 3. CANCEL
/**
 * POST /orders/cancelOrder  body: { "reference_code": "<order number>" }  (per the API docs).
 * reference_code is the order number. If none is given, the most recent order created
 * by this dashboard that has not been cancelled yet is used.
 */
async function cancelOrder(rawReference) {
  let reference = typeof rawReference === 'string' ? rawReference.trim() : '';
  if (!reference) {
    const latest = [...createdOrders].reverse().find((o) => !o.cancelled);
    if (!latest) throw Errors.invalidPayload('Enter the order number (reference code) to cancel.');
    reference = latest.orderNumber;
  }
  if (!/^[A-Za-z0-9_\-./]{1,64}$/.test(reference)) {
    throw Errors.invalidPayload('Order number may only contain letters, digits and _ - . / (max 64 characters).');
  }

  const { data } = await client.cancelOrder({ reference_code: reference });
  const ok = data.code === undefined || data.code === 200; // docs show { code, message, data } envelopes
  const tracked = createdOrders.find((o) => o.orderNumber === reference);
  if (ok && tracked) tracked.cancelled = true;
  return {
    action: 'cancel', outcome: ok ? 'success' : 'failed',
    summary: ok ? `Cancel request accepted for order ${reference}.` : `Cancel request for ${reference} was not accepted${data.message ? `: ${data.message}` : '.'}`,
    reference_code: reference, response: data,
  };
}

// ---------------------------------------------------------------- 4. RETURN
async function returnOrders() {
  const now = new Date();
  const start = new Date(now); start.setDate(now.getDate() - 4);
  const end = new Date(now); end.setDate(now.getDate() - 3);

  const returns = [];
  const errors = [];

  for (const mkt of marketplaceIds) {
    try {
      // NOTE: the original built this URL with a stray "?" ("&?end_date=") and raw Date.toString()
      // values, so the date filters were malformed. Parameter names/window are kept; format is fixed.
      const orders = extractOrders(await client.getAllOrders({
        status_id: statusIds.returned, marketplaceId: mkt,
        end_date: formatDateTime(end), start_date: formatDateTime(start),
      }));

      const candidates = [];
      for (const order of orders) {
        for (const sub of order.suborders || []) {
          candidates.push({ invoice_id: order.invoice_id, sku: sub.sku, sub_product_count: sub.sub_product_count });
        }
      }

      // Original behaviour: only the first N (default 2) returns per marketplace
      for (const r of candidates.slice(0, config.business.returnLimitPerMarketplace)) {
        try {
          const { data } = await client.markReturn({
            invoice_id: r.invoice_id,
            return_date: now.toISOString(), // original serialised a Date -> ISO string
            items: [{ sku: r.sku, quantity: r.sub_product_count, ...returnItem }],
          });
          returns.push({ marketplaceId: mkt, invoice_id: r.invoice_id, sku: r.sku, ok: true, response: data });
        } catch (err) {
          if (isAuthFatal(err)) throw err;
          logger.error(`markReturn ${r.invoice_id} failed:`, err);
          returns.push({ marketplaceId: mkt, invoice_id: r.invoice_id, sku: r.sku, ok: false, error: describe(err) });
        }
      }
    } catch (err) {
      if (isAuthFatal(err)) throw err;
      logger.error(`return: marketplace ${mkt} failed:`, err);
      errors.push({ marketplaceId: mkt, ...describe(err) });
    }
  }

  const ok = returns.filter((r) => r.ok).length;
  const failed = returns.length - ok + errors.length;
  return {
    action: 'return', outcome: outcome(ok, failed),
    summary: ok + failed === 0 ? 'No returned orders found in the date window.' : `${ok} return(s) marked; ${failed} failure(s).`,
    returns, errors,
  };
}

module.exports = { createOrders, shipOrders, cancelOrder, returnOrders, validateOrderPayload };
