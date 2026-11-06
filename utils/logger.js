'use strict';
/**
 * Tiny logger that redacts secrets. JWTs and the API key can never reach the logs,
 * even if they appear inside an error message or upstream response.
 */
const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

function redact(value) {
  let text;
  if (typeof value === 'string') text = value;
  else if (value instanceof Error) text = `${value.name}: ${value.message}${value.cause ? ` (cause: ${value.cause.message || value.cause})` : ''}`;
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  text = text.replace(JWT_RE, '[JWT-REDACTED]');
  const apiKey = process.env.EE_API_KEY;
  if (apiKey) text = text.split(apiKey).join('[API-KEY-REDACTED]');
  return text;
}

const line = (level, args) =>
  `${new Date().toISOString()} ${level.padEnd(5)} ${args.map(redact).join(' ')}`;

module.exports = {
  redact,
  info: (...a) => console.log(line('INFO', a)),
  warn: (...a) => console.warn(line('WARN', a)),
  error: (...a) => console.error(line('ERROR', a)),
};
