import crypto from 'node:crypto';

const COOKIE = 'dp_session';
const SESSION_HOURS = 12;

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) {
    const err = new Error('SESSION_SECRET is missing or too short. Add a random value of 32+ characters in Vercel → Settings → Environment Variables.');
    err.status = 503;
    throw err;
  }
  return s;
}

/* ---------- passwords (scrypt, built into Node) ---------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use a mix of letters and numbers.';
  return '';
}

export function tempPassword() {
  const words = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
  return 'Dp-' + words + Math.floor(10 + Math.random() * 89);
}

/* ---------- signed session tokens ---------- */
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

export function signSession(user) {
  const payload = { uid: user.id, v: user.session_version, exp: Date.now() + SESSION_HOURS * 3600 * 1000 };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

export function readSession(token) {
  if (!token || token.indexOf('.') === -1) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

export function getCookie(req, name = COOKIE) {
  const header = req.headers.cookie || '';
  const parts = header.split(';');
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i > -1 && p.slice(0, i).trim() === name) return decodeURIComponent(p.slice(i + 1).trim());
  }
  return '';
}

function isSecure(req) {
  const proto = req.headers['x-forwarded-proto'] || '';
  return proto === 'https' || process.env.VERCEL === '1';
}

export function sessionCookie(req, token) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${isSecure(req) ? '; Secure' : ''}`;
}

export function clearCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;
}

/* ---------- API key (for Claude / automation acting as People Ops) ---------- */
export function apiKeyValid(req) {
  const key = process.env.PORTAL_API_KEY || '';
  if (key.length < 24) return false;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7).trim());
  const real = Buffer.from(key);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
