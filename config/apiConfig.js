'use strict';
/**
 * Single place for ALL configuration and credentials.
 * Nothing in here is ever sent to the browser.
 */
const path = require('path');
const fs = require('fs');

// Built-in .env loader (Node >= 20.12) - no dotenv dependency. Real environment variables win.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const list = (value, fallback) =>
  value && value.trim() ? value.split(',').map((s) => s.trim()).filter(Boolean) : fallback;
const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const missing = ['SESSION_SECRET', 'LOGIN_USERNAME', 'LOGIN_PASSWORD', 'EE_API_KEY'].filter(
  (k) => !process.env[k]
);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')} (see .env.example)`);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  trustProxy: int(process.env.TRUST_PROXY, 0),
  rootDir: path.join(__dirname, '..'),

  session: {
    secret: process.env.SESSION_SECRET,
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    maxAgeMs: 8 * 60 * 60 * 1000,
  },

  login: {
    username: process.env.LOGIN_USERNAME,
    password: process.env.LOGIN_PASSWORD,
  },

  easyecom: {
    baseUrl: (process.env.EE_BASE_URL || 'https://api.easyecom.io').replace(/\/+$/, ''),
    initialJwt: (process.env.EE_JWT || '').trim(),
    apiKey: process.env.EE_API_KEY,
    timeoutMs: int(process.env.API_TIMEOUT_MS, 20000),
    persistToken: process.env.PERSIST_TOKEN !== 'false',
    // Endpoints exactly as used in the original source (server/app.js)
    paths: {
      createOrder: '/webhook/v2/createOrder',
      getAllOrders: '/orders/V2/getAllOrders',
      confirmOrder: '/orders/confirm_order',
      manifestGenerate: '/Manifest/Generate',
      markReturn: '/orders/markReturn',
      cancelOrder: '/orders/cancelOrder',
    },
  },

  business: {
    skus: list(process.env.SKU_LIST, ['S1-BL-S', 'S2-WH-S', 'S1-RD-M']),
    marketplaceIds: list(process.env.MARKETPLACE_IDS, ['114', '946', '894', '659', '537']).map(Number),
    carrierId: process.env.CARRIER_ID || '35249',
    // API docs label Manifest/Generate as "Shipped order". Set true to also run confirm_order first.
    confirmBeforeShip: process.env.CONFIRM_BEFORE_SHIP === 'true',
    maxOrdersPerRequest: int(process.env.MAX_ORDERS_PER_REQUEST, 20),
    returnLimitPerMarketplace: int(process.env.RETURN_LIMIT_PER_MARKETPLACE, 2),
    // Status ids used by the original getAllOrders calls
    statusIds: { toConfirm: 2, toManifest: 3, returned: 7 },
    // confirm_order package dimensions from the original source
    parcel: { height: '10', width: '3', length: '3', weight: '100' },
    // markReturn item fields from the original source
    returnItem: { qc_pass: 0, inventory_status: '13' },
  },
};

module.exports = Object.freeze(config);
