// Dé Pitch portal API — one Vercel function for the whole portal.
// POST /api/portal  { action: "...", ...data }   (JSON, header X-Portal: 1)
// GET  /api/portal?file=ID[&dl=1]               (download a document)
import crypto from 'node:crypto';
import { query, one } from './_lib/db.js';
import { notify, sendEmail, sendBatch, layout, canEmailVisitors, escapeHtml, siteUrl } from './_lib/mail.js';
import { TEMPLATES, IMAGE_LIBRARY, renderCampaign, templateById } from './_lib/campaign-templates.js';
import { CATEGORIES, CTAS, slugify, renderIndex, renderPost, renderNotFound, renderSitemap } from './_lib/blog.js';
import { pointsEmailHtml } from './_lib/points-email.js';
import {
  hashPassword, verifyPassword, passwordProblem, tempPassword,
  signSession, readSession, getCookie, sessionCookie, clearCookie, apiKeyValid, safeEqual
} from './_lib/auth.js';

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'peopleops@depitchhq.com').toLowerCase();
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv', 'text/plain': 'txt'
};

/* ================= helpers ================= */
class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);

function str(v, max = 500) { return String(v == null ? '' : v).trim().slice(0, max); }
function req(v, label, max = 500) { const s = str(v, max); if (!s) fail(400, `${label} is required.`); return s; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }
function email(v) { const e = str(v, 200).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'Enter a valid email address.'); return e; }
function period(v) { const p = str(v, 7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) fail(400, 'Choose a month.'); return p; }
function date(v, label, optional = false) {
  const d = str(v, 10);
  if (!d && optional) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(400, `${label} needs a valid date.`);
  return d;
}
function json(v, fallback = []) { try { const x = JSON.parse(v); return x == null ? fallback : x; } catch (e) { return fallback; } }
function lines(arr, max = 30) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max).map((l) => ({ label: str(l.label, 120), amount: num(l.amount) })).filter((l) => l.label || l.amount);
}
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthName = (p) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const sum = (arr) => Math.round(arr.reduce((t, l) => t + num(l.amount), 0) * 100) / 100;

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active, must_change: !!u.must_change,
    client_id: u.client_id || null, client_name: u.client_name || '', job_title: u.job_title || '',
    phone: u.phone || '', employee_code: u.employee_code || '', start_date: u.start_date || '',
    pay_currency: u.pay_currency || 'NGN', monthly_pay: Number(u.monthly_pay) || 0,
    bill_rate: Number(u.bill_rate) || 0, bank_name: u.bank_name || '', account_number: u.account_number || '',
    last_login: u.last_login || '', created_at: u.created_at || ''
  };
}

const USER_SELECT = `SELECT u.*, c.name AS client_name FROM users u LEFT JOIN clients c ON c.id = u.client_id`;

async function saveFile(file, { owner_id = null, client_id = null, title, category, uploaded_by }) {
  if (!file || !file.data) return null;
  const mime = str(file.type, 120);
  if (!ALLOWED_MIME[mime]) fail(400, 'That file type is not supported. Use PDF, Word, Excel, CSV, PNG or JPG.');
  const data = String(file.data).replace(/^data:[^,]*,/, '');
  const size = Math.floor((data.length * 3) / 4);
  if (size > MAX_FILE_BYTES) fail(400, 'Files must be 3 MB or smaller.');
  const filename = str(file.name, 160).replace(/[^\w.\- ()]/g, '_') || `document.${ALLOWED_MIME[mime]}`;
  const row = await one(
    `INSERT INTO files (owner_id, client_id, title, category, filename, mime, size, data, uploaded_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [owner_id, client_id, str(title, 160) || filename, str(category, 60) || 'Document', filename, mime, size, data, uploaded_by, nowIso()]
  );
  return row.id;
}

const FILE_COLS = 'id, owner_id, client_id, title, category, filename, mime, size, created_at';

// Email alert to People Ops (Resend if configured, otherwise FormSubmit).
async function notifyHR(subject, fields) { await notify(subject, fields); }

/* ================= request plumbing ================= */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return json(req.body, {});
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 4.4 * 1024 * 1024) fail(413, 'That upload is too large.'); chunks.push(c); }
  return json(Buffer.concat(chunks).toString('utf8'), {});
}

function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

async function currentUser(req) {
  const session = readSession(getCookie(req));
  if (!session) return null;
  const u = await one(`${USER_SELECT} WHERE u.id = $1`, [session.uid]);
  if (!u || !u.active || Number(u.session_version) !== Number(session.v)) return null;
  return u;
}

export default async function handler(req, res) {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    const reqUrl = new URL(req.url, 'http://x');
    if (reqUrl.searchParams.get('review')) return await handleReview(req, res, reqUrl);
    if (req.method === 'GET' && (reqUrl.searchParams.get('blog') || reqUrl.searchParams.get('sitemap') || /^\/scoop(\/|$)/.test(reqUrl.pathname))) return await handleBlog(req, res, reqUrl);
    if (reqUrl.searchParams.get('unsub') || reqUrl.searchParams.get('o') || reqUrl.searchParams.get('img')) return await handleMarketingGet(req, res, reqUrl);

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      if (url.searchParams.get('task') === 'sweep') { const n = await sweepChats(); return send(res, 200, { ok: true, emailed: n }); }
      const fileId = int(url.searchParams.get('file'));
      if (!fileId) return send(res, 404, { error: 'Not found' });
      const viaKey = apiKeyValid(req);
      const user = viaKey ? { id: 0, role: 'admin' } : await currentUser(req);
      if (!user) return send(res, 401, { error: 'Please sign in.' });
      return downloadFile(res, user, fileId, url.searchParams.get('dl') === '1');
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const viaKey = apiKeyValid(req);
    if (!viaKey && req.headers['x-portal'] !== '1') return send(res, 400, { error: 'Bad request' });

    const body = await readBody(req);
    const action = str(body.action, 60);

    // Public actions
    if (action === 'session') return send(res, 200, await session(req));
    if (action === 'login') return await login(req, res, body);
    if (action === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
    if (action === 'setup') return await setup(req, res, body);
    if (action.startsWith('public.')) {
      const pub = PUBLIC[action];
      if (!pub) return send(res, 404, { error: 'Unknown action.' });
      return send(res, 200, (await pub(req, body)) || { ok: true });
    }

    const user = viaKey ? await apiUser() : await currentUser(req);
    if (!user) return send(res, 401, { error: 'Your session has ended. Please sign in again.' });

    if (action === 'changePassword') return send(res, 200, await changePassword(req, res, user, body));
    if (user.must_change && !viaKey) return send(res, 403, { error: 'Please set a new password first.', mustChange: true });

    const [area] = action.split('.');
    const fn = ACTIONS[action];
    if (!fn) return send(res, 404, { error: 'Unknown action.' });
    if (area === 'emp' && user.role !== 'employee') return send(res, 403, { error: 'Not allowed.' });
    if (area === 'cli' && user.role !== 'client') return send(res, 403, { error: 'Not allowed.' });
    if (area === 'adm' && user.role !== 'admin') return send(res, 403, { error: 'Not allowed.' });
    if (area === 'mkt' && !['admin', 'media'].includes(user.role)) return send(res, 403, { error: 'Not allowed.' });
    if (area === 'cli' && !user.client_id) return send(res, 403, { error: 'Your account is not linked to a company yet. Contact People Ops.' });

    if (area === 'adm') await sweepChats();
    const result = await fn(user, body);
    return send(res, 200, result || { ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return send(res, status, { error: status >= 500 && !err.status ? 'Something went wrong. Please try again.' : err.message, ...(err.code ? { code: err.code } : {}) });
  }
}

async function apiUser() {
  const admin = await one(`${USER_SELECT} WHERE u.role = 'admin' AND u.active = TRUE ORDER BY u.id LIMIT 1`);
  return admin || { id: null, role: 'admin', name: 'API', email: ADMIN_EMAIL, must_change: false };
}

/* ================= public ================= */
async function session(req) {
  const admins = await one(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`);
  const u = await currentUser(req);
  let announcements = [];
  if (u && !u.must_change) {
    const aud = u.role === 'employee' ? 'employees' : u.role === 'client' ? 'clients' : null;
    if (aud) announcements = await query(`SELECT id, message, link FROM announcements WHERE active = TRUE AND (audience = $1 OR audience = 'all') ORDER BY id DESC LIMIT 5`, [aud]);
  }
  return { user: publicUser(u), needsSetup: Number(admins.n) === 0, adminEmail: ADMIN_EMAIL, announcements };
}

