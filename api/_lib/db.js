// Database access. In production this talks to Neon Postgres (added from the
// Vercel dashboard: Storage → Neon). Locally it can use a psql-based adapter
// for testing (see tools/dev-server.mjs).

let runner = null;

async function getRunner() {
  if (runner) return runner;
  if (globalThis.__DP_TEST_RUNNER__) {
    runner = globalThis.__DP_TEST_RUNNER__;
    return runner;
  }
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    const err = new Error('The portal database is not connected yet. In Vercel, open Storage, add Neon, and redeploy.');
    err.status = 503;
    throw err;
  }
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  runner = (text, params) => sql.query(text, params);
  return runner;
}

export async function query(text, params = []) {
  const run = await getRunner();
  await migrate(run);
  const rows = await run(text, params);
  return Array.isArray(rows) ? rows : (rows && rows.rows) || [];
}

export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

let migrated = false;
async function migrate(run) {
  if (migrated) return;
  for (const stmt of SCHEMA) await run(stmt, []);
  migrated = true;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    contact_name TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    currency TEXT DEFAULT 'NGN',
    active BOOLEAN DEFAULT TRUE,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change BOOLEAN DEFAULT TRUE,
    active BOOLEAN DEFAULT TRUE,
    client_id INTEGER,
    job_title TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    employee_code TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    pay_currency TEXT DEFAULT 'NGN',
    monthly_pay DOUBLE PRECISION DEFAULT 0,
    bill_rate DOUBLE PRECISION DEFAULT 0,
    bank_name TEXT DEFAULT '',
    account_number TEXT DEFAULT '',
    failed_logins INTEGER DEFAULT 0,
    locked_until TEXT DEFAULT '',
    session_version INTEGER DEFAULT 1,
    last_login TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS payroll (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    earnings TEXT DEFAULT '[]',
    deductions TEXT DEFAULT '[]',
    gross DOUBLE PRECISION DEFAULT 0,
    total_deductions DOUBLE PRECISION DEFAULT 0,
    net DOUBLE PRECISION DEFAULT 0,
    currency TEXT DEFAULT 'NGN',
    status TEXT DEFAULT 'pending',
    paid_at TEXT DEFAULT '',
    payment_ref TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT,
    UNIQUE (user_id, period)
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    client_name TEXT DEFAULT '',
    week_start TEXT,
    week_end TEXT,
    submitted_on TEXT,
    tasks TEXT DEFAULT '[]',
    blockers TEXT DEFAULT '[]',
    status TEXT DEFAULT 'submitted',
    hr_note TEXT DEFAULT '',
    reviewed_at TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT DEFAULT '',
    details TEXT DEFAULT '',
    amount DOUBLE PRECISION DEFAULT 0,
    currency TEXT DEFAULT 'NGN',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    file_id INTEGER,
    status TEXT DEFAULT 'pending',
    hr_note TEXT DEFAULT '',
    reviewed_at TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER,
    client_id INTEGER,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'Document',
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    data TEXT NOT NULL,
    uploaded_by INTEGER,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    number TEXT NOT NULL,
    period TEXT NOT NULL,
    items TEXT DEFAULT '[]',
    subtotal DOUBLE PRECISION DEFAULT 0,
    tax DOUBLE PRECISION DEFAULT 0,
    total DOUBLE PRECISION DEFAULT 0,
    currency TEXT DEFAULT 'NGN',
    status TEXT DEFAULT 'draft',
    issue_date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    sent_at TEXT DEFAULT '',
    paid_at TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS recruitment (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    created_by INTEGER,
    role_title TEXT NOT NULL,
    headcount INTEGER DEFAULT 1,
    employment_type TEXT DEFAULT '',
    skills TEXT DEFAULT '',
    budget TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'submitted',
    hr_note TEXT DEFAULT '',
    file_id INTEGER,
    created_at TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS talent_feedback (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    created_by INTEGER,
    talent_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    rating INTEGER DEFAULT 0,
    comments TEXT DEFAULT '',
    effective_date TEXT DEFAULT '',
    status TEXT DEFAULT 'submitted',
    hr_note TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    link TEXT DEFAULT '',
    audience TEXT DEFAULT 'employees',
    active BOOLEAN DEFAULT TRUE,
    created_by INTEGER,
    created_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS payroll_user_idx ON payroll (user_id)`,
  `CREATE INDEX IF NOT EXISTS reports_user_idx ON reports (user_id)`,
  `CREATE INDEX IF NOT EXISTS requests_user_idx ON requests (user_id)`,
  `CREATE INDEX IF NOT EXISTS files_owner_idx ON files (owner_id)`,
  `CREATE INDEX IF NOT EXISTS invoices_client_idx ON invoices (client_id)`
];
