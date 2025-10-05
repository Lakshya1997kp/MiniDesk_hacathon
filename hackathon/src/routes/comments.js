const express = require('express');
const { requireAuth } = require('../middleware');
const { uniformError } = require('../utils');

const router = express.Router();

function canViewTicket(user, t) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'agent') return t.assigned_to === user.id;
  return t.author_id === user.id;
}

// Add Comment
router.post('/tickets/:id/comments', requireAuth, (req, res) => {
  const db = req.app.get('db');
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t || !canViewTicket(req.user, t)) return uniformError(res, 404, 'NOT_FOUND', 'Ticket not found');
  const { message, parent_comment_id } = req.body || {};
  if (!message) return uniformError(res, 400, 'FIELD_REQUIRED', 'Message is required', 'message');
  if (parent_comment_id) {
    const pc = db.prepare('SELECT id FROM comments WHERE id = ? AND ticket_id = ?').get(parent_comment_id, t.id);
    if (!pc) return uniformError(res, 400, 'INVALID_FIELD', 'Invalid parent_comment_id', 'parent_comment_id');
  }
  const info = db.prepare('INSERT INTO comments (ticket_id, message, author_id, parent_comment_id) VALUES (?, ?, ?, ?)')
    .run(t.id, message, req.user.id, parent_comment_id || null);
  db.prepare('INSERT INTO timeline (ticket_id, action, actor_id, meta_json) VALUES (?, ?, ?, ?)')
    .run(t.id, 'add_comment', req.user.id, JSON.stringify({ comment_id: info.lastInsertRowid }));
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(comment);
});

module.exports = router;

