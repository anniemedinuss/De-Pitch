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
  `CREATE TABLE IF NOT EXISTS enquiries (
    id SERIAL PRIMARY KEY,
    form TEXT NOT NULL,
    name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    fields TEXT DEFAULT '{}',
    file_id INTEGER,
    page TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    company TEXT DEFAULT '',
    role TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'submitted',
    hr_note TEXT DEFAULT '',
    reward TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS points_ledger (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL,
    points INTEGER NOT NULL,
    kind TEXT DEFAULT 'adjustment',
    reason TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS points_claims (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    points INTEGER DEFAULT 0,
    hr_note TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS redemptions (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL,
    reward TEXT NOT NULL,
    points INTEGER NOT NULL,
    cash_amount DOUBLE PRECISION DEFAULT 0,
    details TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    hr_note TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    page TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    last_visitor_msg TEXT DEFAULT '',
    last_staff_msg TEXT DEFAULT '',
    visitor_seen TEXT DEFAULT '',
    staff_read TEXT DEFAULT '',
    emailed_at TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    body TEXT NOT NULL,
    staff_id INTEGER,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS hits (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hits_key_idx ON hits (key, at)`,
  `CREATE INDEX IF NOT EXISTS chat_messages_chat_idx ON chat_messages (chat_id)`,
  `CREATE INDEX IF NOT EXISTS ledger_member_idx ON points_ledger (member_id)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS seen TEXT DEFAULT '{}'`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT ''`,
  `ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS service TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS consult_date TEXT DEFAULT '',
     ADD COLUMN IF NOT EXISTS consult_mode TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS consult_done_at TEXT DEFAULT '',
     ADD COLUMN IF NOT EXISTS paid_at TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS amount DOUBLE PRECISION DEFAULT 0,
     ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'NGN', ADD COLUMN IF NOT EXISTS done_at TEXT DEFAULT '',
     ADD COLUMN IF NOT EXISTS delivered_at TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS closed_at TEXT DEFAULT '',
     ADD COLUMN IF NOT EXISTS review_sent_at TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS result_file_id INTEGER,
     ADD COLUMN IF NOT EXISTS track_notes TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT ''`,
  `UPDATE enquiries SET service = CASE form WHEN 'Free career consultation' THEN 'consultation' 
     WHEN 'CV Revamp request' THEN 'cv' WHEN 'Interview prep booking' THEN 'interview' WHEN 'Recruitment request' THEN 'recruitment'
     WHEN 'Human capital consultation' THEN 'hcm' ELSE '' END,
     consult_date = COALESCE(NULLIF(consult_date, ''), COALESCE(fields::json->>'date_of_consultation', '')),
     consult_mode = COALESCE(NULLIF(consult_mode, ''), COALESCE(fields::json->>'mode_of_consultation', ''))
   WHERE service = '' AND form IN ('Free career consultation','CV Revamp request','Interview prep booking','Recruitment request','Human capital consultation')`,
  `ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS interest TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT '',
     ADD COLUMN IF NOT EXISTS reviewed_at TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS session_date TEXT DEFAULT ''`,
  `ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS review_token TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS review_note TEXT DEFAULT ''`,
  `UPDATE enquiries SET service = '' WHERE form = 'Book free consultation (email)' AND service <> ''`,
  `ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consult_time TEXT DEFAULT '', ADD COLUMN IF NOT EXISTS followup_at TEXT DEFAULT ''`,
  `UPDATE enquiries SET consult_time = COALESCE(fields::json->>'time_of_consultation', '') WHERE consult_time = '' AND service <> '' AND fields LIKE '%time_of_consultation%'`,
  `ALTER TABLE chats ADD COLUMN IF NOT EXISTS slack_at TEXT DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, first_name TEXT DEFAULT '', last_name TEXT DEFAULT '',
    tags TEXT DEFAULT '', status TEXT DEFAULT 'subscribed', source TEXT DEFAULT '', notes TEXT DEFAULT '',
    unsubscribed_at TEXT DEFAULT '', created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY, name TEXT DEFAULT '', subject TEXT DEFAULT '', preheader TEXT DEFAULT '', template TEXT DEFAULT 'spotlight',
    content TEXT DEFAULT '{}', audience TEXT DEFAULT '[]', status TEXT DEFAULT 'draft', sent_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0,
    sent_at TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS campaign_sends (
    campaign_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, email TEXT DEFAULT '', first_name TEXT DEFAULT '',
    status TEXT DEFAULT 'queued', error TEXT DEFAULT '', sent_at TEXT DEFAULT '', opened_at TEXT DEFAULT '',
    PRIMARY KEY (campaign_id, contact_id))`,
  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS welcomed_at TEXT DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT DEFAULT '', excerpt TEXT DEFAULT '', body TEXT DEFAULT '',
    cover TEXT DEFAULT '', cover_alt TEXT DEFAULT '', category TEXT DEFAULT 'culture', author TEXT DEFAULT 'Dé Pitch', author_role TEXT DEFAULT '',
    faq TEXT DEFAULT '[]', bridge TEXT DEFAULT '', cta TEXT DEFAULT 'consultation', cta_label TEXT DEFAULT '',
    seo_title TEXT DEFAULT '', seo_description TEXT DEFAULT '', status TEXT DEFAULT 'draft', views INTEGER DEFAULT 0,
    published_at TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS payroll_user_idx ON payroll (user_id)`,
  `CREATE INDEX IF NOT EXISTS reports_user_idx ON reports (user_id)`,
  `CREATE INDEX IF NOT EXISTS requests_user_idx ON requests (user_id)`,
  `CREATE INDEX IF NOT EXISTS files_owner_idx ON files (owner_id)`,
  `CREATE INDEX IF NOT EXISTS invoices_client_idx ON invoices (client_id)`
];
