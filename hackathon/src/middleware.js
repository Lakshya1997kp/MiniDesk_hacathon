const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { uniformError } = require('./utils');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function errorHandler(err, _req, res, _next) {
  // eslint-disable-next-line no-console
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' } });
}

function authOptional(req, _res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
    } catch (_) {
      // ignore invalid
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return uniformError(res, 401, 'UNAUTHORIZED', 'Authorization required');
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return uniformError(res, 401, 'UNAUTHORIZED', 'Authorization required');
    if (!roles.includes(req.user.role)) return uniformError(res, 403, 'FORBIDDEN', 'Insufficient role');
    next();
  };
}

// Simple per-user rate limiter: 60 requests/min/user or IP if unauthenticated
const bucket = new Map();
function rateLimitPerUser(req, res, next) {
  const now = Date.now();
  const key = req.user ? `u:${req.user.id}` : `ip:${req.ip}`;
  const windowMs = 60 * 1000;
  const entry = bucket.get(key) || { start: now, count: 0 };
  if (now - entry.start > windowMs) {
    entry.start = now;
    entry.count = 0;
  }
  entry.count += 1;
  bucket.set(key, entry);
  if (entry.count > 60) {
    return res.status(429).json({ error: { code: 'RATE_LIMIT' } });
  }
  next();
}

function ensureIdempotency(req, res, next) {
  if (req.method !== 'POST') return next();
  const key = req.headers['idempotency-key'];
  if (!key) return uniformError(res, 400, 'FIELD_REQUIRED', 'Idempotency key required', 'Idempotency-Key');
  const db = req.app.get('db');
  const method = req.method;
  const path = req.path;
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');

  const existing = db.prepare('SELECT status_code, response_json FROM idempotency_keys WHERE key = ? AND method = ? AND path = ? AND body_hash = ?').get(key, method, path, bodyHash);
  if (existing) {
    res.status(existing.status_code).set('X-Idempotent-Replay', 'true');
    return res.send(existing.response_json);
  }

  // Monkey-patch res.json to store response
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    try {
      db.prepare('INSERT INTO idempotency_keys (key, user_id, method, path, body_hash, status_code, response_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(key, req.user ? req.user.id : null, method, path, bodyHash, res.statusCode || 200, JSON.stringify(data));
    } catch (_) {
      // ignore insert race
    }
    return originalJson(data);
  };
  next();
}

module.exports = { errorHandler, authOptional, requireAuth, requireRole, rateLimitPerUser, ensureIdempotency, JWT_SECRET };

