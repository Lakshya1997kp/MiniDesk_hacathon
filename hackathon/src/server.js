const express = require('express');
const cors = require('cors');
const { json } = require('express');
const { initDb } = require('./db');
const { errorHandler, rateLimitPerUser, authOptional, requireAuth, requireRole, ensureIdempotency } = require('./middleware');
const authRoutes = require('./routes/auth');
const ticketsRoutes = require('./routes/tickets');
const commentsRoutes = require('./routes/comments');

const app = express();
app.use(cors()); // CORS open
app.use(json());
app.use(express.static('public'));

// Initialize DB
const db = initDb();
app.set('db', db);

// Rate limit all requests per user (or IP if unauthenticated)
app.use(rateLimitPerUser);

// Auth parsing (optional)
app.use(authOptional);

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Idempotency for all POST endpoints under /api
app.use('/api', ensureIdempotency);

// Routes
app.use('/api', authRoutes);
app.use('/api', ticketsRoutes);
app.use('/api', commentsRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
});

// Error handler (uniform)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`HelpDesk Mini API listening on http://localhost:${PORT}`);
});

module.exports = app;