async function login(req, res, body) {
  const e = str(body.email, 200).toLowerCase();
  const pw = String(body.password || '');
  const u = await one(`${USER_SELECT} WHERE u.email = $1`, [e]);
  const generic = 'That email and password do not match.';
  if (!u) { verifyPassword(pw, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'); return send(res, 401, { error: generic }); }
  if (!u.active) return send(res, 403, { error: 'This account is turned off. Contact People Ops.' });
  if (u.locked_until && u.locked_until > nowIso()) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
  if (!verifyPassword(pw, u.password_hash)) {
    const fails = Number(u.failed_logins || 0) + 1;
    const lock = fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : '';
    await query(`UPDATE users SET failed_logins = $1, locked_until = $2 WHERE id = $3`, [lock ? 0 : fails, lock, u.id]);
    return send(res, 401, { error: lock ? 'Too many attempts. Try again in 15 minutes.' : generic });
  }
  await query(`UPDATE users SET failed_logins = 0, locked_until = '', last_login = $1 WHERE id = $2`, [nowIso(), u.id]);
  return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': sessionCookie(req, signSession(u)) });
}

async function setup(req, res, body) {
  const admins = await one(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`);
  if (Number(admins.n) > 0) return send(res, 403, { error: 'The portal is already set up.' });
  if (!process.env.SETUP_KEY || !safeEqual(body.setupKey, process.env.SETUP_KEY)) return send(res, 403, { error: 'That setup key is not correct.' });
  const problem = passwordProblem(body.password);
  if (problem) return send(res, 400, { error: problem });
  const u = await one(
    `INSERT INTO users (email, name, role, password_hash, must_change, created_at) VALUES ($1,$2,'admin',$3,FALSE,$4) RETURNING *`,
    [ADMIN_EMAIL, str(body.name, 120) || 'People Ops', hashPassword(body.password), nowIso()]
  );
  return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': sessionCookie(req, signSession(u)) });
}

async function changePassword(req, res, user, body) {
  if (!user.id) fail(400, 'Not available for API access.');
  if (!verifyPassword(String(body.current || ''), user.password_hash)) fail(400, 'Your current password is not correct.');
  const problem = passwordProblem(body.next);
  if (problem) fail(400, problem);
  const u = await one(
    `UPDATE users SET password_hash = $1, must_change = FALSE, session_version = session_version + 1 WHERE id = $2 RETURNING *`,
    [hashPassword(body.next), user.id]
  );
  res.setHeader('Set-Cookie', sessionCookie(req, signSession(u)));
  return { ok: true };
}

/* ================= files ================= */
async function downloadFile(res, user, id, asDownload) {
  const f = await one(`SELECT * FROM files WHERE id = $1`, [id]);
  if (!f) return send(res, 404, { error: 'Not found' });
  let allowed = user.role === 'admin';
  if (user.role === 'employee') allowed = Number(f.owner_id) === Number(user.id);
  if (user.role === 'client') allowed = f.client_id && Number(f.client_id) === Number(user.client_id);
  if (!allowed) return send(res, 403, { error: 'Not allowed.' });
  const buf = Buffer.from(f.data, 'base64');
  const inline = !asDownload && (f.mime === 'application/pdf' || f.mime.startsWith('image/'));
  res.statusCode = 200;
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Length', buf.length);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${f.filename.replace(/"/g, '')}"`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.end(buf);
}

/* ================= employee ================= */
async function empDashboard(u) {
  const pay = await query(`SELECT period, net, gross, currency, status, paid_at FROM payroll WHERE user_id = $1 ORDER BY period DESC LIMIT 24`, [u.id]);
  const counts = await one(
    `SELECT (SELECT COUNT(*)::int FROM reports WHERE user_id = $1) AS reports,
            (SELECT COUNT(*)::int FROM requests WHERE user_id = $1 AND status = 'pending') AS pending_requests,
            (SELECT COUNT(*)::int FROM files WHERE owner_id = $1 AND category <> 'Receipt') AS documents`, [u.id]);
  const lastReport = await one(`SELECT id, week_start, week_end, status FROM reports WHERE user_id = $1 ORDER BY week_start DESC, id DESC LIMIT 1`, [u.id]);
  return { profile: publicUser(u), payroll: pay, counts, lastReport };
}

async function empPayroll(u) {
  return { rows: await query(`SELECT id, period, gross, total_deductions, net, currency, status, paid_at FROM payroll WHERE user_id = $1 ORDER BY period DESC`, [u.id]) };
}

async function empPayslip(u, b) {
  const row = await one(`SELECT * FROM payroll WHERE user_id = $1 AND period = $2`, [u.id, period(b.period)]);
  if (!row) fail(404, 'No pay record for that month.');
  if (row.status !== 'paid') fail(400, 'A payslip is available once People Ops marks this month as paid.');
  return { payslip: { ...row, earnings: json(row.earnings), deductions: json(row.deductions) }, profile: publicUser(u) };
}

async function empReports(u) {
  const rows = await query(`SELECT * FROM reports WHERE user_id = $1 ORDER BY week_start DESC, id DESC LIMIT 100`, [u.id]);
  const excuses = await query(`SELECT id, week_start, week_end, reason, status, hr_note, created_at, reviewed_at, used_at FROM late_reports WHERE user_id = $1 ORDER BY id DESC LIMIT 30`, [u.id]);
  return { rows: rows.map((r) => ({ ...r, tasks: json(r.tasks), blockers: json(r.blockers) })), excuses, deadline: { lock: REPORT_LOCK, week_start: currentWeekStart() } };
}

async function empLateExcuse(u, b) {
  const ws = date(b.week_start, 'Week start date');
  const we = date(b.week_end, 'Week end date', true) || reportFriday(ws);
  const reason = req(b.reason, 'Your reason', 2000);
  if (Date.now() <= reportLockTime(ws)) fail(400, 'This week is still open. You can submit your report as normal.');
  if (await one(`SELECT id FROM reports WHERE user_id=$1 AND week_start=$2`, [u.id, ws])) fail(400, 'You have already submitted a report for this week.');
  const open = await one(`SELECT id, status FROM late_reports WHERE user_id=$1 AND week_start=$2 AND used_at='' AND status IN ('pending','valid') ORDER BY id DESC LIMIT 1`, [u.id, ws]);
  if (open && open.status === 'valid') fail(400, 'People Ops has already accepted your reason. You can submit the report now.');
  if (open) await query(`UPDATE late_reports SET reason=$1, week_end=$2, created_at=$3 WHERE id=$4`, [reason, we, nowIso(), open.id]);
  else await query(`INSERT INTO late_reports (user_id, week_start, week_end, reason, created_at) VALUES ($1,$2,$3,$4,$5)`, [u.id, ws, we, reason, nowIso()]);
  await notifyHR(`Late weekly report: ${u.name} explained why`, { Employee: u.name, Week: `${ws} to ${we}`, Reason: reason, Review: 'Open the portal → Weekly reports → Late report explanations to mark it valid or not valid.' });
  return { ok: true };
}

function cleanReport(b) {
  const ws = date(b.week_start, 'Week start date');
  const we = date(b.week_end, 'Week end date');
  if (we < ws) fail(400, 'Week end date must be after the start date.');
  const tasks = (Array.isArray(b.tasks) ? b.tasks : []).slice(0, 40).map((t) => ({
    description: str(t.description, 600), status: str(t.status, 40), hours: num(t.hours), outcome: str(t.outcome, 600)
  })).filter((t) => t.description);
  if (!tasks.length) fail(400, 'Add at least one task.');
  const blockers = (Array.isArray(b.blockers) ? b.blockers : []).slice(0, 20).map((x) => ({
    issue: str(x.issue, 600), impact: str(x.impact, 400), action: str(x.action, 400), support: str(x.support, 400)
  })).filter((x) => x.issue);
  return { ws, we, tasks, blockers };
}

/* ---- Weekly report deadline ----
   Reports are due every Friday. There is no cut-off time (staff work across time zones),
   so the form never closes. REPORT_LOCK can turn the old Friday 6pm (Lagos) lock back on:
   late reports would then need a reason accepted by People Ops. */
const REPORT_LOCK = false;
const REPORT_DUE_HOUR = 17;
const REPORT_LOCK_HOUR = 18;
function addDaysIso(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function reportFriday(ws) { const dow = new Date(ws + 'T00:00:00Z').getUTCDay(); return addDaysIso(ws, dow <= 5 ? 5 - dow : 6); }
function reportLockTime(ws) { return Date.parse(`${reportFriday(ws)}T${String(REPORT_LOCK_HOUR).padStart(2, '0')}:00:00+01:00`); }
function lagosNow() { return new Date(Date.now() + 3600000); } // read with getUTC* for Lagos wall time
function currentWeekStart() { const n = lagosNow(); const d = n.toISOString().slice(0, 10); return addDaysIso(d, -((n.getUTCDay() + 6) % 7)); }

async function empSubmitReport(u, b) {
  const { ws, we, tasks, blockers } = cleanReport(b);
  let late = false, excuse = null;
  if (REPORT_LOCK && Date.now() > reportLockTime(ws)) {
    excuse = await one(`SELECT id FROM late_reports WHERE user_id=$1 AND week_start=$2 AND status='valid' AND used_at='' ORDER BY id DESC LIMIT 1`, [u.id, ws]);
    if (!excuse) fail(403, `Reports for this week closed on Friday ${new Date(reportFriday(ws) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} at 6pm. Tell People Ops why it's late. If they accept your reason, you can submit it.`, 'late');
    late = true;
  }
  const client = str(b.client_name, 160) || u.client_name || '';
  const row = await one(
    `INSERT INTO reports (user_id, client_name, week_start, week_end, submitted_on, tasks, blockers, status, created_at, late)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$9) RETURNING id`,
    [u.id, client, ws, we, today(), JSON.stringify(tasks), JSON.stringify(blockers), nowIso(), late]
  );
  if (excuse) await query(`UPDATE late_reports SET used_at=$1 WHERE id=$2`, [nowIso(), excuse.id]);
  const hours = tasks.reduce((t, x) => t + x.hours, 0);
  await notifyHR(`${late ? 'Late weekly report' : 'Weekly report'} from ${u.name}`, { Employee: u.name, Client: client, Week: `${ws} to ${we}`, Tasks: tasks.length, Hours: hours, Blockers: blockers.length });
  return { id: row.id };
}

async function empRequests(u) {
  return { rows: await query(`SELECT r.*, f.filename FROM requests r LEFT JOIN files f ON f.id = r.file_id WHERE r.user_id = $1 ORDER BY r.id DESC LIMIT 100`, [u.id]) };
}

async function empSubmitRequest(u, b) {
  const type = ['time_off', 'reimbursement', 'other'].includes(b.type) ? b.type : fail(400, 'Choose a request type.');
  let start = '', end = '', amount = 0, title = str(b.title, 160);
  if (type === 'time_off') {
    start = date(b.start_date, 'Start date'); end = date(b.end_date, 'End date');
    if (end < start) fail(400, 'End date must be on or after the start date.');
    title = title || str(b.leave_type, 60) || 'Time off';
  }
  if (type === 'reimbursement') {
    amount = num(b.amount); if (amount <= 0) fail(400, 'Enter the amount to reimburse.');
    title = req(b.title, 'What it was for', 160);
  }
  if (type === 'other') title = req(b.title, 'Subject', 160);
  const details = req(b.details, 'Details', 2000);
  const fileId = b.file ? await saveFile(b.file, { owner_id: u.id, title: `Receipt: ${title}`, category: 'Receipt', uploaded_by: u.id }) : null;
  const row = await one(
    `INSERT INTO requests (user_id, type, title, details, amount, currency, start_date, end_date, file_id, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10) RETURNING id`,
    [u.id, type, title, details, amount, str(b.currency, 3) || u.pay_currency || 'NGN', start, end, fileId, nowIso()]
  );
  await notifyHR(`${type.replace('_', ' ')} request from ${u.name}`, { Employee: u.name, Type: type, Title: title, Dates: start ? `${start} to ${end}` : '', Amount: amount || '', Details: details });
  return { id: row.id };
}

async function empDocuments(u) {
  return { rows: await query(`SELECT ${FILE_COLS} FROM files WHERE owner_id = $1 AND category <> 'Receipt' ORDER BY id DESC`, [u.id]) };
}

/* ================= client ================= */
async function cliTalents(u) {
  return query(
    `SELECT id, name, email, job_title, start_date, bill_rate, pay_currency, employee_code FROM users
     WHERE role = 'employee' AND active = TRUE AND client_id = $1 ORDER BY name`, [u.client_id]);
}

async function cliDashboard(u) {
  const client = await one(`SELECT * FROM clients WHERE id = $1`, [u.client_id]);
  const talents = await cliTalents(u);
  const invoices = await query(`SELECT id, number, period, total, currency, status, due_date FROM invoices WHERE client_id = $1 AND status IN ('sent','paid') ORDER BY period DESC, id DESC`, [u.client_id]);
  const open = await one(`SELECT COUNT(*)::int AS n FROM recruitment WHERE client_id = $1 AND status NOT IN ('filled','closed')`, [u.client_id]);
  return { client, talents, invoices: invoices.slice(0, 12), payroll: payrollMatrix(invoices.length ? await invoiceItems(u.client_id) : [], talents, talents.length ? await query(`SELECT DISTINCT user_id, period FROM payroll WHERE user_id = ANY(string_to_array($1, ',')::int[])`, [talents.map((t) => t.id).join(',')]) : []), openRecruitment: open.n };
}

async function invoiceItems(clientId) {
  const rows = await query(`SELECT period, items, currency FROM invoices WHERE client_id = $1 AND status IN ('sent','paid') ORDER BY period`, [clientId]);
  const out = [];
  for (const r of rows) for (const it of json(r.items)) out.push({ period: r.period, currency: r.currency, ...it });
  return out;
}

function payrollMatrix(items, talents, worked) {
  // Invoiced amounts first; for months a talent worked but no invoice has been
  // sent yet, show their agreed monthly rate (marked as an estimate).
  const names = {};
  for (const t of talents) names[t.id] = t.name;
  const byTalent = {};
  const periodSet = new Set();
  for (const it of items) {
    const key = (it.talent_id ? 't' + it.talent_id : 'x' + it.description) + ':' + (it.currency || 'NGN');
    if (!byTalent[key]) byTalent[key] = { name: it.talent_name || names[it.talent_id] || it.description || 'Other', currency: it.currency || 'NGN', amounts: {}, estimated: {} };
    byTalent[key].amounts[it.period] = (byTalent[key].amounts[it.period] || 0) + num(it.amount);
    periodSet.add(it.period);
  }
  for (const w of worked) {
    const t = talents.find((x) => Number(x.id) === Number(w.user_id));
    if (!t || !num(t.bill_rate)) continue;
    const key = 't' + t.id + ':' + (t.pay_currency || 'NGN');
    if (!byTalent[key]) byTalent[key] = { name: t.name, currency: t.pay_currency || 'NGN', amounts: {}, estimated: {} };
    if (byTalent[key].amounts[w.period] == null) { byTalent[key].amounts[w.period] = num(t.bill_rate); byTalent[key].estimated[w.period] = true; }
    periodSet.add(w.period);
  }
  const periods = [...periodSet].sort().slice(-12);
  return { periods, rows: Object.values(byTalent), currency: items[0] ? items[0].currency : 'NGN' };
}

async function cliInvoice(u, b) {
  const inv = await one(`SELECT * FROM invoices WHERE id = $1 AND client_id = $2 AND status IN ('sent','paid')`, [int(b.id), u.client_id]);
  if (!inv) fail(404, 'Invoice not found.');
  const client = await one(`SELECT * FROM clients WHERE id = $1`, [u.client_id]);
  return { invoice: { ...inv, items: json(inv.items) }, client };
}

async function cliRecruitment(u) {
  return { rows: await query(`SELECT r.*, f.filename FROM recruitment r LEFT JOIN files f ON f.id = r.file_id WHERE r.client_id = $1 ORDER BY r.id DESC`, [u.client_id]) };
}

async function cliSubmitRecruitment(u, b) {
  const row = await one(
    `INSERT INTO recruitment (client_id, created_by, role_title, headcount, employment_type, skills, budget, start_date, notes, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted',$10,$10) RETURNING id`,
    [u.client_id, u.id, req(b.role_title, 'Role title', 160), Math.max(1, Math.min(100, int(b.headcount) || 1)), str(b.employment_type, 60),
      req(b.skills, 'Skills and requirements', 2000), str(b.budget, 120), date(b.start_date, 'Start date', true), str(b.notes, 2000), nowIso()]
  );
  await notifyHR(`New talent request from ${u.client_name}`, { Client: u.client_name, 'Requested by': u.name, Role: b.role_title, Headcount: b.headcount, Budget: b.budget || '', Skills: b.skills });
  return { id: row.id };
}

async function cliFeedback(u) {
  return { rows: await query(
    `SELECT f.*, t.name AS talent_name FROM talent_feedback f LEFT JOIN users t ON t.id = f.talent_id WHERE f.client_id = $1 ORDER BY f.id DESC`, [u.client_id]) };
}

async function cliSubmitFeedback(u, b) {
  const kind = b.kind === 'removal' ? 'removal' : 'review';
  const talent = await one(`SELECT id, name FROM users WHERE id = $1 AND role = 'employee' AND client_id = $2`, [int(b.talent_id), u.client_id]);
  if (!talent) fail(400, 'Choose one of your talents.');
  const rating = kind === 'review' ? Math.max(1, Math.min(5, int(b.rating))) : 0;
  if (kind === 'review' && !int(b.rating)) fail(400, 'Choose a rating.');
  const comments = req(b.comments, kind === 'removal' ? 'Reason' : 'Comments', 3000);
  const eff = kind === 'removal' ? date(b.effective_date, 'Effective date') : '';
  const row = await one(
    `INSERT INTO talent_feedback (client_id, created_by, talent_id, kind, rating, comments, effective_date, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$8) RETURNING id`,
    [u.client_id, u.id, talent.id, kind, rating, comments, eff, nowIso()]
  );
  await notifyHR(kind === 'removal' ? `Removal request: ${talent.name}` : `Talent review: ${talent.name}`, { Client: u.client_name, Talent: talent.name, Rating: rating || '', 'Effective date': eff, Comments: comments });
  return { id: row.id };
}

async function cliDocuments(u) {
  return { rows: await query(`SELECT ${FILE_COLS} FROM files WHERE client_id = $1 ORDER BY id DESC`, [u.client_id]) };
}

/* ================= admin (People Ops) ================= */
async function admOverview() {
  const c = await one(`SELECT
    (SELECT COUNT(*)::int FROM reports WHERE status = 'submitted') + (SELECT COUNT(*)::int FROM late_reports WHERE status = 'pending') AS reports,
    (SELECT COUNT(*)::int FROM requests WHERE status = 'pending') AS requests,
    (SELECT COUNT(*)::int FROM recruitment WHERE status IN ('submitted','in_progress')) AS recruitment,
    (SELECT COUNT(*)::int FROM talent_feedback WHERE status = 'submitted') AS feedback,
    (SELECT COUNT(*)::int FROM payroll WHERE status = 'pending') AS payroll_pending,
    (SELECT COUNT(*)::int FROM invoices WHERE status = 'draft') AS invoices_draft,
    (SELECT COUNT(*)::int FROM invoices WHERE status = 'sent') AS invoices_unpaid,
    (SELECT COUNT(*)::int FROM users WHERE role = 'employee' AND active = TRUE) AS employees,
    (SELECT COUNT(*)::int FROM clients WHERE active = TRUE) AS clients,
    (SELECT COUNT(*)::int FROM enquiries WHERE status = 'new') AS enquiries,
    (SELECT COUNT(*)::int FROM chats WHERE status = 'open' AND last_visitor_msg > last_staff_msg) AS chats,
    (SELECT COUNT(*)::int FROM referrals WHERE status = 'submitted') AS referrals,
    (SELECT COUNT(*)::int FROM points_claims WHERE status = 'pending') + (SELECT COUNT(*)::int FROM redemptions WHERE status = 'pending') AS points,
    (SELECT COUNT(*)::int FROM enquiries WHERE service <> '' AND consult_date = '' AND consult_done_at = '' AND paid_at = '' AND closed_at = '' AND done_at = '') +
    (SELECT COUNT(*)::int FROM enquiries WHERE service <> '' AND consult_date <> '' AND consult_done_at = '' AND closed_at = '' AND LEFT(consult_date, 10) <= $1) +
    (SELECT COUNT(*)::int FROM enquiries WHERE service = 'interview' AND session_date <> '' AND done_at = '' AND closed_at = '' AND session_date <= $1) +
    (SELECT COUNT(*)::int FROM enquiries WHERE service = 'cv' AND review_status = 'approved' AND delivered_at = '' AND closed_at = '') AS services`, [new Date(Date.now() + 86400000).toISOString().slice(0, 10)]);
  return { counts: c };
}

async function admUsers() {
  return { rows: (await query(`${USER_SELECT} ORDER BY u.role, u.name`)).map(publicUser) };
}

function userFields(b) {
  return [str(b.name, 120), str(b.job_title, 120), str(b.phone, 40), str(b.employee_code, 40), date(b.start_date, 'Start date', true),
    str(b.pay_currency, 3).toUpperCase() || 'NGN', num(b.monthly_pay), num(b.bill_rate), str(b.bank_name, 80), str(b.account_number, 30), b.client_id ? int(b.client_id) : null];
}

async function admCreateUser(admin, b) {
  const role = ['employee', 'client', 'admin', 'media'].includes(b.role) ? b.role : fail(400, 'Choose a role.');
  const e = email(b.email);
  if (!str(b.name)) fail(400, 'Name is required.');
  if (role === 'client' && !b.client_id) fail(400, 'Link the client user to a company.');
  if (await one(`SELECT id FROM users WHERE email = $1`, [e])) fail(400, 'Someone already uses that email.');
  const chosen = String(b.password || '');
  if (chosen) { const problem = passwordProblem(chosen); if (problem) fail(400, 'Password: ' + problem); }
  const temp = chosen || tempPassword();
  // Optionally give the new login the same password as an existing one (e.g. "same as People Ops").
  const twin = b.password_like ? await one(`SELECT password_hash FROM users WHERE email = $1`, [str(b.password_like, 200).toLowerCase()]) : null;
  if (b.password_like && !twin) fail(400, 'No login found to copy the password from.');
  const f = userFields(b);
  if (twin) {
    const u2 = await one(`INSERT INTO users (email, role, password_hash, must_change, name, job_title, phone, employee_code, start_date, pay_currency, monthly_pay, bill_rate, bank_name, account_number, client_id, created_at)
      VALUES ($1,$2,$3,FALSE,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, [e, role, twin.password_hash, ...f, nowIso()]);
    return { id: u2.id, passwordSet: true };
  }
  const u = await one(
    `INSERT INTO users (email, role, password_hash, must_change, name, job_title, phone, employee_code, start_date, pay_currency, monthly_pay, bill_rate, bank_name, account_number, client_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [e, role, hashPassword(temp), !chosen, ...f, nowIso()]
  );
  return chosen ? { id: u.id, passwordSet: true } : { id: u.id, tempPassword: temp };
}

async function admUpdateUser(admin, b) {
  const id = int(b.id);
  const existing = await one(`SELECT * FROM users WHERE id = $1`, [id]);
  if (!existing) fail(404, 'User not found.');
  const f = userFields(b);
  const active = b.active === false ? false : true;
  if (!active && Number(existing.id) === Number(admin.id)) fail(400, 'You cannot turn off your own account.');
  if (b.email && String(b.email).trim().toLowerCase() !== existing.email) {
    const e = email(b.email);
    if (await one(`SELECT id FROM users WHERE email = $1 AND id <> $2`, [e, id])) fail(400, 'Someone already uses that email.');
    await query(`UPDATE users SET email = $1, session_version = session_version + 1 WHERE id = $2`, [e, id]);
  }
  await query(
    `UPDATE users SET name=$1, job_title=$2, phone=$3, employee_code=$4, start_date=$5, pay_currency=$6, monthly_pay=$7, bill_rate=$8,
       bank_name=$9, account_number=$10, client_id=$11, active=$12, session_version = session_version + (CASE WHEN $12 THEN 0 ELSE 1 END) WHERE id=$13`,
    [...f, active, id]
  );
  return { ok: true };
}

async function admResetPassword(admin, b) {
  const temp = tempPassword();
  const u = await one(`UPDATE users SET password_hash=$1, must_change=TRUE, failed_logins=0, locked_until='', session_version=session_version+1 WHERE id=$2 RETURNING id`, [hashPassword(temp), int(b.id)]);
  if (!u) fail(404, 'User not found.');
  return { tempPassword: temp };
}

async function admClients() {
  return { rows: await query(`SELECT c.*, (SELECT COUNT(*)::int FROM users u WHERE u.client_id = c.id AND u.role='employee' AND u.active) AS talents FROM clients c ORDER BY c.name`) };
}

async function admSaveClient(admin, b) {
  const vals = [req(b.name, 'Company name', 160), str(b.contact_name, 120), str(b.contact_email, 160), str(b.phone, 40), str(b.address, 300), str(b.currency, 3).toUpperCase() || 'NGN'];
  if (b.id) {
    await query(`UPDATE clients SET name=$1, contact_name=$2, contact_email=$3, phone=$4, address=$5, currency=$6, active=$7 WHERE id=$8`, [...vals, b.active !== false, int(b.id)]);
    return { id: int(b.id) };
  }
  const row = await one(`INSERT INTO clients (name, contact_name, contact_email, phone, address, currency, active, created_at) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7) RETURNING id`, [...vals, nowIso()]);
  return { id: row.id };
}

async function admPayroll(admin, b) {
  const p = b.period ? period(b.period) : null;
  const rows = await query(
    `SELECT p.*, u.name, u.email, u.employee_code, u.job_title FROM payroll p JOIN users u ON u.id = p.user_id
     ${p ? 'WHERE p.period = $1' : ''} ORDER BY p.period DESC, u.name LIMIT 500`, p ? [p] : []);
  return { rows: rows.map((r) => ({ ...r, earnings: json(r.earnings), deductions: json(r.deductions) })) };
}

async function admGeneratePayroll(admin, b) {
  const p = period(b.period);
  const staff = await query(`SELECT id, monthly_pay, pay_currency FROM users WHERE role='employee' AND active=TRUE`);
  let created = 0;
  for (const s of staff) {
    const exists = await one(`SELECT id FROM payroll WHERE user_id=$1 AND period=$2`, [s.id, p]);
    if (exists) continue;
    const earnings = [{ label: 'Basic salary', amount: num(s.monthly_pay) }];
    await query(
      `INSERT INTO payroll (user_id, period, earnings, deductions, gross, total_deductions, net, currency, status, created_at, updated_at)
       VALUES ($1,$2,$3,'[]',$4,0,$4,$5,'pending',$6,$6)`,
      [s.id, p, JSON.stringify(earnings), num(s.monthly_pay), s.pay_currency || 'NGN', nowIso()]);
    created++;
  }
  return { created };
}

async function admSavePayroll(admin, b) {
  const earnings = lines(b.earnings);
  const deductions = lines(b.deductions);
  const gross = sum(earnings), td = sum(deductions), net = Math.round((gross - td) * 100) / 100;
  if (b.id) {
    const row = await one(
      `UPDATE payroll SET earnings=$1, deductions=$2, gross=$3, total_deductions=$4, net=$5, currency=$6, notes=$7, updated_at=$8 WHERE id=$9 RETURNING id`,
      [JSON.stringify(earnings), JSON.stringify(deductions), gross, td, net, str(b.currency, 3).toUpperCase() || 'NGN', str(b.notes, 500), nowIso(), int(b.id)]);
    if (!row) fail(404, 'Pay record not found.');
    return { id: row.id };
  }
  const uid = int(b.user_id);
  if (!(await one(`SELECT id FROM users WHERE id=$1 AND role='employee'`, [uid]))) fail(400, 'Choose an employee.');
  const p = period(b.period);
  if (await one(`SELECT id FROM payroll WHERE user_id=$1 AND period=$2`, [uid, p])) fail(400, 'That employee already has a pay record for this month. Edit it instead.');
  const row = await one(
    `INSERT INTO payroll (user_id, period, earnings, deductions, gross, total_deductions, net, currency, notes, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$10) RETURNING id`,
    [uid, p, JSON.stringify(earnings), JSON.stringify(deductions), gross, td, net, str(b.currency, 3).toUpperCase() || 'NGN', str(b.notes, 500), nowIso()]);
  return { id: row.id };
}

async function admMarkPaid(admin, b) {
  const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(int).filter(Boolean);
  if (!ids.length) fail(400, 'Choose at least one pay record.');
  const paid = b.paid === false ? 'pending' : 'paid';
  const paidAt = paid === 'paid' ? (date(b.paid_at, 'Payment date', true) || today()) : '';
  for (const id of ids) await query(`UPDATE payroll SET status=$1, paid_at=$2, payment_ref=$3, updated_at=$4 WHERE id=$5`, [paid, paidAt, str(b.payment_ref, 80), nowIso(), id]);
  return { updated: ids.length };
}

async function admDeletePayroll(admin, b) {
  await query(`DELETE FROM payroll WHERE id=$1 AND status='pending'`, [int(b.id)]);
  return { ok: true };
}

async function admReports(admin, b) {
  const status = str(b.status, 30);
  const rows = await query(
    `SELECT r.*, u.name, u.email FROM reports r JOIN users u ON u.id = r.user_id ${status ? 'WHERE r.status = $1' : ''} ORDER BY r.id DESC LIMIT 300`, status ? [status] : []);
  return { rows: rows.map((r) => ({ ...r, tasks: json(r.tasks), blockers: json(r.blockers) })) };
}

async function admLateExcuses(admin, b) {
  const rows = await query(`SELECT l.*, u.name, u.email FROM late_reports l JOIN users u ON u.id = l.user_id ORDER BY (l.status = 'pending') DESC, l.id DESC LIMIT 100`);
  return { rows };
}

async function admReviewLate(admin, b) {
  const status = ['valid', 'invalid'].includes(b.status) ? b.status : fail(400, 'Choose valid or not valid.');
  const note = str(b.hr_note, 1000);
  const row = await one(`UPDATE late_reports SET status=$1, hr_note=$2, reviewed_at=$3 WHERE id=$4 RETURNING *`, [status, note, nowIso(), int(b.id)]);
  if (!row) fail(404, 'Not found.');
  const u = await one(`SELECT name, email FROM users WHERE id=$1`, [row.user_id]);
  if (u && u.email) {
    const first = escapeHtml(String(u.name || '').split(' ')[0] || 'there');
    const week = `${row.week_start} to ${row.week_end}`;
    const body = status === 'valid'
      ? `<p style="font-size:15px;line-height:1.6">Hi ${first},</p><p style="font-size:15px;line-height:1.6">People Ops has accepted your reason for the late weekly report (${week}). You can now submit it in the portal under <b>Weekly reports</b>.</p>`
      : `<p style="font-size:15px;line-height:1.6">Hi ${first},</p><p style="font-size:15px;line-height:1.6">People Ops reviewed your reason for the late weekly report (${week}) and did not accept it, so this week's report stays closed.</p>`;
    await sendEmail({ to: u.email, subject: status === 'valid' ? 'You can now submit your late weekly report' : 'Your late weekly report', html: layout(status === 'valid' ? 'Reason accepted' : 'Reason not accepted', body + (note ? `<p style="font-size:15px;line-height:1.6"><b>Note from People Ops:</b> ${escapeHtml(note)}</p>` : '') + `<p><a href="${assetBase()}/portal#/reports" style="display:inline-block;background:#011D38;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open the portal</a></p>`), replyTo: ADMIN_EMAIL });
  }
  return { ok: true };
}

/* Friday reminder: emails every active employee who has not yet sent this week's report.
   Runs from the daily sweep, once per Friday (Lagos time), from 9am. */
async function sweepReportReminders() {
  const n = lagosNow();
  if (n.getUTCDay() !== 5 || n.getUTCHours() < 9) return 0;
  const ws = currentWeekStart();
  const key = `report-reminder:${ws}`;
  const claimed = await one(`INSERT INTO reminders (key, sent_at) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING RETURNING key`, [key, nowIso()]);
  if (!claimed) return 0;
  const due = await query(`SELECT id, name, email FROM users u WHERE role='employee' AND active=TRUE AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.user_id=u.id AND r.week_start=$1)`, [ws]);
  let sent = 0;
  for (const u of due) {
    const first = escapeHtml(String(u.name || '').split(' ')[0] || 'there');
    const ok = await sendEmail({ to: u.email, subject: 'Reminder: your weekly report is due today', replyTo: ADMIN_EMAIL,
      html: layout('Your weekly report is due today', `<p style="font-size:15px;line-height:1.6">Hi ${first},</p><p style="font-size:15px;line-height:1.6">Friendly reminder: please submit this week's report on the Dé Pitch portal <b>today</b>.</p><p><a href="${assetBase()}/portal#/reports" style="display:inline-block;background:#011D38;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Submit my weekly report</a></p>`) });
    if (ok) sent++;
  }
  await query(`UPDATE reminders SET sent_count=$1 WHERE key=$2`, [sent, key]);
  return sent;
}

async function admReviewReport(admin, b) {
  const status = ['approved', 'changes_requested', 'submitted'].includes(b.status) ? b.status : fail(400, 'Choose a decision.');
  await query(`UPDATE reports SET status=$1, hr_note=$2, reviewed_at=$3 WHERE id=$4`, [status, str(b.hr_note, 1000), nowIso(), int(b.id)]);
  return { ok: true };
}

// Bring an employee's past weekly reports (e.g. from the old spreadsheet) into the portal.
// Weeks already on file for that employee are skipped, so it is safe to run twice.
async function admImportReports(admin, b) {
  const email = str(b.email, 200).toLowerCase();
  const u = email ? await one(`SELECT id, name FROM users WHERE lower(email)=$1 AND role='employee'`, [email]) : await one(`SELECT id, name FROM users WHERE id=$1 AND role='employee'`, [int(b.user_id)]);
  if (!u) fail(404, 'Employee not found.');
  const list = (Array.isArray(b.reports) ? b.reports : []).slice(0, 200);
  const status = ['approved', 'submitted'].includes(b.status) ? b.status : 'approved';
  const note = str(b.hr_note, 300);
  let added = 0, skipped = 0; const errors = [];
  for (const r of list) {
    try {
      const { ws, we, tasks, blockers } = cleanReport(r);
      if (await one(`SELECT id FROM reports WHERE user_id=$1 AND week_start=$2`, [u.id, ws])) { skipped++; continue; }
      const sub = /^\d{4}-\d{2}-\d{2}$/.test(String(r.submitted_on || '')) ? r.submitted_on : we;
      await query(
        `INSERT INTO reports (user_id, client_name, week_start, week_end, submitted_on, tasks, blockers, status, hr_note, reviewed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [u.id, str(r.client_name, 160), ws, we, sub, JSON.stringify(tasks), JSON.stringify(blockers), status, note, status === 'approved' ? nowIso() : '', nowIso()]);
      added++;
    } catch (e) { errors.push(`${r.week_start || '?'}: ${e.message}`); }
  }
  return { employee: u.name, added, skipped, errors };
}

async function admRequests(admin, b) {
  const status = str(b.status, 30);
  return { rows: await query(
    `SELECT r.*, u.name, u.email, f.filename FROM requests r JOIN users u ON u.id = r.user_id LEFT JOIN files f ON f.id = r.file_id
     ${status ? 'WHERE r.status = $1' : ''} ORDER BY r.id DESC LIMIT 300`, status ? [status] : []) };
}

async function admReviewRequest(admin, b) {
  const status = ['approved', 'declined', 'pending', 'paid'].includes(b.status) ? b.status : fail(400, 'Choose a decision.');
  await query(`UPDATE requests SET status=$1, hr_note=$2, reviewed_at=$3 WHERE id=$4`, [status, str(b.hr_note, 1000), nowIso(), int(b.id)]);
  return { ok: true };
}

async function admInvoices(admin, b) {
  const rows = await query(`SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.period DESC, i.id DESC LIMIT 300`);
  return { rows: rows.map((r) => ({ ...r, items: json(r.items) })) };
}

async function admDraftInvoice(admin, b) {
  // Suggest line items from the talents currently placed with this client.
  const clientId = int(b.client_id);
  const p = period(b.period);
  const client = await one(`SELECT * FROM clients WHERE id=$1`, [clientId]);
  if (!client) fail(400, 'Choose a client.');
  const cur = (str(b.currency, 3) || client.currency || 'NGN').toUpperCase();
  const all = await query(`SELECT id, name, job_title, bill_rate, pay_currency FROM users WHERE role='employee' AND active=TRUE AND client_id=$1 ORDER BY name`, [clientId]);
  const talents = all.filter((t) => (t.pay_currency || 'NGN') === cur);
  const others = [...new Set(all.filter((t) => (t.pay_currency || 'NGN') !== cur).map((t) => t.pay_currency))];
  return { items: talents.map((t) => ({ talent_id: t.id, talent_name: t.name, description: `${t.name}${t.job_title ? ' — ' + t.job_title : ''} (${monthName(p)})`, amount: num(t.bill_rate) })), currency: cur, otherCurrencies: others };
}

async function admSaveInvoice(admin, b) {
  const clientId = int(b.client_id);
  if (!(await one(`SELECT id FROM clients WHERE id=$1`, [clientId]))) fail(400, 'Choose a client.');
  const p = period(b.period);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((i) => ({
    talent_id: i.talent_id ? int(i.talent_id) : null, talent_name: str(i.talent_name, 120), description: str(i.description, 300), amount: num(i.amount)
  })).filter((i) => i.description || i.amount);
  if (!items.length) fail(400, 'Add at least one line item.');
  const subtotal = sum(items), tax = num(b.tax), total = Math.round((subtotal + tax) * 100) / 100;
  const vals = [clientId, p, JSON.stringify(items), subtotal, tax, total, str(b.currency, 3).toUpperCase() || 'NGN',
    date(b.issue_date, 'Issue date', true) || today(), date(b.due_date, 'Due date', true), str(b.notes, 1000)];
  if (b.id) {
    const row = await one(`UPDATE invoices SET client_id=$1, period=$2, items=$3, subtotal=$4, tax=$5, total=$6, currency=$7, issue_date=$8, due_date=$9, notes=$10 WHERE id=$11 RETURNING id`, [...vals, int(b.id)]);
    if (!row) fail(404, 'Invoice not found.');
    return { id: row.id };
  }
  const row = await one(
    `INSERT INTO invoices (client_id, period, items, subtotal, tax, total, currency, issue_date, due_date, notes, number, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending','draft',$11) RETURNING id`, [...vals, nowIso()]);
  const number = `DP-${p.replace('-', '')}-${String(row.id).padStart(4, '0')}`;
  await query(`UPDATE invoices SET number=$1 WHERE id=$2`, [number, row.id]);
  return { id: row.id, number };
}

async function admInvoiceStatus(admin, b) {
  const status = ['draft', 'sent', 'paid'].includes(b.status) ? b.status : fail(400, 'Choose a status.');
  const col = status === 'sent' ? ', sent_at=$3' : status === 'paid' ? ', paid_at=$3' : '';
  const params = [status, int(b.id)];
  if (col) params.push(date(status === 'paid' ? b.paid_at : b.sent_at, 'Date', true) || today());
  await query(`UPDATE invoices SET status=$1${col}, updated_at='${nowIso()}' WHERE id=$2`, params);
  return { ok: true };
}

async function admDeleteInvoice(admin, b) {
  await query(`DELETE FROM invoices WHERE id=$1 AND status='draft'`, [int(b.id)]);
  return { ok: true };
}

async function admRecruitment() {
  return { rows: await query(
    `SELECT r.*, c.name AS client_name, u.name AS requested_by, f.filename FROM recruitment r JOIN clients c ON c.id = r.client_id
     LEFT JOIN users u ON u.id = r.created_by LEFT JOIN files f ON f.id = r.file_id ORDER BY r.id DESC LIMIT 300`) };
}

async function admUpdateRecruitment(admin, b) {
  const status = ['submitted', 'in_progress', 'shortlist_sent', 'filled', 'closed'].includes(b.status) ? b.status : fail(400, 'Choose a status.');
  const r = await one(`SELECT * FROM recruitment WHERE id=$1`, [int(b.id)]);
  if (!r) fail(404, 'Request not found.');
  let fileId = r.file_id;
  if (b.file) fileId = await saveFile(b.file, { client_id: r.client_id, title: `Shortlist: ${r.role_title}`, category: 'Shortlist', uploaded_by: admin.id });
  await query(`UPDATE recruitment SET status=$1, hr_note=$2, file_id=$3, updated_at=$4 WHERE id=$5`, [status, str(b.hr_note, 2000), fileId, nowIso(), r.id]);
  return { ok: true };
}

async function admFeedback() {
  return { rows: await query(
    `SELECT f.*, c.name AS client_name, t.name AS talent_name, t.client_id AS talent_client_id, u.name AS submitted_by FROM talent_feedback f
     JOIN clients c ON c.id = f.client_id LEFT JOIN users t ON t.id = f.talent_id LEFT JOIN users u ON u.id = f.created_by ORDER BY f.id DESC LIMIT 300`) };
}

async function admUpdateFeedback(admin, b) {
  const status = ['submitted', 'acknowledged', 'approved', 'declined'].includes(b.status) ? b.status : fail(400, 'Choose a status.');
  const f = await one(`SELECT * FROM talent_feedback WHERE id=$1`, [int(b.id)]);
  if (!f) fail(404, 'Not found.');
  await query(`UPDATE talent_feedback SET status=$1, hr_note=$2, updated_at=$3 WHERE id=$4`, [status, str(b.hr_note, 2000), nowIso(), f.id]);
  if (f.kind === 'removal' && status === 'approved' && b.unassign) {
    await query(`UPDATE users SET client_id=NULL WHERE id=$1 AND client_id=$2`, [f.talent_id, f.client_id]);
  }
  return { ok: true };
}

async function admFiles(admin, b) {
  const params = [];
  let where = '';
  if (b.owner_id) { where = 'WHERE f.owner_id = $1'; params.push(int(b.owner_id)); }
  else if (b.client_id) { where = 'WHERE f.client_id = $1'; params.push(int(b.client_id)); }
  return { rows: await query(
    `SELECT f.id, f.owner_id, f.client_id, f.title, f.category, f.filename, f.mime, f.size, f.created_at, u.name AS owner_name, c.name AS client_name
     FROM files f LEFT JOIN users u ON u.id = f.owner_id LEFT JOIN clients c ON c.id = f.client_id ${where} ORDER BY f.id DESC LIMIT 500`, params) };
}

async function admUploadDocument(admin, b) {
  let ownerId = b.owner_id ? int(b.owner_id) : null;
  if (!ownerId && b.owner_email) {
    const u = await one(`SELECT id FROM users WHERE email=$1`, [str(b.owner_email, 200).toLowerCase()]);
    if (!u) fail(400, 'No user with that email.');
    ownerId = u.id;
  }
  const clientId = b.client_id ? int(b.client_id) : null;
  if (!ownerId && !clientId) fail(400, 'Choose who the document is for.');
  if (!b.file) fail(400, 'Choose a file.');
  const id = await saveFile(b.file, { owner_id: ownerId, client_id: clientId, title: req(b.title, 'Title', 160), category: str(b.category, 60) || 'Document', uploaded_by: admin.id });
  return { id };
}

async function admDeleteFile(admin, b) {
  await query(`UPDATE requests SET file_id=NULL WHERE file_id=$1`, [int(b.id)]);
  await query(`UPDATE recruitment SET file_id=NULL WHERE file_id=$1`, [int(b.id)]);
  await query(`DELETE FROM files WHERE id=$1`, [int(b.id)]);
  return { ok: true };
}

async function admAnnouncements() {
  return { rows: await query(`SELECT * FROM announcements ORDER BY id DESC LIMIT 100`) };
}

async function admSaveAnnouncement(admin, b) {
  const audience = ['employees', 'clients', 'all'].includes(b.audience) ? b.audience : 'employees';
  const link = str(b.link, 300);
  if (link && !/^https?:\/\//.test(link)) fail(400, 'Links must start with https://');
  if (b.id) {
    await query(`UPDATE announcements SET message=$1, link=$2, audience=$3, active=$4 WHERE id=$5`, [req(b.message, 'Message', 280), link, audience, b.active !== false, int(b.id)]);
    return { id: int(b.id) };
  }
  const row = await one(`INSERT INTO announcements (message, link, audience, active, created_by, created_at) VALUES ($1,$2,$3,TRUE,$4,$5) RETURNING id`,
    [req(b.message, 'Message', 280), link, audience, admin.id, nowIso()]);
  return { id: row.id };
}

async function admDeleteAnnouncement(admin, b) {
  await query(`DELETE FROM announcements WHERE id=$1`, [int(b.id)]);
  return { ok: true };
}

async function admEmployeePayslip(admin, b) {
  const row = await one(`SELECT * FROM payroll WHERE id=$1`, [int(b.id)]);
  if (!row) fail(404, 'Pay record not found.');
  const u = await one(`${USER_SELECT} WHERE u.id=$1`, [row.user_id]);
  return { payslip: { ...row, earnings: json(row.earnings), deductions: json(row.deductions) }, profile: publicUser(u) };
}

async function admInvoice(admin, b) {
  const inv = await one(`SELECT * FROM invoices WHERE id=$1`, [int(b.id)]);
  if (!inv) fail(404, 'Invoice not found.');
  const client = await one(`SELECT * FROM clients WHERE id=$1`, [inv.client_id]);
  return { invoice: { ...inv, items: json(inv.items) }, client };
}

/* ================= points programme ================= */
// Edit these to change how many points each action earns and what points buy.
const EARN = {
  google_review: { label: 'Google review', points: 50 },
  ref_cv: { label: 'Referral: CV revamp client', points: 300 },
  ref_interview: { label: 'Referral: interview prep client', points: 600 },
  ref_recruitment: { label: 'Referral: recruitment client', points: 3000 }
};
const REWARDS = {
  interview_prep: { label: 'Interview preparation session', points: 1000 },
  placement: { label: 'Placement service', points: 4000 },
  cash: { label: 'Cash', min: 1000, nairaPerPoint: 5 }
};
const CHAT_EMAIL_AFTER_MIN = Number(process.env.CHAT_EMAIL_AFTER_MINUTES || 10);
const FORMS_EMAIL = process.env.FORMS_EMAIL || 'office@depitchhq.com';
const RELATIONS_EMAIL = process.env.RELATIONS_EMAIL || 'relations@depitchhq.com';
const WELCOME_POINTS = 20;
// Bookable consultation slots (WAT), Monday to Friday.
const SLOTS = ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30'];
const slotLabel = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
// Office hours: Monday to Friday, 10am to 5pm in Lagos (UTC+1, no daylight saving).
function inOfficeHours(d = new Date()) {
  const l = new Date(d.getTime() + 3600000);
  const day = l.getUTCDay(), h = l.getUTCHours();
  return day >= 1 && day <= 5 && h >= 10 && h < 17;
}
const FOLLOWUP_AFTER_HOURS = Number(process.env.FOLLOWUP_AFTER_HOURS || 2);
const NOT_ENQUIRIES = ['Early access list', 'Scoop newsletter', '10% off popup'];
async function takenSlots(day) {
  const rows = await query(`SELECT consult_time FROM enquiries WHERE service <> '' AND LEFT(consult_date, 10) = $1 AND consult_time <> '' AND closed_at = ''`, [day]);
  return rows.map((r) => r.consult_time);
}
async function pubSlots(rq, b) {
  const day = str(b.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { taken: [] };
  return { taken: await takenSlots(day) };
}
// Ask De Pitch admin on Slack to follow up on a website enquiry.
async function slackFollowUp(e, why) {
  const fields = typeof e.fields === 'string' ? json(e.fields, {}) : (e.fields || {});
  const lines = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `*${k.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())}:* ${String(v).slice(0, 500)}`);
  const ok = await postSlackFollowup(`Follow up: ${e.form} from ${e.name || e.email}`, [
    { type: 'header', text: { type: 'plain_text', text: 'Website enquiry: please follow up' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${e.form}*  ·  ${why}\n` + lines.join('\n') } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in the portal' }, url: `${assetBase()}/portal#/enquiries` }] }
  ]);
  if (ok) await query(`UPDATE enquiries SET followup_at = $1 WHERE id = $2`, [nowIso(), e.id]);
  return ok;
}
async function admEnquiryFollowUp(admin, b) {
  const e = await one(`SELECT * FROM enquiries WHERE id = $1`, [int(b.id)]);
  if (!e) fail(404, 'Not found.');
  if (!followupHook()) fail(400, 'Slack is not connected. Add SLACK_FOLLOWUP_WEBHOOK_URL (or SLACK_WEBHOOK_URL) in Vercel.');
  const ok = await slackFollowUp(e, `sent by ${admin.name || 'People Ops'}`);
  if (!ok) fail(502, 'Slack did not accept the message. Please try again.');
  return { ok: true };
}
// Website enquiries still "new" after a while, and chats nobody answered, go to Slack.
async function sweepFollowUps() {
  if (!followupHook()) return 0;
  const cutoff = new Date(Date.now() - FOLLOWUP_AFTER_HOURS * 3600000).toISOString();
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const due = await query(`SELECT * FROM enquiries WHERE status = 'new' AND followup_at = '' AND created_at < $1 AND created_at > $2 AND form NOT IN ('Early access list','Scoop newsletter','10% off popup') ORDER BY id LIMIT 5`, [cutoff, since]);
  for (const e of due) await slackFollowUp(e, `not handled after ${FOLLOWUP_AFTER_HOURS} hours`);
  return due.length;
}

function ipOf(req) { return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim(); }
async function limit(req, bucket, max, minutes) {
  const key = `${bucket}:${ipOf(req)}`;
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const c = await one(`SELECT COUNT(*)::int AS n FROM hits WHERE key = $1 AND at > $2`, [key, since]);
  if (Number(c.n) >= max) fail(429, 'Too many requests. Please wait a few minutes and try again.');
  await query(`INSERT INTO hits (key, at) VALUES ($1, $2)`, [key, nowIso()]);
  if (Math.random() < 0.05) await query(`DELETE FROM hits WHERE at < $1`, [new Date(Date.now() - 86400000).toISOString()]);
}
function normName(n) { return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function namesMatch(a, b) {
  const x = normName(a), y = normName(b);
  return x === y || (x.split(' ')[0] && x.split(' ')[0] === y.split(' ')[0]);
}
async function balanceOf(memberId) {
  const r = await one(`SELECT COALESCE(SUM(points), 0)::int AS b FROM points_ledger WHERE member_id = $1`, [memberId]);
  return Number(r.b) || 0;
}
async function pendingRedeem(memberId) {
  const r = await one(`SELECT COALESCE(SUM(points), 0)::int AS p FROM redemptions WHERE member_id = $1 AND status = 'pending'`, [memberId]);
  return Number(r.p) || 0;
}
async function findMember(name, emailAddr) {
  const m = await one(`SELECT * FROM members WHERE email = $1`, [emailAddr]);
  if (!m) return null;
  // Sign-ups that only gave an email: the first name they look up with becomes theirs.
  if (!m.name && name) { await query(`UPDATE members SET name = $1 WHERE id = $2`, [str(name, 120), m.id]); m.name = str(name, 120); return m; }
  if (!namesMatch(m.name, name)) return null;
  return m;
}
async function upsertMember(name, emailAddr, phone) {
  const m = await one(`SELECT * FROM members WHERE email = $1`, [emailAddr]);
  if (m) return m;
  return one(`INSERT INTO members (name, email, phone, created_at) VALUES ($1,$2,$3,$4) RETURNING *`, [name, emailAddr, phone || '', nowIso()]);
}
function catalogue() {
  return {
    earn: Object.entries(EARN).map(([k, v]) => ({ key: k, label: v.label, points: v.points })),
    rewards: [
      { key: 'interview_prep', label: REWARDS.interview_prep.label, points: REWARDS.interview_prep.points },
      { key: 'placement', label: REWARDS.placement.label, points: REWARDS.placement.points },
      { key: 'cash', label: `Cash: every 1,000 points = ₦${(1000 * REWARDS.cash.nairaPerPoint).toLocaleString('en-NG')}`, points: REWARDS.cash.min }
    ],
    nairaPerPoint: REWARDS.cash.nairaPerPoint
  };
}

function assetBase() {
  // Where email images and links point. Uses the live Vercel address until depitchhq.com is connected.
  if (process.env.EMAIL_ASSET_URL) return process.env.EMAIL_ASSET_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return siteUrl();
}
async function sendPointsEmail(member, points, reason) {
  if (!canEmailVisitors()) return false;
  const balance = await balanceOf(member.id);
  const base = assetBase();
  const html = pointsEmailHtml({ firstName: String(member.name).split(' ')[0], points, reason, balance, assetBase: base, siteLink: base + '/?points=1', nairaPerPoint: REWARDS.cash.nairaPerPoint });
  return sendEmail({ to: member.email, subject: `You just got ${points.toLocaleString('en-NG')} Dé Pitch points`, html, replyTo: ADMIN_EMAIL });
}

/* ---------- public (website) ---------- */
async function pubForm(rq, b) {
  if (b.hp) return { ok: true };
  await limit(rq, 'form', 12, 10);
  const form = req2(b.form, 'Form', 80);
  const raw = b.fields && typeof b.fields === 'object' ? b.fields : {};
  const fields = {};
  for (const [k, v] of Object.entries(raw).slice(0, 30)) {
    if (k.startsWith('_') || k === 'form' || k === 'page') continue;
    const val = str(v, 3000);
    if (val) fields[str(k, 60)] = val;
  }
  const pick = (re) => { const k = Object.keys(fields).find((x) => re.test(x)); return k ? fields[k] : ''; };
  const name = pick(/name/i), mail = pick(/email/i), phone = pick(/phone/i);
  if (!Object.keys(fields).length) fail(400, 'Please fill in the form.');
  let fileId = null;
  if (b.file && b.file.data) fileId = await saveFile(b.file, { title: `${form}: ${name || mail || 'website'}`, category: 'Website upload', uploaded_by: null });
  const service = SERVICE_OF_FORM[form] || '';
  const cDate = fields.date_of_consultation || '';
  const cMode = fields.mode_of_consultation || '';
  if (service && /^\d{4}-\d{2}-\d{2}$/.test(cDate)) {
    const day = new Date(cDate + 'T12:00:00Z').getUTCDay();
    if (day === 0 || day === 6) fail(400, 'We book consultations Monday to Friday. Please choose a weekday.');
  }
  const cTime = SLOTS.includes(fields.time_of_consultation) ? fields.time_of_consultation : '';
  if (fields.time_of_consultation && !cTime) fail(400, 'Please choose a time between 11am and 3pm.');
  if (cTime) {
    fields.time_of_consultation = slotLabel(cTime) + ' (WAT)';
    if ((await takenSlots(cDate)).includes(cTime)) fail(409, 'Sorry, that time was just booked. Please choose another time.');
  }
  const row = await one(`INSERT INTO enquiries (form, name, email, phone, fields, file_id, page, status, service, consult_date, consult_mode, consult_time, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8,$9,$10,$11,$12) RETURNING *`,
    [form, name, mail, phone, JSON.stringify(fields), fileId, str(b.page, 200), service, cDate, cMode, cTime, nowIso()]);
  await notify(`Website form: ${form}`, { ...fields, 'CV / file': fileId ? 'Uploaded. Open it in the portal under Website enquiries.' : '' }, NOT_ENQUIRIES.includes(form) ? RELATIONS_EMAIL : FORMS_EMAIL);
  if (!NOT_ENQUIRIES.includes(form) && !inOfficeHours()) await slackFollowUp(row, 'sent after working hours');
  await addContactFromForm(form, service, name, mail);
  return { ok: true, id: row.id };
}

function req2(v, label, max) { return req(v, label, max); }

async function pubPoints(rq, b) {
  await limit(rq, 'points', 30, 10);
  const name = req(b.name, 'Full name', 120), e = email(b.email);
  const m = await findMember(name, e);
  if (!m) return { found: false, catalogue: catalogue() };
  const balance = await balanceOf(m.id);
  const pending = await pendingRedeem(m.id);
  const history = await query(`SELECT points, reason, created_at FROM points_ledger WHERE member_id = $1 ORDER BY id DESC LIMIT 30`, [m.id]);
  const claims = await query(`SELECT type, details, status, points, hr_note, created_at FROM points_claims WHERE member_id = $1 ORDER BY id DESC LIMIT 20`, [m.id]);
  const redemptions = await query(`SELECT reward, points, cash_amount, status, hr_note, created_at FROM redemptions WHERE member_id = $1 ORDER BY id DESC LIMIT 20`, [m.id]);
  return { found: true, name: m.name, balance, available: balance - pending, history, claims: claims.map((c) => ({ ...c, details: json(c.details, {}) })), redemptions, catalogue: catalogue() };
}

async function pubPointsClaim(rq, b) {
  if (b.hp) return { ok: true };
  await limit(rq, 'claim', 8, 30);
  const name = req(b.name, 'Full name', 120), e = email(b.email);
  const type = b.type === 'google_review' ? 'google_review' : b.type === 'referral' ? 'referral' : fail(400, 'Choose what you are claiming points for.');
  let details;
  if (type === 'google_review') {
    details = { review_name: req(b.review_name, 'The name on your Google review', 120), review_link: str(b.review_link, 400), notes: str(b.notes, 1000) };
  } else {
    const svc = { cv: 'CV revamp', interview: 'Interview preparation', recruitment: 'Recruitment (company hiring)' }[b.ref_service];
    if (!svc) fail(400, 'Choose the service the person needs.');
    details = { ref_name: req(b.ref_name, 'Their full name', 120), ref_email: str(b.ref_email, 160), ref_phone: str(b.ref_phone, 40), ref_company: str(b.ref_company, 160), service: svc, service_key: b.ref_service, notes: str(b.notes, 1000) };
    if (!details.ref_email && !details.ref_phone) fail(400, 'Add their email or phone number so we can reach them.');
  }
  const m = await upsertMember(name, e, str(b.phone, 40));
  await query(`INSERT INTO points_claims (member_id, type, details, status, created_at, updated_at) VALUES ($1,$2,$3,'pending',$4,$4)`, [m.id, type, JSON.stringify(details), nowIso()]);
  await notifyHR(type === 'google_review' ? `Points claim: Google review by ${name}` : `New referral from ${name}`, { Name: name, Email: e, ...Object.fromEntries(Object.entries(details).filter(([k]) => k !== 'service_key')) });
  return { ok: true };
}

async function pubRedeem(rq, b) {
  await limit(rq, 'redeem', 6, 30);
  const name = req(b.name, 'Full name', 120), e = email(b.email);
  const m = await findMember(name, e);
  if (!m) fail(400, 'We could not find points for that name and email.');
  const reward = REWARDS[b.reward] ? b.reward : fail(400, 'Choose a reward.');
  const available = (await balanceOf(m.id)) - (await pendingRedeem(m.id));
  let points, cash = 0, details = str(b.details, 600);
  if (reward === 'cash') {
    points = Math.floor(int(b.points) / 1000) * 1000;
    if (points < REWARDS.cash.min) fail(400, 'Cash redemptions start at 1,000 points, in steps of 1,000.');
    cash = points * REWARDS.cash.nairaPerPoint;
    if (!details) fail(400, 'Add the bank name, account number and account name for the payment.');
  } else points = REWARDS[reward].points;
  if (points > available) fail(400, `You need ${points.toLocaleString('en-NG')} points for this. You have ${available.toLocaleString('en-NG')} available.`);
  await query(`INSERT INTO redemptions (member_id, reward, points, cash_amount, details, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'pending',$6,$6)`, [m.id, reward, points, cash, details, nowIso()]);
  await notifyHR(`Points redemption request from ${m.name}`, { Name: m.name, Email: m.email, Reward: REWARDS[reward].label, Points: points, 'Cash (₦)': cash || '', Details: details });
  return { ok: true };
}

async function chatByToken(token) {
  const t = str(token, 80);
  if (t.length < 20) fail(404, 'Chat not found.');
  const c = await one(`SELECT * FROM chats WHERE token = $1`, [t]);
  if (!c) fail(404, 'Chat not found.');
  return c;
}
async function chatMessages(chatId, after = 0) {
  return query(`SELECT id, sender, body, created_at FROM chat_messages WHERE chat_id = $1 AND id > $2 ORDER BY id LIMIT 200`, [chatId, int(after)]);
}

async function pubChatStart(rq, b) {
  if (b.hp) return { ok: true };
  await limit(rq, 'chatstart', 5, 30);
  const name = req(b.name, 'Your name', 120), e = email(b.email), msg = req(b.message, 'Message', 2000);
  const token = crypto.randomBytes(24).toString('base64url');
  const at = nowIso();
  const c = await one(`INSERT INTO chats (token, name, email, page, status, last_visitor_msg, visitor_seen, created_at) VALUES ($1,$2,$3,$4,'open',$5,$5,$5) RETURNING id`, [token, name, e, str(b.page, 200), at]);
  await query(`INSERT INTO chat_messages (chat_id, sender, body, created_at) VALUES ($1,'visitor',$2,$3)`, [c.id, msg, at]);
  await sweepChats();
  return { token, messages: await chatMessages(c.id) };
}

async function pubChatSend(rq, b) {
  await limit(rq, 'chatsend', 40, 10);
  const c = await chatByToken(b.token);
  const msg = req(b.message, 'Message', 2000);
  const at = nowIso();
  await query(`INSERT INTO chat_messages (chat_id, sender, body, created_at) VALUES ($1,'visitor',$2,$3)`, [c.id, msg, at]);
  await query(`UPDATE chats SET last_visitor_msg = $1, visitor_seen = $1, status = 'open' WHERE id = $2`, [at, c.id]);
  await sweepChats();
  return { messages: await chatMessages(c.id, b.after) };
}

async function pubChatPoll(rq, b) {
  const c = await chatByToken(b.token);
  await query(`UPDATE chats SET visitor_seen = $1 WHERE id = $2`, [nowIso(), c.id]);
  if (Math.random() < 0.2) await sweepChats();
  return { messages: await chatMessages(c.id, b.after), name: c.name, status: c.status };
}

// Email People Ops about chats nobody has answered for a while.
async function sweepChats() {
  const cutoff = new Date(Date.now() - CHAT_EMAIL_AFTER_MIN * 60000).toISOString();
  const due = await query(
    `SELECT * FROM chats WHERE status = 'open' AND last_visitor_msg > last_staff_msg AND last_visitor_msg < $1 AND emailed_at < last_visitor_msg ORDER BY id LIMIT 5`, [cutoff]);
  let n = 0;
  for (const c of due) {
    await query(`UPDATE chats SET emailed_at = $1 WHERE id = $2`, [nowIso(), c.id]);
    const msgs = (await chatMessages(c.id)).slice(-15);
    const transcript = msgs.map((m) => `${m.sender === 'visitor' ? c.name : 'Dé Pitch'}: ${m.body}`).join('\n\n');
    await notifyHR(`Unanswered website chat from ${c.name}`, { Name: c.name, Email: c.email, 'Waiting since': c.last_visitor_msg.replace('T', ' ').slice(0, 16) + ' UTC', Conversation: transcript, Reply: 'Open the portal → Live chat to reply. Your reply appears in their chat window.' });
    await postSlackFollowup(`Follow up: unanswered chat from ${c.name}`, [
      { type: 'header', text: { type: 'plain_text', text: 'Website chat: please follow up' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Name:* ${c.name}\n*Email:* ${c.email}\n*Waiting since:* ${c.last_visitor_msg.replace('T', ' ').slice(0, 16)} UTC${inOfficeHours() ? '' : ' (after hours)'}\n\n${transcript.slice(-2500)}` } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Reply in the portal' }, url: `${assetBase()}/portal#/chat` }] }
    ]);
    n++;
  }
  n += await sweepFollowUps();
  n += await sweepReportReminders();
  return n;
}

/* ---------- employee referrals ---------- */
async function empReferrals(u) {
  return { rows: await query(`SELECT * FROM referrals WHERE user_id = $1 ORDER BY id DESC`, [u.id]) };
}
async function empSubmitReferral(u, b) {
  const kind = b.kind === 'client' ? 'client' : b.kind === 'candidate' ? 'candidate' : fail(400, 'Choose who you are referring.');
  const name = req(b.name, kind === 'client' ? 'Contact name' : 'Candidate name', 160);
  const mail = str(b.email, 160), phone = str(b.phone, 40);
  if (!mail && !phone) fail(400, 'Add an email or phone number.');
  await query(`INSERT INTO referrals (user_id, kind, name, email, phone, company, role, notes, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9,$9)`,
    [u.id, kind, name, mail, phone, str(b.company, 160), str(b.role, 160), str(b.notes, 2000), nowIso()]);
  await notifyHR(`New ${kind} referral from ${u.name}`, { 'Referred by': u.name, Type: kind, Name: name, Email: mail, Phone: phone, Company: b.company || '', Role: b.role || '', Notes: b.notes || '' });
  return { ok: true };
}

/* ---------- admin: enquiries, referrals, points, chat ---------- */
async function admEnquiries(admin, b) {
  const st = str(b.status, 20);
  const rows = await query(`SELECT e.*, f.filename FROM enquiries e LEFT JOIN files f ON f.id = e.file_id ${st ? 'WHERE e.status = $1' : ''} ORDER BY e.id DESC LIMIT 500`, st ? [st] : []);
  return { rows: rows.map((r) => ({ ...r, fields: json(r.fields, {}) })) };
}
async function admDeleteService(admin, b) {
  await query(`DELETE FROM enquiries WHERE id = $1 AND service <> ''`, [int(b.id)]);
  return { ok: true };
}
async function admEnquiryStatus(admin, b) {
  await query(`UPDATE enquiries SET status = $1 WHERE id = $2`, [b.status === 'handled' ? 'handled' : 'new', int(b.id)]);
  return { ok: true };
}
async function admReferrals() {
  return { rows: await query(`SELECT r.*, u.name AS employee FROM referrals r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 500`) };
}
async function admUpdateReferral(admin, b) {
  const status = ['submitted', 'contacted', 'in_progress', 'placed', 'signed', 'unsuccessful'].includes(b.status) ? b.status : fail(400, 'Choose a status.');
  await query(`UPDATE referrals SET status = $1, hr_note = $2, reward = $3, updated_at = $4 WHERE id = $5`, [status, str(b.hr_note, 1000), str(b.reward, 200), nowIso(), int(b.id)]);
  return { ok: true };
}
async function admPoints() {
  const members = await query(`SELECT m.*, COALESCE((SELECT SUM(points) FROM points_ledger l WHERE l.member_id = m.id), 0)::int AS balance FROM members m ORDER BY m.id DESC LIMIT 500`);
  const claims = await query(`SELECT c.*, m.name, m.email FROM points_claims c JOIN members m ON m.id = c.member_id ORDER BY (c.status = 'pending') DESC, c.id DESC LIMIT 300`);
  const redemptions = await query(`SELECT r.*, m.name, m.email FROM redemptions r JOIN members m ON m.id = r.member_id ORDER BY (r.status = 'pending') DESC, r.id DESC LIMIT 300`);
  return { members, claims: claims.map((c) => ({ ...c, details: json(c.details, {}) })), redemptions, catalogue: catalogue(), emailsOn: canEmailVisitors() };
}
function thanksFor(kind, custom) {
  if (kind === 'google_review') return 'your Google review';
  if (kind && kind.startsWith('ref_')) return 'your referral';
  return custom ? custom.charAt(0).toLowerCase() + custom.slice(1) : 'being part of Dé Pitch rewards';
}
async function awardTo(admin, member, points, kind, reason, emailReason) {
  await query(`INSERT INTO points_ledger (member_id, points, kind, reason, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [member.id, points, kind, reason, admin.id, nowIso()]);
  return points > 0 ? sendPointsEmail(member, points, emailReason || thanksFor(kind, reason)) : false;
}
async function admReviewClaim(admin, b) {
  const c = await one(`SELECT * FROM points_claims WHERE id = $1`, [int(b.id)]);
  if (!c) fail(404, 'Claim not found.');
  if (c.status !== 'pending') fail(400, 'This claim has already been decided.');
  const status = b.status === 'approved' ? 'approved' : b.status === 'declined' ? 'declined' : fail(400, 'Choose a decision.');
  let emailed = false;
  if (status === 'approved') {
    const kind = EARN[b.kind] ? b.kind : fail(400, 'Choose what the points are for.');
    const points = int(b.points) || EARN[kind].points;
    if (points <= 0 || points > 100000) fail(400, 'Enter the points to award.');
    const m = await one(`SELECT * FROM members WHERE id = $1`, [c.member_id]);
    const d = json(c.details, {});
    const reason = kind === 'google_review' ? 'Google review' : `Referred ${d.ref_name || 'a client'} (${EARN[kind].label.replace('Referral: ', '')})`;
    const emailReason = kind === 'google_review' ? 'your Google review' : `referring ${d.ref_name || 'someone'} to us`;
    emailed = await awardTo(admin, m, points, kind, reason, emailReason);
    await query(`UPDATE points_claims SET status = 'approved', points = $1, hr_note = $2, updated_at = $3 WHERE id = $4`, [points, str(b.hr_note, 500), nowIso(), c.id]);
  } else {
    await query(`UPDATE points_claims SET status = 'declined', hr_note = $1, updated_at = $2 WHERE id = $3`, [str(b.hr_note, 500), nowIso(), c.id]);
  }
  return { ok: true, emailed };
}
async function admAwardPoints(admin, b) {
  const e = email(b.email);
  const name = req(b.name, 'Name', 120);
  const kind = EARN[b.kind] ? b.kind : 'adjustment';
  const points = int(b.points) || (EARN[kind] ? EARN[kind].points : 0);
  if (!points || Math.abs(points) > 100000) fail(400, 'Enter the points.');
  const m = await upsertMember(name, e, '');
  const reason = str(b.reason, 200) || (EARN[kind] ? EARN[kind].label : 'Points adjustment');
  const emailed = await awardTo(admin, m, points, kind, reason);
  return { ok: true, emailed };
}
async function admUpdateRedemption(admin, b) {
  const r = await one(`SELECT * FROM redemptions WHERE id = $1`, [int(b.id)]);
  if (!r) fail(404, 'Request not found.');
  const status = ['pending', 'approved', 'fulfilled', 'declined'].includes(b.status) ? b.status : fail(400, 'Choose a status.');
  const wasDeducted = r.status === 'approved' || r.status === 'fulfilled';
  const deduct = status === 'approved' || status === 'fulfilled';
  if (!wasDeducted && deduct) {
    const bal = await balanceOf(r.member_id);
    if (bal < r.points) fail(400, `Not enough points. Balance is ${bal}.`);
    await query(`INSERT INTO points_ledger (member_id, points, kind, reason, created_by, created_at) VALUES ($1,$2,'redemption',$3,$4,$5)`,
      [r.member_id, -r.points, `Redeemed: ${REWARDS[r.reward] ? REWARDS[r.reward].label : r.reward}${r.cash_amount ? ' (₦' + Number(r.cash_amount).toLocaleString('en-NG') + ')' : ''}`, admin.id, nowIso()]);
  }
  if (wasDeducted && !deduct) {
    await query(`INSERT INTO points_ledger (member_id, points, kind, reason, created_by, created_at) VALUES ($1,$2,'refund','Redemption reversed',$3,$4)`, [r.member_id, r.points, admin.id, nowIso()]);
  }
  await query(`UPDATE redemptions SET status = $1, hr_note = $2, updated_at = $3 WHERE id = $4`, [status, str(b.hr_note, 500), nowIso(), r.id]);
  return { ok: true };
}
async function admChats(admin, b) {
  const rows = await query(`SELECT c.id, c.name, c.email, c.page, c.status, c.last_visitor_msg, c.last_staff_msg, c.visitor_seen, c.staff_read, c.created_at,
      (SELECT body FROM chat_messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT COUNT(*)::int FROM chat_messages m WHERE m.chat_id = c.id AND m.sender = 'visitor' AND m.created_at > c.staff_read) AS unread
    FROM chats c ORDER BY (c.status = 'open') DESC, GREATEST(c.last_visitor_msg, c.last_staff_msg) DESC LIMIT 200`);
  return { rows };
}
async function admChat(admin, b) {
  const c = await one(`SELECT * FROM chats WHERE id = $1`, [int(b.id)]);
  if (!c) fail(404, 'Chat not found.');
  await query(`UPDATE chats SET staff_read = $1 WHERE id = $2`, [nowIso(), c.id]);
  const { token, ...safe } = c;
  return { chat: safe, messages: await chatMessages(c.id, b.after), online: c.visitor_seen > new Date(Date.now() - 60000).toISOString() };
}
async function admChatReply(admin, b) {
  const c = await one(`SELECT * FROM chats WHERE id = $1`, [int(b.id)]);
  if (!c) fail(404, 'Chat not found.');
  const msg = req(b.message, 'Reply', 3000);
  const at = nowIso();
  await query(`INSERT INTO chat_messages (chat_id, sender, body, staff_id, created_at) VALUES ($1,'staff',$2,$3,$4)`, [c.id, msg, admin.id, at]);
  await query(`UPDATE chats SET last_staff_msg = $1, staff_read = $1, status = 'open' WHERE id = $2`, [at, c.id]);
  let emailed = false;
  const away = !c.visitor_seen || c.visitor_seen < new Date(Date.now() - 2 * 60000).toISOString();
  if (away && c.email && canEmailVisitors()) {
    emailed = await sendEmail({
      to: c.email, replyTo: ADMIN_EMAIL, subject: 'Dé Pitch replied to your message',
      html: layout('We replied to your message', `<p style="font-size:15px;line-height:1.6">Hi ${escapeHtml(String(c.name).split(' ')[0])},</p>
        <div style="background:#f4f6f7;border-radius:8px;padding:14px 16px;font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(msg)}</div>
        <p style="font-size:14px;line-height:1.6;margin-top:16px">You can reply to this email, or continue the conversation in the chat on our website.</p>
        <p><a href="${siteUrl()}" style="background:#011D38;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open depitchhq.com</a></p>`)
    });
  }
  return { ok: true, emailed };
}
async function admChatStatus(admin, b) {
  await query(`UPDATE chats SET status = $1 WHERE id = $2`, [b.status === 'closed' ? 'closed' : 'open', int(b.id)]);
  return { ok: true };
}
async function admTestPointsEmail(admin, b) {
  if (!canEmailVisitors()) fail(400, 'Add RESEND_API_KEY in Vercel first.');
  const to = email(b.email || admin.email);
  const base = assetBase();
  const html = pointsEmailHtml({ firstName: 'there', points: 50, reason: 'your Google review', balance: 1350, assetBase: base, siteLink: base + '/?points=1', nairaPerPoint: REWARDS.cash.nairaPerPoint });
  const ok = await sendEmail({ to, subject: 'TEST: You just got 50 Dé Pitch points', html, replyTo: ADMIN_EMAIL });
  if (!ok) fail(502, 'Resend did not accept the email. Check that depitchhq.com is verified in Resend, or send the test to the email you signed up to Resend with.');
  return { ok: true };
}
async function admSettings() {
  return { emailsOn: canEmailVisitors(), chatEmailAfter: CHAT_EMAIL_AFTER_MIN, formsEmail: FORMS_EMAIL };
}

const PUBLIC = {
  'public.form': pubForm, 'public.slots': pubSlots, 'public.points': pubPoints, 'public.pointsClaim': pubPointsClaim, 'public.redeem': pubRedeem,
  'public.chatStart': pubChatStart, 'public.chatSend': pubChatSend, 'public.chatPoll': pubChatPoll
};

/* ================= services tracker (consultations, CV revamp, interview prep, recruitment) ================= */
const SERVICE_OF_FORM = {
  'Free career consultation': 'consultation',
  'CV Revamp request': 'cv', 'Interview prep booking': 'interview',
  'Recruitment request': 'recruitment', 'Human capital consultation': 'hcm'
};
const SERVICE_LABEL = { consultation: 'Free consultation', cv: 'CV revamp', interview: 'Interview prep', recruitment: 'Recruitment', hcm: 'Human capital' };
const INTEREST_LABEL = { cv: 'CV revamp', interview: 'Interview prep', recruitment: 'Recruitment', hcm: 'Human capital', unsure: 'Not sure yet' };
const REVIEW_STATUS = ['', 'pending', 'approved', 'changes'];
function stageOf(e) {
  if (e.closed_at) return 'closed';
  if (e.delivered_at) return 'delivered';
  if (e.service === 'cv' && e.done_at) return e.review_status === 'approved' ? 'approved' : e.review_status === 'changes' ? 'changes' : 'review';
  if (e.done_at) return 'done';
  if (e.service === 'interview' && e.session_date) return 'session';
  if (e.paid_at) return 'paid';
  if (e.consult_done_at) return 'consulted';
  if (e.consult_date) return 'scheduled';
  return 'new';
}
// Follow-ups (website enquiries and unanswered chats) can go to their own channel via SLACK_FOLLOWUP_WEBHOOK_URL;
// otherwise they share the main channel with CV reviews.
const followupHook = () => process.env.SLACK_FOLLOWUP_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
function postSlackFollowup(text, blocks) { return postSlack(text, blocks, followupHook()); }
async function postSlack(text, blocks, hook) {
  const url = hook || process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, blocks }), signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch (e) { return false; }
}
function reviewSig(id, token) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev').update(`cvreview:${id}:${token}`).digest('hex').slice(0, 40);
}
async function sendForReview(e) {
  const base = assetBase();
  const label = SERVICE_LABEL[e.service] || 'Service';
  // A fresh token for every send, so links from an older version of the CV stop working.
  const token = crypto.randomBytes(12).toString('hex');
  await query(`UPDATE enquiries SET review_token = $1 WHERE id = $2`, [token, e.id]);
  const link = `${base}/api/portal?review=${e.id}&k=${reviewSig(e.id, token)}`;
  const lines = [
    `*Client:* ${e.name || '—'} (${e.email || 'no email'}${e.phone ? ', ' + e.phone : ''})`,
    `*Paid:* ${e.paid_at ? 'Yes (' + e.paid_at + ')' : 'Not yet'}`,
    e.consult_done_at ? `*Consultation held:* ${e.consult_done_at}` : '',
    `*CV finished:* ${e.done_at}`,
    e.track_notes ? `*Notes:* ${e.track_notes}` : ''
  ].filter(Boolean);
  const text = `${label} ready for review: ${e.name || e.email}`;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${label} ready for review` } },
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    { type: 'section', text: { type: 'mrkdwn', text: (e.result_file_id ? `:page_facing_up: <${link}&view=cv|Open the CV>     ` : '') + `:white_check_mark: <${link}|Approve or request changes>` } }
  ];
  return postSlack(text, blocks);
}

function reviewPage(res, status, title, inner) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | Dé Pitch</title>
<style>body{margin:0;background:#f4f2ee;font:16px/1.55 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#1a1a1a}main{max-width:560px;margin:40px auto;padding:0 16px}
.card{background:#fff;border-radius:18px;padding:28px}h1{font-size:1.5rem;margin:0 0 6px}p{margin:.4rem 0}.muted{color:#6b6b6b;font-size:.92rem}
a.file{display:inline-block;margin:14px 0;color:#011D38;font-weight:600}textarea{width:100%;box-sizing:border-box;min-height:110px;border:1px solid #d8d4cc;border-radius:10px;padding:10px;font:inherit}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}button{border:0;border-radius:999px;padding:12px 22px;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer}
.ok{background:#1f7a4d;color:#fff}.ch{background:#fff;border:1px solid #1a1a1a;color:#1a1a1a}.pill{display:inline-block;padding:3px 10px;border-radius:999px;background:#eeeae3;font-size:.85rem}
img{width:110px;display:block;margin-bottom:18px}</style></head><body><main><img src="/assets/images/image07.png" alt="dé pitch"><div class="card">${inner}</div></main></body></html>`);
}

async function readForm(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!raw && req.body === undefined) { const chunks = []; for await (const c of req) chunks.push(c); raw = Buffer.concat(chunks).toString('utf8'); }
  return Object.fromEntries(new URLSearchParams(raw));
}

// The page the head of the company opens from Slack to approve a CV or ask for changes.
async function handleReview(req, res, url) {
  const id = int(url.searchParams.get('review'));
  const k = String(url.searchParams.get('k') || '');
  const e = id ? await one(`SELECT * FROM enquiries WHERE id = $1`, [id]) : null;
  const valid = e && e.review_token && k.length === 40 && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(reviewSig(e.id, e.review_token)));
  if (!valid) return reviewPage(res, 404, 'Link expired', '<h1>This link has expired</h1><p class="muted">A newer version of this CV may have been sent for review. Use the latest message in Slack.</p>');
  if (url.searchParams.get('view') === 'cv') {
    if (!e.result_file_id) return reviewPage(res, 404, 'No file', '<h1>No CV attached</h1><p class="muted">People Ops did not upload the finished CV with this one.</p>');
    return downloadFile(res, { id: 0, role: 'admin' }, e.result_file_id, false);
  }
  const who = escapeHtml(e.name || e.email);
  const self = `/api/portal?review=${e.id}&k=${k}`;
  if (req.method === 'POST') {
    const f = await readForm(req);
    const decision = f.decision === 'approved' ? 'approved' : f.decision === 'changes' ? 'changes' : '';
    const note = str(f.note, 2000);
    if (!decision) return reviewPage(res, 400, 'Choose', '<h1>Please choose Approve or Request changes.</h1>');
    if (decision === 'changes' && !note) return reviewPage(res, 400, 'Add a note', `<h1>What should change?</h1><p class="muted">Please go back and write what needs changing, so People Ops can fix it.</p><p><a href="${self}">Back</a></p>`);
    if (e.delivered_at || e.closed_at) return reviewPage(res, 200, 'Already done', `<h1>Nothing to change</h1><p class="muted">${who}'s CV has already been ${e.delivered_at ? 'delivered' : 'closed'}.</p>`);
    await query(`UPDATE enquiries SET review_status = $1, review_note = $2, reviewed_at = $3, updated_at = $3 WHERE id = $4`, [decision, note, nowIso(), e.id]);
    const label = decision === 'approved' ? 'approved' : 'needs changes';
    await notify(`CV ${label}: ${e.name || e.email}`, { Client: `${e.name} (${e.email})`, Decision: decision === 'approved' ? 'Approved. You can now deliver it to the client.' : 'Changes requested', Note: note });
    await postSlack(`${decision === 'approved' ? ':white_check_mark: Approved' : ':pencil2: Changes requested'}: ${e.name || e.email}'s CV${note ? '\n>' + note.replace(/\n/g, '\n>') : ''}`);
    return reviewPage(res, 200, 'Thank you', decision === 'approved'
      ? `<h1>Approved</h1><p>${who}'s CV is approved. People Ops has been told and can now deliver it.</p>`
      : `<h1>Changes requested</h1><p>People Ops has your note and will send the updated CV back to Slack.</p>`);
  }
  const status = e.review_status === 'approved' ? 'Approved' : e.review_status === 'changes' ? 'Changes requested' : 'Awaiting review';
  return reviewPage(res, 200, 'Review CV', `<h1>Review ${who}'s CV</h1>
    <p class="muted">CV revamp · finished ${escapeHtml(e.done_at)} · ${e.paid_at ? 'paid' : 'not paid yet'}</p><p><span class="pill">${status}</span></p>
    ${e.track_notes ? `<p class="muted">People Ops notes: ${escapeHtml(e.track_notes)}</p>` : ''}
    ${e.result_file_id ? `<a class="file" href="${self}&view=cv" target="_blank" rel="noopener">Open the CV</a>` : '<p class="muted">No file was attached.</p>'}
    <form method="POST" action="${self}">${e.review_status === 'changes' && e.review_note ? `<p class="muted">Your last note: ${escapeHtml(e.review_note)}</p>` : ''}<label for="note">Note for People Ops (needed if you request changes)</label>
    <textarea id="note" name="note" placeholder="e.g. Shorten the summary and add the latest role"></textarea>
    <div class="row"><button class="ok" name="decision" value="approved">Approve</button><button class="ch" name="decision" value="changes">Request changes</button></div></form>`);
}

async function admServices() {
  const rows = await query(`SELECT e.*, f.filename, rf.filename AS result_filename FROM enquiries e
    LEFT JOIN files f ON f.id = e.file_id LEFT JOIN files rf ON rf.id = e.result_file_id
    WHERE e.service <> '' ORDER BY e.id DESC LIMIT 1000`);
  return { rows: rows.map((r) => ({ ...r, fields: json(r.fields, {}), stage: stageOf(r) })), slackOn: !!process.env.SLACK_WEBHOOK_URL, labels: SERVICE_LABEL, interests: INTEREST_LABEL };
}

async function admSaveService(admin, b) {
  const id = int(b.id);
  const e = id ? await one(`SELECT * FROM enquiries WHERE id = $1`, [id]) : null;
  if (id && !e) fail(404, 'Not found.');
  const service = SERVICE_LABEL[b.service] ? b.service : (e ? e.service : fail(400, 'Choose a service.'));
  const d = (k, label) => date(b[k], label, true);
  const today = new Date().toISOString().slice(0, 10);
  const vals = {
    consult_date: str(b.consult_date, 16).replace('T', ' '), consult_mode: str(b.consult_mode, 40),
    consult_time: SLOTS.includes(b.consult_time) || /^\d{2}:\d{2}$/.test(b.consult_time || '') ? b.consult_time : '',
    consult_done_at: d('consult_done_at', 'Consultation date'),
    paid_at: service === 'consultation' ? '' : b.paid ? ((e && e.paid_at) || today) : '',
    session_date: service === 'interview' ? d('session_date', 'Session date') : '',
    interest: service === 'consultation' && INTEREST_LABEL[b.interest] ? b.interest : '',
    done_at: d('done_at', 'Completed date'), closed_at: d('closed_at', 'Closed date'),
    review_status: REVIEW_STATUS.includes(b.review_status) ? b.review_status : ((e && e.review_status) || ''),
    track_notes: str(b.track_notes, 2000)
  };
  if (service === 'consultation') vals.done_at = '';
  if (service === 'cv' && !vals.done_at) vals.review_status = '';
  // A CV can only be marked delivered once the review has approved it.
  vals.delivered_at = service === 'cv' ? (vals.review_status === 'approved' ? d('delivered_at', 'Delivered date') : '') : '';
  const reviewedAt = vals.review_status !== ((e && e.review_status) || '') && ['approved', 'changes'].includes(vals.review_status) ? nowIso() : ((e && e.reviewed_at) || '');
  let resultFile = e ? e.result_file_id : null;
  let newId = id;
  if (!e) {
    const name = req(b.name, 'Name', 120);
    const row = await one(`INSERT INTO enquiries (form, name, email, phone, fields, status, service, created_at) VALUES ('Added by People Ops',$1,$2,$3,'{}','handled',$4,$5) RETURNING id`,
      [name, str(b.email, 160).toLowerCase(), str(b.phone, 40), service, nowIso()]);
    newId = row.id;
  }
  if (b.file) resultFile = await saveFile(b.file, { title: `Finished ${SERVICE_LABEL[service]}: ${b.name || (e && e.name) || ''}`, category: service === 'cv' ? 'Finished CV' : 'Service file', uploaded_by: admin.id });
  await query(`UPDATE enquiries SET service=$1, consult_date=$2, consult_mode=$3, consult_done_at=$4, paid_at=$5, session_date=$6, interest=$7, done_at=$8, delivered_at=$9,
      closed_at=$10, track_notes=$11, result_file_id=$12, review_status=$13, reviewed_at=$14, status='handled', updated_at=$15, consult_time=$17 WHERE id=$16`,
    [service, vals.consult_date, vals.consult_mode, vals.consult_done_at, vals.paid_at, vals.session_date, vals.interest, vals.done_at, vals.delivered_at,
      vals.closed_at, vals.track_notes, resultFile, vals.review_status, reviewedAt, nowIso(), newId, vals.consult_time]);
  let fresh = await one(`SELECT * FROM enquiries WHERE id = $1`, [newId]);
  let slack = null;
  const justDone = fresh.done_at && (!e || !e.done_at);
  if (service === 'cv' && ((justDone && !fresh.review_sent_at) || b.resend)) {
    slack = await sendForReview(fresh);
    // Sending (or re-sending after changes) puts the CV back into "awaiting review".
    await query(`UPDATE enquiries SET review_status = 'pending'${slack ? ', review_sent_at = $2' : ''} WHERE id = $1`, slack ? [newId, nowIso()] : [newId]);
    fresh = await one(`SELECT * FROM enquiries WHERE id = $1`, [newId]);
  } else if (service === 'cv' && justDone) {
    await query(`UPDATE enquiries SET review_status = 'pending' WHERE id = $1`, [newId]);
    fresh = await one(`SELECT * FROM enquiries WHERE id = $1`, [newId]);
  }
  return { id: newId, stage: stageOf(fresh), slack, slackOn: !!process.env.SLACK_WEBHOOK_URL };
}


/* ================= email marketing (People Ops and Media) ================= */
const TAGS = ['Jobseeker Client', 'Recruitment Client', 'Partnership', 'Employee', 'Co Founder', 'Subscriber'];
const SEGMENTS = [
  ['all', 'Everyone'], ['clients', 'All clients (general)'], ['tag:Jobseeker Client', 'Job seeker clients'], ['tag:Recruitment Client', 'Recruitment clients'],
  ['tag:Partnership', 'Partnership'], ['tag:Employee', 'Employees'], ['tag:Co Founder', 'Co-founders'], ['tag:Subscriber', 'Newsletter subscribers']
];
function normTag(t) {
  const x = str(t, 60).replace(/\s+/g, ' ');
  if (!x) return '';
  const k = x.toLowerCase().replace(/[^a-z]/g, '');
  if (/^jobseeker|^jobseekers/.test(k)) return 'Jobseeker Client';
  if (/^recruitment/.test(k)) return 'Recruitment Client';
  if (/^partner/.test(k) || k === 'collab' || k === 'collaboration') return 'Partnership';
  if (/^employee|^staff|^talent$/.test(k)) return 'Employee';
  if (/^cofounder|^founder/.test(k)) return 'Co Founder';
  if (/^subscriber|^newsletter/.test(k)) return 'Subscriber';
  return TAGS.find((t) => t.toLowerCase() === x.toLowerCase()) || x.replace(/\b\w/g, (c) => c.toUpperCase());
}
// People Ops only emails the internal team; Media (relations@) has the full audience.
const INTERNAL_TAGS = ['Employee', 'Co Founder'];
const internalOnly = (u) => u && u.role === 'admin';
const isInternal = (c) => tagsOf(c).some((t) => INTERNAL_TAGS.includes(t));
const allowedAudience = (u, aud) => (Array.isArray(aud) ? aud : []).filter((s) => !internalOnly(u) || INTERNAL_TAGS.includes(String(s).replace(/^tag:/, '')));
const tagList = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,;|]/)).map(normTag).filter(Boolean))];
const tagsOf = (c) => String(c.tags || '').split(',').filter(Boolean);
function matchesAudience(c, aud) {
  if (c.status !== 'subscribed') return false;
  const segs = Array.isArray(aud) ? aud : [];
  const t = tagsOf(c);
  return segs.some((s) => s === 'all' || (s === 'clients' && t.some((x) => /client/i.test(x))) || (s.startsWith('tag:') && t.includes(s.slice(4))));
}
const mktSig = (s) => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev').update(s).digest('hex').slice(0, 32);
const unsubUrl = (id) => `${assetBase()}/api/portal?unsub=${id}&k=${mktSig('unsub:' + id)}`;
const pixelUrl = (cid, id) => `${assetBase()}/api/portal?o=${cid}.${id}.${mktSig('open:' + cid + ':' + id)}`;

async function upsertContact({ email: mail, first_name, last_name, tags, source }) {
  let e;
  try { e = email(mail); } catch (x) { return 'skipped'; }
  const now = nowIso();
  const ex = await one(`SELECT * FROM contacts WHERE email = $1`, [e]);
  const add = tagList(tags);
  if (!ex) {
    await query(`INSERT INTO contacts (email, first_name, last_name, tags, status, source, created_at, updated_at) VALUES ($1,$2,$3,$4,'subscribed',$5,$6,$6)`,
      [e, str(first_name, 80), str(last_name, 80), add.join(','), str(source, 60), now]);
    return 'added';
  }
  const merged = [...new Set([...tagsOf(ex), ...add])].join(',');
  await query(`UPDATE contacts SET tags = $1, first_name = COALESCE(NULLIF(first_name, ''), $2), last_name = COALESCE(NULLIF(last_name, ''), $3), updated_at = $4 WHERE id = $5`,
    [merged, str(first_name, 80), str(last_name, 80), now, ex.id]);
  return 'updated';
}
function splitName(n) { const p = str(n, 160).split(/\s+/).filter(Boolean); return { first_name: p[0] || '', last_name: p.slice(1).join(' ') }; }

// Sign-ups from the website join the audience: newsletter forms as subscribers, collab requests as partnerships.
async function addContactFromForm(form, service, name, mail) {
  const tag = ['Early access list', 'Scoop newsletter', '10% off popup'].includes(form) ? 'Subscriber' : form === 'Collab request' ? 'Partnership' : '';
  if (!tag || !mail) return;
  try {
    await upsertContact({ email: mail, ...splitName(name), tags: [tag], source: form });
    if (tag === 'Subscriber') await sendWelcome(mail, name, form);
  } catch (e) { console.error('contact', e.message); }
}

// Newsletter welcome: a free career consultation and a 20-point head start, sent once per person.
async function sendWelcome(mail, name, form) {
  const c = await one(`SELECT * FROM contacts WHERE email = $1`, [String(mail).toLowerCase()]);
  if (!c || c.status !== 'subscribed' || c.welcomed_at) return false;
  await query(`UPDATE contacts SET welcomed_at = $1 WHERE id = $2`, [nowIso(), c.id]);
  const member = await upsertMember(str(name, 120), c.email, '');
  const had = await one(`SELECT id FROM points_ledger WHERE member_id = $1 AND kind = 'welcome'`, [member.id]);
  if (!had) await query(`INSERT INTO points_ledger (member_id, points, kind, reason, created_by, created_at) VALUES ($1,$2,'welcome','Newsletter welcome gift',NULL,$3)`, [member.id, WELCOME_POINTS, nowIso()]);
  if (!canEmailVisitors()) return false;
  const first = c.first_name || splitName(name).first_name;
  const content = {};
  if (!first) content.headline = 'Welcome to Dé Pitch';
  if (form === '10% off popup') content.gift = 'Free career consultation\n20 points head start\n10% off your first service';
  const html = renderCampaign('welcome', content, { firstName: first || 'there', assetBase: assetBase(), siteUrl: assetBase(), preheader: 'Your welcome gift: a free career consultation and 20 points.', unsubUrl: unsubUrl(c.id) });
  return sendEmail({ to: c.email, subject: first ? `Welcome to Dé Pitch, ${first}. Your gift is inside` : 'Welcome to Dé Pitch. Your gift is inside', html, replyTo: FORMS_EMAIL });
}

async function mktContacts(u) {
  let rows = await query(`SELECT * FROM contacts ORDER BY id DESC LIMIT 5000`);
  if (internalOnly(u)) {
    rows = rows.filter(isInternal);
    const segments = [['tag:Employee', 'Employees'], ['tag:Co Founder', 'Co-founders']].map(([k, label]) => ({ key: k, label, count: rows.filter((c) => matchesAudience(c, [k])).length }));
    return { rows, segments, tags: INTERNAL_TAGS, unsubscribed: rows.filter((c) => c.status !== 'subscribed').length, internal: true };
  }
  const segments = SEGMENTS.map(([k, label]) => ({ key: k, label, count: rows.filter((c) => matchesAudience(c, [k])).length }));
  const custom = [...new Set(rows.flatMap(tagsOf))].filter((t) => !TAGS.includes(t));
  for (const t of custom) segments.push({ key: 'tag:' + t, label: t, count: rows.filter((c) => matchesAudience(c, ['tag:' + t])).length });
  return { rows, segments, tags: [...TAGS, ...custom], unsubscribed: rows.filter((c) => c.status !== 'subscribed').length };
}
async function mktSaveContact(u, b) {
  const id = int(b.id);
  if (internalOnly(u)) {
    b.tags = tagList(b.tags).filter((t) => INTERNAL_TAGS.includes(t));
    if (!b.tags.length) fail(400, 'Choose Employee or Co Founder.');
    if (id) { const ex = await one(`SELECT tags FROM contacts WHERE id = $1`, [id]); if (ex && !isInternal(ex)) fail(403, 'Not allowed.'); }
  }
  const e = email(b.email);
  const dupe = await one(`SELECT id FROM contacts WHERE email = $1`, [e]);
  if (dupe && Number(dupe.id) !== id) fail(400, 'That email is already in your audience.');
  const tags = tagList(b.tags).join(','), status = b.status === 'unsubscribed' ? 'unsubscribed' : 'subscribed';
  if (id) {
    await query(`UPDATE contacts SET email=$1, first_name=$2, last_name=$3, tags=$4, status=$5, notes=$6, updated_at=$7,
      unsubscribed_at = CASE WHEN $5 = 'unsubscribed' AND status <> 'unsubscribed' THEN $7 WHEN $5 = 'subscribed' THEN '' ELSE unsubscribed_at END WHERE id=$8`,
      [e, str(b.first_name, 80), str(b.last_name, 80), tags, status, str(b.notes, 500), nowIso(), id]);
    return { id };
  }
  const r = await one(`INSERT INTO contacts (email, first_name, last_name, tags, status, notes, source, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'Added by hand',$7,$7) RETURNING id`,
    [e, str(b.first_name, 80), str(b.last_name, 80), tags, status, str(b.notes, 500), nowIso()]);
  return { id: r.id };
}
async function mktDeleteContact(u, b) {
  if (internalOnly(u)) { const ex = await one(`SELECT tags FROM contacts WHERE id = $1`, [int(b.id)]); if (ex && !isInternal(ex)) fail(403, 'Not allowed.'); }
  await query(`DELETE FROM contacts WHERE id = $1`, [int(b.id)]); return { ok: true }; }
async function mktImportContacts(u, b) {
  let rows = Array.isArray(b.rows) ? b.rows.slice(0, 5000) : [];
  if (internalOnly(u)) rows = rows.map((r) => ({ ...r, tags: tagList(r.tags).filter((t) => INTERNAL_TAGS.includes(t)) })).filter((r) => r.tags.length);
  const out = { added: 0, updated: 0, skipped: 0 };
  for (const r of rows) {
    let first = str(r.first_name, 80), last = str(r.last_name, 80);
    if (!first && !last && r.full_name) ({ first_name: first, last_name: last } = splitName(r.full_name));
    if (first && !last && r.full_name) { const rest = str(r.full_name, 160).replace(new RegExp('^' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), ''); if (rest && rest !== str(r.full_name, 160)) last = rest; }
    const tidy = (x) => (x && x === x.toLowerCase() ? x.replace(/\b\w/g, (ch) => ch.toUpperCase()) : x);
    first = tidy(first); last = tidy(last);
    out[await upsertContact({ email: r.email, first_name: first, last_name: last, tags: r.tags, source: 'Import' })]++;
  }
  return out;
}
async function mktImportFromPortal(u) {
  if (internalOnly(u)) fail(403, 'Only the relations account can add clients to the audience.');
  const out = { added: 0, updated: 0, skipped: 0 };
  const svc = await query(`SELECT name, email, service FROM enquiries WHERE service <> '' AND email <> ''`);
  for (const r of svc) out[await upsertContact({ email: r.email, ...splitName(r.name), tags: [['recruitment', 'hcm'].includes(r.service) ? 'Recruitment Client' : 'Jobseeker Client'], source: 'Services' })]++;
  const cl = await query(`SELECT name, contact_name, contact_email FROM clients WHERE contact_email <> ''`);
  for (const r of cl) out[await upsertContact({ email: r.contact_email, ...splitName(r.contact_name || r.name), tags: ['Recruitment Client'], source: 'Clients' })]++;
  const sub = await query(`SELECT form, name, email FROM enquiries WHERE email <> '' AND form IN ('Early access list','Scoop newsletter','10% off popup','Collab request')`);
  for (const r of sub) out[await upsertContact({ email: r.email, ...splitName(r.name), tags: [r.form === 'Collab request' ? 'Partnership' : 'Subscriber'], source: r.form })]++;
  return out;
}

async function mktTemplates() { return { templates: TEMPLATES, images: IMAGE_LIBRARY, assetBase: assetBase() }; }
function renderFor(c, contact, preview) {
  return renderCampaign(c.template, typeof c.content === 'string' ? json(c.content, {}) : (c.content || {}), {
    firstName: contact ? contact.first_name : 'Annie', assetBase: assetBase(), siteUrl: 'https://www.depitchhq.com', preheader: c.preheader,
    unsubUrl: contact && contact.id ? unsubUrl(contact.id) : '#', pixelUrl: !preview && contact && contact.id && c.id ? pixelUrl(c.id, contact.id) : ''
  });
}
async function mktPreview(u, b) {
  return { html: renderFor({ template: str(b.template, 30), content: b.content || {}, preheader: str(b.preheader, 200) }, { first_name: str(b.first_name, 60) || 'Annie' }, true) };
}
async function mktCampaigns() {
  const rows = await query(`SELECT c.id, c.name, c.subject, c.template, c.audience, c.status, c.sent_count, c.failed_count, c.sent_at, c.created_at, c.updated_at,
      (SELECT COUNT(*)::int FROM campaign_sends s WHERE s.campaign_id = c.id AND s.opened_at <> '') AS opens,
      (SELECT COUNT(*)::int FROM campaign_sends s WHERE s.campaign_id = c.id AND s.status = 'queued') AS queued
    FROM campaigns c ORDER BY c.id DESC LIMIT 300`);
  return { rows: rows.map((r) => ({ ...r, audience: json(r.audience, []) })), segments: SEGMENTS.map(([key, label]) => ({ key, label })) };
}
async function mktCampaign(u, b) {
  const c = await one(`SELECT * FROM campaigns WHERE id = $1`, [int(b.id)]);
  if (!c) fail(404, 'Campaign not found.');
  const sends = await query(`SELECT email, first_name, status, error, sent_at, opened_at FROM campaign_sends WHERE campaign_id = $1 ORDER BY email LIMIT 5000`, [c.id]);
  return { campaign: { ...c, content: json(c.content, {}), audience: json(c.audience, []) }, sends };
}
async function mktSaveCampaign(u, b) {
  const id = int(b.id);
  if (id) {
    const ex = await one(`SELECT status FROM campaigns WHERE id = $1`, [id]);
    if (!ex) fail(404, 'Campaign not found.');
    if (ex.status !== 'draft') fail(400, 'This campaign has already been sent. Duplicate it to send again.');
  }
  const tpl = templateById(str(b.template, 30)).id;
  const content = {};
  for (const fd of templateById(tpl).fields) if (b.content && b.content[fd.key] != null) content[fd.key] = str(b.content[fd.key], 4000);
  const aud = allowedAudience(u, (Array.isArray(b.audience) ? b.audience : []).map((x) => str(x, 80)).filter(Boolean));
  const vals = [str(b.name, 160) || str(b.subject, 160) || 'Untitled campaign', str(b.subject, 200), str(b.preheader, 200), tpl, JSON.stringify(content), JSON.stringify(aud), nowIso()];
  if (id) { await query(`UPDATE campaigns SET name=$1, subject=$2, preheader=$3, template=$4, content=$5, audience=$6, updated_at=$7 WHERE id=$8`, [...vals, id]); return { id }; }
  const r = await one(`INSERT INTO campaigns (name, subject, preheader, template, content, audience, updated_at, created_at, created_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,'draft') RETURNING id`, [...vals, u.id || null]);
  return { id: r.id };
}
async function mktDuplicate(u, b) {
  const c = await one(`SELECT * FROM campaigns WHERE id = $1`, [int(b.id)]);
  if (!c) fail(404, 'Campaign not found.');
  const r = await one(`INSERT INTO campaigns (name, subject, preheader, template, content, audience, status, created_at, updated_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$7,$8) RETURNING id`,
    [c.name + ' (copy)', c.subject, c.preheader, c.template, c.content, c.audience, nowIso(), u.id || null]);
  return { id: r.id };
}
async function mktDeleteCampaign(u, b) {
  const id = int(b.id);
  await query(`DELETE FROM campaign_sends WHERE campaign_id = $1`, [id]);
  await query(`DELETE FROM campaigns WHERE id = $1`, [id]);
  return { ok: true };
}
async function mktAudienceCount(u, b) {
  const rows = await query(`SELECT id, tags, status FROM contacts`);
  return { count: rows.filter((c) => matchesAudience(c, allowedAudience(u, b.audience))).length };
}
async function mktSendTest(u, b) {
  const to = email(b.to);
  const c = await one(`SELECT * FROM campaigns WHERE id = $1`, [int(b.id)]);
  if (!c) fail(404, 'Save the campaign first.');
  if (!c.subject) fail(400, 'Add a subject line first.');
  const contact = (await one(`SELECT * FROM contacts WHERE email = $1`, [to])) || { first_name: str(b.first_name, 60) || (u.name || '').split(' ')[0] || 'there' };
  const r = await sendBatch([{ to, subject: '[Test] ' + c.subject.replace(/\{\{\s*first_name\s*\}\}/gi, contact.first_name || 'there'), html: renderFor({ ...c, id: 0 }, contact, true), replyTo: FORMS_EMAIL }]);
  if (!r.ok) fail(502, r.error);
  return { ok: true };
}
async function mktProcess(c) {
  const start = Date.now();
  const content = json(c.content, {});
  let sent = 0, failed = 0;
  while (Date.now() - start < 9000) {
    const batch = await query(`SELECT s.*, ct.status AS cstatus FROM campaign_sends s JOIN contacts ct ON ct.id = s.contact_id WHERE s.campaign_id = $1 AND s.status = 'queued' ORDER BY s.contact_id LIMIT 50`, [c.id]);
    if (!batch.length) break;
    const live = batch.filter((s) => s.cstatus === 'subscribed');
    const skipped = batch.filter((s) => s.cstatus !== 'subscribed');
    for (const s of skipped) await query(`UPDATE campaign_sends SET status = 'skipped', error = 'Unsubscribed' WHERE campaign_id = $1 AND contact_id = $2`, [c.id, s.contact_id]);
    if (live.length) {
      const r = await sendBatch(live.map((s) => ({
        to: s.email, subject: c.subject.replace(/\{\{\s*first_name\s*\}\}/gi, s.first_name || 'there'), replyTo: FORMS_EMAIL,
        html: renderFor({ ...c, content }, { id: s.contact_id, first_name: s.first_name }, false),
        headers: { 'List-Unsubscribe': `<${unsubUrl(s.contact_id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      })));
      const st = r.ok ? 'sent' : 'failed';
      const ids = live.map((s) => s.contact_id);
      await query(`UPDATE campaign_sends SET status = $1, error = $2, sent_at = $3 WHERE campaign_id = $4 AND contact_id IN (${ids.map((x) => int(x)).join(',')})`, [st, r.ok ? '' : r.error, nowIso(), c.id]);
      if (r.ok) sent += live.length; else { failed += live.length; break; }
    }
  }
  const t = await one(`SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS sent, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed, COUNT(*) FILTER (WHERE status = 'queued')::int AS queued FROM campaign_sends WHERE campaign_id = $1`, [c.id]);
  await query(`UPDATE campaigns SET sent_count = $1, failed_count = $2, status = $3, updated_at = $4 WHERE id = $5`, [t.sent, t.failed, t.queued ? 'sending' : 'sent', nowIso(), c.id]);
  return { sent: t.sent, failed: t.failed, remaining: t.queued, lastError: failed ? 'Some emails could not be sent. Check the Resend dashboard.' : '' };
}
async function mktSend(u, b) {
  const c = await one(`SELECT * FROM campaigns WHERE id = $1`, [int(b.id)]);
  if (!c) fail(404, 'Campaign not found.');
  if (c.status === 'sent') fail(400, 'This campaign was already sent.');
  if (!c.subject) fail(400, 'Add a subject line first.');
  if (!process.env.RESEND_API_KEY) fail(400, 'Email sending is not set up yet (RESEND_API_KEY).');
  if (c.status === 'draft') {
    const contacts = (await query(`SELECT * FROM contacts WHERE status = 'subscribed'`)).filter((x) => matchesAudience(x, allowedAudience(u, json(c.audience, []))));
    if (!contacts.length) fail(400, 'Nobody in this audience yet.');
    for (const x of contacts) {
      await query(`INSERT INTO campaign_sends (campaign_id, contact_id, email, first_name, status) VALUES ($1,$2,$3,$4,'queued') ON CONFLICT DO NOTHING`, [c.id, x.id, x.email, x.first_name]);
    }
    await query(`UPDATE campaigns SET status = 'sending', sent_at = $1 WHERE id = $2`, [nowIso(), c.id]);
    c.status = 'sending';
  }
  return mktProcess(c);
}
async function mktUploadImage(u, b) {
  if (!b.file || !/^image\/(png|jpeg|webp)$/.test(b.file.type || '')) fail(400, 'Upload a JPG, PNG or WebP image.');
  const id = await saveFile(b.file, { title: 'Email image: ' + str(b.file.name, 100), category: 'Email image', uploaded_by: u.id || null });
  return { key: 'file:' + id };
}
async function mktImages() {
  return { rows: await query(`SELECT id, filename, created_at FROM files WHERE category = 'Email image' ORDER BY id DESC LIMIT 100`) };
}

// Public routes used from inside sent emails: unsubscribe, open pixel and uploaded images.
async function handleMarketingGet(req, res, url) {
  if (url.searchParams.get('img')) {
    const f = await one(`SELECT mime, data FROM files WHERE id = $1 AND category = 'Email image'`, [int(url.searchParams.get('img'))]);
    if (!f) { res.statusCode = 404; return res.end(); }
    const buf = Buffer.from(f.data, 'base64');
    res.statusCode = 200; res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.end(buf);
  }
  if (url.searchParams.get('o')) {
    const [cid, id, sig] = String(url.searchParams.get('o')).split('.');
    if (sig && sig === mktSig('open:' + int(cid) + ':' + int(id))) {
      await query(`UPDATE campaign_sends SET opened_at = $1 WHERE campaign_id = $2 AND contact_id = $3 AND opened_at = ''`, [nowIso(), int(cid), int(id)]).catch(() => {});
    }
    res.statusCode = 200; res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'no-store');
    return res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  }
  const id = int(url.searchParams.get('unsub'));
  const ok = id && String(url.searchParams.get('k') || '') === mktSig('unsub:' + id);
  const c = ok ? await one(`SELECT * FROM contacts WHERE id = $1`, [id]) : null;
  if (!c) return reviewPage(res, 404, 'Link expired', '<h1>This link is not valid</h1><p class="muted">Email office@depitchhq.com and we will take you off our list.</p>');
  const self = `/api/portal?unsub=${id}&k=${mktSig('unsub:' + id)}`;
  if (req.method === 'POST') {
    await query(`UPDATE contacts SET status = 'unsubscribed', unsubscribed_at = $1, updated_at = $1 WHERE id = $2`, [nowIso(), id]);
    return reviewPage(res, 200, 'Unsubscribed', `<h1>You are unsubscribed</h1><p>${escapeHtml(c.email)} will not get Dé Pitch marketing emails again.</p><p class="muted">Changed your mind? Email office@depitchhq.com.</p>`);
  }
  if (c.status !== 'subscribed') return reviewPage(res, 200, 'Unsubscribed', `<h1>You are already unsubscribed</h1><p class="muted">${escapeHtml(c.email)} will not get our marketing emails.</p>`);
  return reviewPage(res, 200, 'Unsubscribe', `<h1>Unsubscribe from Dé Pitch emails?</h1><p class="muted">${escapeHtml(c.email)} will stop getting our newsletters and offers.</p>
    <form method="POST" action="${self}"><div class="row"><button class="ch" type="submit">Unsubscribe</button></div></form>`);
}


/* ================= the Scoop (blog) ================= */
const SITE_BASE = () => assetBase();
const postOut = (p) => ({ ...p, faq: json(p.faq, []) });
function htmlOut(res, status, html, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(html);
}
async function publishedPosts() {
  return (await query(`SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 500`)).map(postOut);
}
async function handleBlog(req, res, url) {
  const base = SITE_BASE();
  if (url.searchParams.get('sitemap')) {
    res.statusCode = 200; res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    return res.end(renderSitemap(base, await publishedPosts()));
  }
  let slug = url.searchParams.get('blog') || '';
  if (!slug || slug === '_index') { const m = url.pathname.match(/^\/scoop\/([^/?#]+)/); slug = m ? decodeURIComponent(m[1]) : '_index'; }
  const cache = 'public, s-maxage=60, stale-while-revalidate=600';
  const posts = await publishedPosts();
  if (slug === '_index' || slug === 'index') {
    const cat = str(url.searchParams.get('category'), 30);
    return htmlOut(res, 200, renderIndex(posts, { base, category: CATEGORIES.some((c) => c.key === cat) ? cat : '' }), cache);
  }
  const p = posts.find((x) => x.slug === slug);
  if (!p) return htmlOut(res, 404, renderNotFound(base), 'public, s-maxage=30');
  query(`UPDATE posts SET views = views + 1 WHERE id = $1`, [p.id]).catch(() => {});
  const related = posts.filter((x) => x.id !== p.id && x.category === p.category).concat(posts.filter((x) => x.id !== p.id && x.category !== p.category)).slice(0, 3);
  return htmlOut(res, 200, renderPost(p, { base, related }), cache);
}

async function mktPosts() {
  const rows = await query(`SELECT id, slug, title, category, status, views, published_at, updated_at, created_at, cover FROM posts ORDER BY COALESCE(NULLIF(published_at, ''), updated_at) DESC, id DESC`);
  return { rows, categories: CATEGORIES, ctas: Object.entries(CTAS).map(([key, v]) => ({ key, label: v.label })), base: SITE_BASE() };
}
async function mktPost(u, b) {
  const p = await one(`SELECT * FROM posts WHERE id = $1`, [int(b.id)]);
  if (!p) fail(404, 'Post not found.');
  return { post: postOut(p) };
}
function postFields(b) {
  const faq = (Array.isArray(b.faq) ? b.faq : []).slice(0, 12).map((x) => ({ q: str(x && x.q, 300), a: str(x && x.a, 1500) })).filter((x) => x.q && x.a);
  return {
    title: str(b.title, 200), excerpt: str(b.excerpt, 400), body: str(b.body, 60000), cover: str(b.cover, 200), cover_alt: str(b.cover_alt, 200),
    category: CATEGORIES.some((c) => c.key === b.category) ? b.category : 'culture', author: str(b.author, 120) || 'Dé Pitch', author_role: str(b.author_role, 120),
    faq: JSON.stringify(faq), bridge: str(b.bridge, 800), cta: CTAS[b.cta] ? b.cta : 'consultation', cta_label: str(b.cta_label, 60),
    seo_title: str(b.seo_title, 120), seo_description: str(b.seo_description, 300)
  };
}
async function uniqueSlug(want, id) {
  let base = slugify(want) || 'story', s = base, n = 2;
  while (await one(`SELECT id FROM posts WHERE slug = $1 AND id <> $2`, [s, id || 0])) s = `${base}-${n++}`;
  return s;
}
async function mktSavePost(u, b) {
  const id = int(b.id);
  const ex = id ? await one(`SELECT * FROM posts WHERE id = $1`, [id]) : null;
  if (id && !ex) fail(404, 'Post not found.');
  const f = postFields(b);
  if (!f.title) fail(400, 'Add a title.');
  const slug = await uniqueSlug(b.slug || f.title, id);
  const status = b.status === 'published' ? 'published' : b.status === 'draft' ? 'draft' : (ex ? ex.status : 'draft');
  if (status === 'published') {
    if (!f.body || f.body.split(/\s+/).length < 80) fail(400, 'The story needs a body of at least 80 words before publishing.');
    if (!f.excerpt && !f.seo_description) fail(400, 'Add a short summary before publishing (it shows on Google and in the list).');
    if (!f.cover) fail(400, 'Choose a cover photo before publishing.');
  }
  const now = nowIso();
  const publishedAt = status === 'published' ? ((ex && ex.published_at) || now) : (ex ? ex.published_at : '');
  const cols = ['slug', 'title', 'excerpt', 'body', 'cover', 'cover_alt', 'category', 'author', 'author_role', 'faq', 'bridge', 'cta', 'cta_label', 'seo_title', 'seo_description', 'status', 'published_at', 'updated_at'];
  const vals = [slug, f.title, f.excerpt, f.body, f.cover, f.cover_alt, f.category, f.author, f.author_role, f.faq, f.bridge, f.cta, f.cta_label, f.seo_title, f.seo_description, status, publishedAt, now];
  if (ex) {
    await query(`UPDATE posts SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`, [...vals, id]);
    return { id, slug, status, url: `${SITE_BASE()}/scoop/${slug}` };
  }
  const r = await one(`INSERT INTO posts (${cols.join(', ')}, created_at, created_by) VALUES (${cols.map((c, i) => '$' + (i + 1)).join(', ')}, $${cols.length + 1}, $${cols.length + 2}) RETURNING id`, [...vals, now, u.id || null]);
  return { id: r.id, slug, status, url: `${SITE_BASE()}/scoop/${slug}` };
}
async function mktDeletePost(u, b) { await query(`DELETE FROM posts WHERE id = $1`, [int(b.id)]); return { ok: true }; }
async function mktPreviewPost(u, b) {
  const f = postFields(b);
  return { html: renderPost({ ...f, faq: json(f.faq, []), slug: slugify(b.slug || f.title) || 'preview', status: 'draft', published_at: nowIso() }, { base: '', preview: true }) };
}

/* ---------- notification counts for employees and clients ---------- */
async function meCounts(u) {
  const seen = json(u.seen || '{}', {});
  const s = (k) => String(seen[k] || '');
  if (u.role === 'employee') {
    const c = await one(`SELECT
      (SELECT COUNT(*)::int FROM payroll WHERE user_id=$1 AND status='paid' AND updated_at > $2) AS pay,
      (SELECT COUNT(*)::int FROM reports WHERE user_id=$1 AND reviewed_at <> '' AND reviewed_at > $3) AS reports,
      (SELECT COUNT(*)::int FROM requests WHERE user_id=$1 AND reviewed_at <> '' AND reviewed_at > $4) AS requests,
      (SELECT COUNT(*)::int FROM referrals WHERE user_id=$1 AND status <> 'submitted' AND updated_at > $5) AS referrals,
      (SELECT COUNT(*)::int FROM files WHERE owner_id=$1 AND category <> 'Receipt' AND created_at > $6) AS documents,
      (SELECT COUNT(*)::int FROM announcements WHERE active AND audience IN ('employees','all') AND created_at > $7) AS overview`,
      [u.id, s('pay'), s('reports'), s('requests'), s('referrals'), s('documents'), s('overview')]);
    return { counts: c };
  }
  if (u.role === 'client' && u.client_id) {
    const c = await one(`SELECT
      (SELECT COUNT(*)::int FROM invoices WHERE client_id=$1 AND status IN ('sent','paid') AND updated_at > $2) AS invoices,
      (SELECT COUNT(*)::int FROM recruitment WHERE client_id=$1 AND status <> 'submitted' AND updated_at > $3) AS recruitment,
      (SELECT COUNT(*)::int FROM talent_feedback WHERE client_id=$1 AND status <> 'submitted' AND updated_at > $4) AS talents,
      (SELECT COUNT(*)::int FROM files WHERE client_id=$1 AND created_at > $5) AS documents,
      (SELECT COUNT(*)::int FROM announcements WHERE active AND audience IN ('clients','all') AND created_at > $6) AS overview`,
      [u.client_id, s('invoices'), s('recruitment'), s('talents'), s('documents'), s('overview')]);
    return { counts: c };
  }
  return { counts: {} };
}
async function meSeen(u, b) {
  if (!u.id) return { ok: true };
  const tab = str(b.tab, 30);
  if (!/^[a-z]+$/.test(tab)) return { ok: true };
  const seen = json(u.seen || '{}', {});
  seen[tab] = nowIso();
  await query(`UPDATE users SET seen = $1 WHERE id = $2`, [JSON.stringify(seen), u.id]);
  u.seen = JSON.stringify(seen);
  return meCounts(u);
}

const ACTIONS = {
  'me.counts': meCounts, 'me.seen': meSeen,
  'mkt.contacts': mktContacts, 'mkt.saveContact': mktSaveContact, 'mkt.deleteContact': mktDeleteContact, 'mkt.importContacts': mktImportContacts,
  'mkt.importFromPortal': mktImportFromPortal, 'mkt.templates': mktTemplates, 'mkt.preview': mktPreview, 'mkt.campaigns': mktCampaigns,
  'mkt.campaign': mktCampaign, 'mkt.saveCampaign': mktSaveCampaign, 'mkt.duplicate': mktDuplicate, 'mkt.deleteCampaign': mktDeleteCampaign,
  'mkt.posts': mktPosts, 'mkt.post': mktPost, 'mkt.savePost': mktSavePost, 'mkt.deletePost': mktDeletePost, 'mkt.previewPost': mktPreviewPost,
  'mkt.audienceCount': mktAudienceCount, 'mkt.sendTest': mktSendTest, 'mkt.send': mktSend, 'mkt.uploadImage': mktUploadImage, 'mkt.images': mktImages,
  'emp.dashboard': empDashboard, 'emp.payroll': empPayroll, 'emp.payslip': empPayslip,
  'emp.reports': empReports, 'emp.submitReport': empSubmitReport, 'emp.lateExcuse': empLateExcuse,
  'emp.requests': empRequests, 'emp.submitRequest': empSubmitRequest, 'emp.documents': empDocuments,

  'cli.dashboard': cliDashboard, 'cli.invoice': cliInvoice,
  'cli.recruitment': cliRecruitment, 'cli.submitRecruitment': cliSubmitRecruitment,
  'cli.feedback': cliFeedback, 'cli.submitFeedback': cliSubmitFeedback, 'cli.documents': cliDocuments,

  'adm.overview': admOverview, 'adm.users': admUsers, 'adm.createUser': admCreateUser, 'adm.updateUser': admUpdateUser,
  'adm.resetPassword': admResetPassword, 'adm.clients': admClients, 'adm.saveClient': admSaveClient,
  'adm.payroll': admPayroll, 'adm.generatePayroll': admGeneratePayroll, 'adm.savePayroll': admSavePayroll,
  'adm.markPaid': admMarkPaid, 'adm.deletePayroll': admDeletePayroll, 'adm.payslip': admEmployeePayslip,
  'adm.reports': admReports, 'adm.reviewReport': admReviewReport, 'adm.importReports': admImportReports, 'adm.lateExcuses': admLateExcuses, 'adm.reviewLate': admReviewLate,
  'adm.requests': admRequests, 'adm.reviewRequest': admReviewRequest,
  'adm.invoices': admInvoices, 'adm.invoice': admInvoice, 'adm.draftInvoice': admDraftInvoice, 'adm.saveInvoice': admSaveInvoice,
  'adm.invoiceStatus': admInvoiceStatus, 'adm.deleteInvoice': admDeleteInvoice,
  'adm.recruitment': admRecruitment, 'adm.updateRecruitment': admUpdateRecruitment,
  'adm.feedback': admFeedback, 'adm.updateFeedback': admUpdateFeedback,
  'adm.files': admFiles, 'adm.uploadDocument': admUploadDocument, 'adm.deleteFile': admDeleteFile,
  'emp.referrals': empReferrals, 'emp.submitReferral': empSubmitReferral,
  'adm.enquiries': admEnquiries, 'adm.enquiryStatus': admEnquiryStatus, 'adm.enquiryFollowUp': admEnquiryFollowUp, 'adm.referrals': admReferrals, 'adm.updateReferral': admUpdateReferral,
  'adm.points': admPoints, 'adm.reviewClaim': admReviewClaim, 'adm.awardPoints': admAwardPoints, 'adm.updateRedemption': admUpdateRedemption,
  'adm.chats': admChats, 'adm.chat': admChat, 'adm.chatReply': admChatReply, 'adm.chatStatus': admChatStatus, 'adm.services': admServices, 'adm.saveService': admSaveService, 'adm.deleteService': admDeleteService, 'adm.settings': admSettings, 'adm.testPointsEmail': admTestPointsEmail,
  'adm.announcements': admAnnouncements, 'adm.saveAnnouncement': admSaveAnnouncement, 'adm.deleteAnnouncement': admDeleteAnnouncement
};
