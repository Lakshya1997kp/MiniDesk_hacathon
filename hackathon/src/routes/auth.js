const express = require('express');
const { uniformError, hashPassword, verifyPassword, signToken } = require('../utils');

const router = express.Router();

router.post('/register', (req, res) => {
  const db = req.app.get('db');
  const { email, password, role } = req.body || {};
  if (!email) return uniformError(res, 400, 'FIELD_REQUIRED', 'Email is required', 'email');
  if (!password) return uniformError(res, 400, 'FIELD_REQUIRED', 'Password is required', 'password');
  if (!role || !['user', 'agent', 'admin'].includes(role)) {
    return uniformError(res, 400, 'FIELD_REQUIRED', 'Role is required', 'role');
  }
  try {
    const stmt = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)');
    const info = stmt.run(email, hashPassword(password), role);
    return res.status(201).json({ id: info.lastInsertRowid, email, role });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return uniformError(res, 409, 'EMAIL_TAKEN', 'Email already registered');
    throw e;
  }
});

router.post('/login', (req, res) => {
  const db = req.app.get('db');
  const { email, password } = req.body || {};
  if (!email) return uniformError(res, 400, 'FIELD_REQUIRED', 'Email is required', 'email');
  if (!password) return uniformError(res, 400, 'FIELD_REQUIRED', 'Password is required', 'password');
  const user = db.prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?').get(email);
  if (!user) return uniformError(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  if (!verifyPassword(password, user.password_hash)) return uniformError(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

module.exports = router;

