// Dé Pitch portal API — one Vercel function for the whole portal.
// POST /api/portal  { action: "...", ...data }   (JSON, header X-Portal: 1)
// GET  /api/portal?file=ID[&dl=1]               (download a document)
import crypto from 'node:crypto';
import { query, one } from './_lib/db.js';
import { notify, sendEmail, layout, canEmailVisitors, escapeHtml, siteUrl } from './_lib/mail.js';
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
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
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
    if (area === 'cli' && !user.client_id) return send(res, 403, { error: 'Your account is not linked to a company yet. Contact People Ops.' });

    if (area === 'adm') await sweepChats();
    const result = await fn(user, body);
    return send(res, 200, result || { ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return send(res, status, { error: status >= 500 && !err.status ? 'Something went wrong. Please try again.' : err.message });
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
  return { rows: rows.map((r) => ({ ...r, tasks: json(r.tasks), blockers: json(r.blockers) })) };
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

async function empSubmitReport(u, b) {
  const { ws, we, tasks, blockers } = cleanReport(b);
  const client = str(b.client_name, 160) || u.client_name || '';
  const row = await one(
    `INSERT INTO reports (user_id, client_name, week_start, week_end, submitted_on, tasks, blockers, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted',$8) RETURNING id`,
    [u.id, client, ws, we, today(), JSON.stringify(tasks), JSON.stringify(blockers), nowIso()]
  );
  const hours = tasks.reduce((t, x) => t + x.hours, 0);
  await notifyHR(`Weekly report from ${u.name}`, { Employee: u.name, Client: client, Week: `${ws} to ${we}`, Tasks: tasks.length, Hours: hours, Blockers: blockers.length });
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
    (SELECT COUNT(*)::int FROM reports WHERE status = 'submitted') AS reports,
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
    (SELECT COUNT(*)::int FROM points_claims WHERE status = 'pending') + (SELECT COUNT(*)::int FROM redemptions WHERE status = 'pending') AS points`);
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
  const role = ['employee', 'client', 'admin'].includes(b.role) ? b.role : fail(400, 'Choose a role.');
  const e = email(b.email);
  if (!str(b.name)) fail(400, 'Name is required.');
  if (role === 'client' && !b.client_id) fail(400, 'Link the client user to a company.');
  if (await one(`SELECT id FROM users WHERE email = $1`, [e])) fail(400, 'Someone already uses that email.');
  const chosen = String(b.password || '');
  if (chosen) { const problem = passwordProblem(chosen); if (problem) fail(400, 'Password: ' + problem); }
  const temp = chosen || tempPassword();
  const f = userFields(b);
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

async function admReviewReport(admin, b) {
  const status = ['approved', 'changes_requested', 'submitted'].includes(b.status) ? b.status : fail(400, 'Choose a decision.');
  await query(`UPDATE reports SET status=$1, hr_note=$2, reviewed_at=$3 WHERE id=$4`, [status, str(b.hr_note, 1000), nowIso(), int(b.id)]);
  return { ok: true };
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
  if (col) params.push(today());
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
  if (!m || !namesMatch(m.name, name)) return null;
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
  const row = await one(`INSERT INTO enquiries (form, name, email, phone, fields, file_id, page, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8) RETURNING id`,
    [form, name, mail, phone, JSON.stringify(fields), fileId, str(b.page, 200), nowIso()]);
  await notify(`Website form: ${form}`, { ...fields, 'CV / file': fileId ? 'Uploaded. Open it in the portal under Website enquiries.' : '' }, FORMS_EMAIL);
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
    n++;
  }
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
  'public.form': pubForm, 'public.points': pubPoints, 'public.pointsClaim': pubPointsClaim, 'public.redeem': pubRedeem,
  'public.chatStart': pubChatStart, 'public.chatSend': pubChatSend, 'public.chatPoll': pubChatPoll
};

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
  'emp.dashboard': empDashboard, 'emp.payroll': empPayroll, 'emp.payslip': empPayslip,
  'emp.reports': empReports, 'emp.submitReport': empSubmitReport,
  'emp.requests': empRequests, 'emp.submitRequest': empSubmitRequest, 'emp.documents': empDocuments,

  'cli.dashboard': cliDashboard, 'cli.invoice': cliInvoice,
  'cli.recruitment': cliRecruitment, 'cli.submitRecruitment': cliSubmitRecruitment,
  'cli.feedback': cliFeedback, 'cli.submitFeedback': cliSubmitFeedback, 'cli.documents': cliDocuments,

  'adm.overview': admOverview, 'adm.users': admUsers, 'adm.createUser': admCreateUser, 'adm.updateUser': admUpdateUser,
  'adm.resetPassword': admResetPassword, 'adm.clients': admClients, 'adm.saveClient': admSaveClient,
  'adm.payroll': admPayroll, 'adm.generatePayroll': admGeneratePayroll, 'adm.savePayroll': admSavePayroll,
  'adm.markPaid': admMarkPaid, 'adm.deletePayroll': admDeletePayroll, 'adm.payslip': admEmployeePayslip,
  'adm.reports': admReports, 'adm.reviewReport': admReviewReport,
  'adm.requests': admRequests, 'adm.reviewRequest': admReviewRequest,
  'adm.invoices': admInvoices, 'adm.invoice': admInvoice, 'adm.draftInvoice': admDraftInvoice, 'adm.saveInvoice': admSaveInvoice,
  'adm.invoiceStatus': admInvoiceStatus, 'adm.deleteInvoice': admDeleteInvoice,
  'adm.recruitment': admRecruitment, 'adm.updateRecruitment': admUpdateRecruitment,
  'adm.feedback': admFeedback, 'adm.updateFeedback': admUpdateFeedback,
  'adm.files': admFiles, 'adm.uploadDocument': admUploadDocument, 'adm.deleteFile': admDeleteFile,
  'emp.referrals': empReferrals, 'emp.submitReferral': empSubmitReferral,
  'adm.enquiries': admEnquiries, 'adm.enquiryStatus': admEnquiryStatus, 'adm.referrals': admReferrals, 'adm.updateReferral': admUpdateReferral,
  'adm.points': admPoints, 'adm.reviewClaim': admReviewClaim, 'adm.awardPoints': admAwardPoints, 'adm.updateRedemption': admUpdateRedemption,
  'adm.chats': admChats, 'adm.chat': admChat, 'adm.chatReply': admChatReply, 'adm.chatStatus': admChatStatus, 'adm.settings': admSettings, 'adm.testPointsEmail': admTestPointsEmail,
  'adm.announcements': admAnnouncements, 'adm.saveAnnouncement': admSaveAnnouncement, 'adm.deleteAnnouncement': admDeleteAnnouncement
};
