const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware');

function uniformError(res, status, code, message, field) {
  const payload = { error: { code, message } };
  if (field) payload.error.field = field;
  return res.status(status).json(payload);
}

function hashPassword(password) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function calcSlaDeadline(priority) {
  const now = new Date();
  const hours = priority === 'High' ? 24 : priority === 'Medium' ? 48 : 72;
  const ms = now.getTime() + hours * 3600 * 1000;
  return new Date(ms).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { uniformError, hashPassword, verifyPassword, signToken, calcSlaDeadline, nowIso };

