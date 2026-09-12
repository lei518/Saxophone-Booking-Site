import crypto from 'crypto';

// How long an admin stays logged in after entering the password.
const TOKEN_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

function secret() {
  const pw = process.env.ADMIN_PASSWORD || '';
  if (pw.length < 12) {
    throw new Error(
      'ADMIN_PASSWORD is missing or shorter than 12 characters. Set a long one in your environment variables.'
    );
  }
  return pw;
}

// Compares two strings without leaking, through timing, how much of the
// string matched. Both sides are hashed first so the comparison is always
// over the same number of bytes and the length isn't leaked either.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function sign(expiresAt) {
  return crypto.createHmac('sha256', secret()).update(String(expiresAt)).digest('hex');
}

export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length === 0) return false;
  return safeEqual(pw, secret());
}

// A token is "<expiry>.<signature>". It can't be forged without the password,
// and it expires on its own, so the password only travels once per login
// instead of on every single admin action.
export function makeToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const expiresAt = Number(token.slice(0, dot));
  const signature = token.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return safeEqual(signature, sign(expiresAt));
}

// Drop this at the top of any admin-only branch:
//   if (!requireAdmin(req, res)) return;
export function requireAdmin(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token)) {
    res.status(401).json({ error: 'Not authorised' });
    return false;
  }
  return true;
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Simple in-memory rate limiter. Note this is per server instance, so on
// Vercel a determined attacker spread across instances gets a few extra
// tries — it still turns "unlimited guesses" into "a handful", which is
// what matters for a short password.
const hitsByKey = new Map();

export function rateLimit(key, { max = 8, windowMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  const recent = (hitsByKey.get(key) || []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    hitsByKey.set(key, recent);
    return false;
  }

  recent.push(now);
  hitsByKey.set(key, recent);

  // Occasional cleanup so the map can't grow without bound.
  if (hitsByKey.size > 500) {
    for (const [k, times] of hitsByKey) {
      if (!times.some((t) => now - t < windowMs)) hitsByKey.delete(k);
    }
  }

  return true;
}