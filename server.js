'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./config/apiConfig');
const authService = require('./services/authService');
const logger = require('./utils/logger');
const { requireLogin, csrf } = require('./middleware/authMiddleware');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { pages: authPages, api: authApi } = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers (no inline scripts/styles are used, so a strict CSP works)
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
});

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// NOTE: the default MemoryStore is fine for a single-process tool; use a real store for multi-instance deployments.
app.use(session({
  name: 'om.sid',
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: config.session.cookieSecure, maxAge: config.session.maxAgeMs },
}));
app.use(csrf);

// Pages
app.use(authPages);
app.get('/', requireLogin('page'), (req, res) => {
  res.render('dashboard', { user: req.session.user, auth: authService.getStatus(), skus: config.business.skus, maxOrders: config.business.maxOrdersPerRequest });
});

// JSON API (all guarded by login; CSRF applied above)
app.use('/api/auth', authApi);
app.use('/api/orders', requireLogin('api'), orderRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  logger.info(`Order Management Dashboard running at http://localhost:${config.port} (${config.env})`);
  const s = authService.getStatus();
  logger.info(`JWT status: ${s.state}${s.expiresAt ? `, expires ${s.expiresAt}` : ''} (${s.tokenHint || 'none'})`);
});
