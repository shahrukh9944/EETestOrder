'use strict';
const express = require('express');
const config = require('../config/apiConfig');
const authService = require('../services/authService');
const logger = require('../utils/logger');
const { safeEqual, loginThrottle, requireLogin } = require('../middleware/authMiddleware');

const pages = express.Router();   // /login, /logout
const api = express.Router();     // /api/auth/*

// ---- Dashboard login (credentials from .env, no database) ----
pages.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  return res.render('login', { error: null });
});

pages.post('/login', (req, res, next) => {
  try {
    loginThrottle.check(req.ip);
  } catch (err) {
    return res.status(429).render('login', { error: err.message });
  }
  const { username = '', password = '' } = req.body || {};
  // Evaluate both comparisons so timing does not reveal which field was wrong
  const userOk = safeEqual(username, config.login.username);
  const passOk = safeEqual(password, config.login.password);
  if (!(userOk && passOk)) {
    loginThrottle.fail(req.ip);
    logger.warn(`Failed dashboard login from ${req.ip}`);
    return res.status(401).render('login', { error: 'Invalid username or password.' });
  }
  loginThrottle.reset(req.ip);
  // New session id on privilege change (prevents session fixation)
  return req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { name: config.login.username };
    return req.session.save((saveErr) => (saveErr ? next(saveErr) : res.redirect('/')));
  });
});

pages.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('om.sid');
    return res.redirect('/login');
  });
});

// ---- JWT status / replacement ----
api.get('/status', requireLogin('api'), (req, res) => {
  res.json({ ok: true, auth: authService.getStatus() });
});

api.post('/token', requireLogin('api'), async (req, res, next) => {
  try {
    const auth = await authService.updateToken((req.body || {}).token);
    res.json({ ok: true, message: 'Token updated. Order actions are enabled again.', auth });
  } catch (err) {
    next(err);
  }
});

module.exports = { pages, api };
