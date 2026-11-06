'use strict';
const express = require('express');
const orderService = require('../services/orderService');
const authService = require('../services/authService');
const { Errors } = require('../utils/errors');

const router = express.Router();

// Server-side guard against duplicate submissions (UI also disables the buttons)
const running = new Set();

const action = (name, handler) => async (req, res, next) => {
  if (running.has(name)) return next(Errors.busy(name));
  running.add(name);
  try {
    // Fail fast (without calling the API) when the JWT is already known to be unusable
    authService.getTokenForRequest();
    const result = await handler(req);
    res.json({ ok: true, message: result.summary, data: result, auth: authService.getStatus() });
  } catch (err) {
    next(err);
  } finally {
    running.delete(name);
  }
};

router.post('/create', action('Create Order', (req) => orderService.createOrders((req.body || {}).count)));
router.post('/ship', action('Shipped Order', () => orderService.shipOrders()));
router.post('/cancel', action('Cancel Order', (req) => orderService.cancelOrder((req.body || {}).reference_code)));
router.post('/return', action('Return Order', () => orderService.returnOrders()));

module.exports = router;
