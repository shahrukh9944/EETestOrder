'use strict';
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/** Centralised error -> response translation. Technical detail is logged, never shown. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const isBodyError = err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large');
  const appErr = err instanceof AppError
    ? err
    : isBodyError
      ? new AppError('INVALID_PAYLOAD', 'The request body is invalid.', { status: 400 })
      : new AppError('INTERNAL', 'Something went wrong on the server. Please try again.', { status: 500 });

  if (appErr.code === 'INTERNAL') logger.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  else logger.warn(`${req.method} ${req.path} -> ${appErr.status} ${appErr.code}: ${appErr.message}`);

  const wantsJson = req.path.startsWith('/api/') || req.is('application/json');
  if (wantsJson) {
    return res.status(appErr.status).json({
      ok: false,
      code: appErr.code,
      message: appErr.message,
      details: appErr.details, // small, pre-sanitised objects only (upstream status / missing-info list)
    });
  }
  return res.status(appErr.status).type('text/plain').send(appErr.message);
}

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Not found.' });
  return res.status(404).type('text/plain').send('Not found');
}

module.exports = { errorHandler, notFound };
