const express = require('express');
const { requireAuth, requireRole } = require('../middleware');
const { uniformError, calcSlaDeadline, nowIso } = require('../utils');

const router = express.Router();

function canViewTicket(user, t) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'agent') return t.assigned_to === user.id;
  return t.author_id === user.id;
}

function serializeTicket(db, t) {
  const breached = new Date(t.sla_deadline).getTime() < Date.now();
  return { ...t, sla_breached: breached };
}

// Create Ticket
router.post('/tickets', requireAuth, (req, res) => {
  const db = req.app.get('db');
  const { title, description, priority } = req.body || {};
  if (!title) return uniformError(res, 400, 'FIELD_REQUIRED', 'Title is required', 'title');
  if (!description) return uniformError(res, 400, 'FIELD_REQUIRED', 'Description is required', 'description');
  if (!priority || !['High', 'Medium', 'Low'].includes(priority)) {
    return uniformError(res, 400, 'FIELD_REQUIRED', 'Priority is required', 'priority');
  }
  const sla_deadline = calcSlaDeadline(priority);
  const stmt = db.prepare(`INSERT INTO tickets (title, description, priority, status, assigned_to, sla_deadline, author_id) VALUES (?,?,?,?,?,?,?)`);
  const info = stmt.run(title, description, priority, 'open', null, sla_deadline, req.user.id);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO timeline (ticket_id, action, actor_id, meta_json) VALUES (?, ?, ?, ?)')
    .run(ticket.id, 'create_ticket', req.user.id, JSON.stringify({ title, priority }));
  res.status(201).json(serializeTicket(db, ticket));
});

// List Tickets with search & pagination
router.get('/tickets', requireAuth, (req, res) => {
  const db = req.app.get('db');
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);
  const search = (req.query.search || '').trim();

  // Build base visibility
  let where = '';
  let params = [];
  if (req.user.role === 'admin') {
    where = '1=1';
  } else if (req.user.role === 'agent') {
    where = 'assigned_to = ?';
    params.push(req.user.id);
  } else {
    where = 'author_id = ?';
    params.push(req.user.id);
  }

  let searchJoin = '';
  if (search) {
    searchJoin = `LEFT JOIN (
      SELECT ticket_id, MAX(created_at) AS latest_comment_at
      FROM comments
      GROUP BY ticket_id
    ) lc ON lc.ticket_id = t.id
    LEFT JOIN comments c ON c.ticket_id = t.id AND c.created_at = lc.latest_comment_at`;
    where += ' AND (t.title LIKE ? OR t.description LIKE ? OR COALESCE(c.message, "") LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const rows = db.prepare(`
    SELECT t.* FROM tickets t
    ${searchJoin}
    WHERE ${where}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit + 1, offset);

  const items = rows.slice(0, limit).map(t => serializeTicket(db, t));
  const next_offset = rows.length > limit ? offset + limit : null;
  res.json({ items, next_offset });
});

// Get Ticket by ID (includes comments and timeline)
router.get('/tickets/:id', requireAuth, (req, res) => {
  const db = req.app.get('db');
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t || !canViewTicket(req.user, t)) return uniformError(res, 404, 'NOT_FOUND', 'Ticket not found');
  const comments = db.prepare('SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id);
  const timeline = db.prepare('SELECT * FROM timeline WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id);
  res.json({ ticket: serializeTicket(db, t), comments, timeline });
});

// Update Ticket (optimistic locking)
router.patch('/tickets/:id', requireAuth, (req, res) => {
  const db = req.app.get('db');
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t || !canViewTicket(req.user, t)) return uniformError(res, 404, 'NOT_FOUND', 'Ticket not found');

  const ifMatch = req.headers['if-match'];
  const clientVersion = parseInt(ifMatch || '0', 10);
  if (!clientVersion) return uniformError(res, 400, 'FIELD_REQUIRED', 'If-Match header required with version', 'If-Match');
  if (clientVersion !== t.version) return uniformError(res, 409, 'VERSION_CONFLICT', 'Stale version');

  const { status, assigned_to } = req.body || {};

  // RBAC for fields
  if (assigned_to !== undefined && req.user.role !== 'admin') {
    return uniformError(res, 403, 'FORBIDDEN', 'Only admin can assign');
  }
  if (status !== undefined) {
    if (req.user.role === 'user' && !(status === 'open' || status === 'closed')) {
      return uniformError(res, 403, 'FORBIDDEN', 'Users can only set basic status');
    }
  }

  let newAssigned = t.assigned_to;
  if (assigned_to !== undefined) {
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(assigned_to);
    if (!target) return uniformError(res, 400, 'INVALID_FIELD', 'assigned_to invalid', 'assigned_to');
    newAssigned = assigned_to;
  }

  const newStatus = status !== undefined ? status : t.status;
  const newVersion = t.version + 1;
  const updated_at = nowIso();

  db.prepare('UPDATE tickets SET status = ?, assigned_to = ?, updated_at = ?, version = ? WHERE id = ?')
    .run(newStatus, newAssigned, updated_at, newVersion, t.id);

  if (status !== undefined) {
    db.prepare('INSERT INTO timeline (ticket_id, action, actor_id, meta_json) VALUES (?, ?, ?, ?)')
      .run(t.id, 'update_status', req.user.id, JSON.stringify({ from: t.status, to: newStatus }));
  }
  if (assigned_to !== undefined) {
    db.prepare('INSERT INTO timeline (ticket_id, action, actor_id, meta_json) VALUES (?, ?, ?, ?)')
      .run(t.id, 'assign_agent', req.user.id, JSON.stringify({ to: newAssigned }));
  }

  const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(t.id);
  res.json(serializeTicket(db, updated));
});

module.exports = router;

