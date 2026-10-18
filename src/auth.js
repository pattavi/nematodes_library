const crypto = require('crypto');

const COOKIE = 'sid';
const MAX_FAILS = 5;            // wrong passwords allowed per IP ...
const LOCK_MS = 60 * 1000;      // ... before that IP is locked out for this long

// Password comes from the environment only. It is hashed once at startup and the
// plaintext is not kept; comparison is constant-time. Empty => login disabled.
function create(env = process.env) {
  const pw = env.ADMIN_PASSWORD || '';
  const salt = crypto.randomBytes(16);
  const hash = pw ? crypto.scryptSync(pw, salt, 32) : null;
  const idleMs = (Number(env.SESSION_IDLE_MIN) > 0 ? Number(env.SESSION_IDLE_MIN) : 30) * 60 * 1000;

  const sessions = new Map(); // token -> expiry (sliding)
  const fails = new Map();    // ip -> { n, until }

  const enabled = () => !!hash;

  function check(candidate) {
    if (!hash || typeof candidate !== 'string' || candidate.length > 200) return false;
    return crypto.timingSafeEqual(hash, crypto.scryptSync(candidate, salt, 32));
  }

  function parseCookie(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function sessionOf(req) {
    const tok = parseCookie(req)[COOKIE];
    const exp = tok && sessions.get(tok);
    if (!exp) return null;
    if (exp < Date.now()) { sessions.delete(tok); return null; }
    sessions.set(tok, Date.now() + idleMs); // sliding idle expiry
    return tok;
  }

  const isAdmin = (req) => !!sessionOf(req);

  function setCookie(res, tok, maxAgeSec) {
    res.setHeader('Set-Cookie',
      `${COOKIE}=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`);
  }

  function login(req, res) {
    if (!enabled()) return res.status(403).json({ error: 'login_disabled' });
    const ip = req.ip || 'unknown';
    const f = fails.get(ip);
    if (f && f.until > Date.now()) {
      res.setHeader('Retry-After', Math.ceil((f.until - Date.now()) / 1000));
      return res.status(429).json({ error: 'too_many_attempts', retry_after: Math.ceil((f.until - Date.now()) / 1000) });
    }
    if (!check(req.body && req.body.password)) {
      const n = (f ? f.n : 0) + 1; // f.n is reset to 0 when a lockout starts
      fails.set(ip, { n: n >= MAX_FAILS ? 0 : n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
      return res.status(401).json({ error: 'wrong_password' });
    }
    fails.delete(ip);
    const tok = crypto.randomBytes(32).toString('hex');
    sessions.set(tok, Date.now() + idleMs);
    setCookie(res, tok, Math.floor(idleMs / 1000));
    res.json({ ok: true });
  }

  function logout(req, res) {
    const tok = parseCookie(req)[COOKIE];
    if (tok) sessions.delete(tok);
    setCookie(res, '', 0);
    res.json({ ok: true });
  }

  function status(req, res) {
    res.json({ admin: isAdmin(req), login_enabled: enabled() });
  }

  // Every write (POST/PUT/PATCH/DELETE) under /api needs an admin session, except login/logout.
  function guardWrites(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path === '/login' || req.path === '/logout') return next();
    if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
    next();
  }

  return { enabled, isAdmin, login, logout, status, guardWrites };
}

module.exports = { create };
