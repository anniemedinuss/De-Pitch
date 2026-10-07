#!/usr/bin/env node
// Push documents and announcements to the Dé Pitch portal from the command line.
// Claude can run this for you. It needs two values:
//   PORTAL_URL      e.g. https://www.depitchhq.com
//   PORTAL_API_KEY  the same value you set in Vercel → Settings → Environment Variables
//
// Examples
//   node tools/portal-admin.mjs people
//   node tools/portal-admin.mjs announce "Salaries for October will be paid on the 28th" --to employees
//   node tools/portal-admin.mjs upload --email ada@example.com --title "Employment letter" --type "Employment letter" ./letter.pdf
//   node tools/portal-admin.mjs upload --client "Tmed Media" --title "Service agreement" --type Agreement ./agreement.pdf
//   node tools/portal-admin.mjs documents --email ada@example.com
import fs from 'node:fs';
import path from 'node:path';

const base = (process.env.PORTAL_URL || '').replace(/\/$/, '');
const key = process.env.PORTAL_API_KEY || '';
if (!base || !key) {
  console.error('Set PORTAL_URL and PORTAL_API_KEY first.');
  process.exit(1);
}

const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv', '.txt': 'text/plain' };

async function call(action, data = {}) {
  const r = await fetch(`${base}/api/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ action, ...data })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) out[args[i].slice(2)] = args[++i];
    else out._.push(args[i]);
  }
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);
const f = flags(rest);

try {
  if (cmd === 'people') {
    const { rows } = await call('adm.users');
    for (const u of rows) console.log(`${u.role.padEnd(9)} ${u.email.padEnd(34)} ${u.name}${u.client_name ? ' · ' + u.client_name : ''}`);
  } else if (cmd === 'announce') {
    const message = f._.join(' ');
    const j = await call('adm.saveAnnouncement', { message, audience: f.to || 'employees', link: f.link || '' });
    console.log(`Announcement posted (#${j.id}).`);
  } else if (cmd === 'upload') {
    const file = f._[0];
    if (!file || !fs.existsSync(file)) throw new Error('Give the path of the file to upload.');
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) throw new Error('Unsupported file type.');
    const data = fs.readFileSync(file).toString('base64');
    let client_id = null;
    if (f.client) {
      const { rows } = await call('adm.clients');
      const c = rows.find((x) => x.name.toLowerCase() === f.client.toLowerCase());
      if (!c) throw new Error(`No client called "${f.client}".`);
      client_id = c.id;
    }
    const j = await call('adm.uploadDocument', {
      owner_email: f.email || '', client_id, title: f.title || path.basename(file), category: f.type || 'Document',
      file: { name: path.basename(file), type: MIME[ext], data }
    });
    console.log(`Uploaded "${f.title || path.basename(file)}" (document #${j.id}).`);
  } else if (cmd === 'documents') {
    const { rows: users } = await call('adm.users');
    const u = f.email ? users.find((x) => x.email === f.email.toLowerCase()) : null;
    const { rows } = await call('adm.files', u ? { owner_id: u.id } : {});
    for (const d of rows) console.log(`#${d.id}  ${d.category.padEnd(18)} ${d.title}  →  ${d.owner_name || d.client_name}`);
  } else {
    console.log('Commands: people | announce "message" [--to employees|clients|all] [--link https://…] | upload --email x@y.com|--client "Name" --title "…" --type "…" <file> | documents [--email x@y.com]');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
