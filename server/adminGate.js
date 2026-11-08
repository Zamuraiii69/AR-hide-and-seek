// Admin-only gate for creating and deleting markers and hides.
//
// Campaign hides are curated by staff; players only seek. ADMIN_TOKEN is read per
// request so a missing or weak token fails closed (writes disabled) instead of
// leaving the routes open.
const { createHash, timingSafeEqual } = require('node:crypto');

const MIN_TOKEN_LENGTH = 24;
const digest = (value) => createHash('sha256').update(String(value)).digest();

function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN || '';
  if (token.length < MIN_TOKEN_LENGTH) return res.status(503).json({ error: 'admin writes disabled' });
  const given = req.get('x-admin-token');
  if (!given || !timingSafeEqual(digest(given), digest(token))) {
    return res.status(401).json({ error: 'admin token required' });
  }
  next();
}

module.exports = { requireAdmin };
