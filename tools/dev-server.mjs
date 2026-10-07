// Local test server: serves the site and runs /api/portal against a local
// Postgres through psql (no npm packages needed).
//   PGDATABASE=depitch node tools/dev-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3000);
process.env.SESSION_SECRET ||= 'local-dev-secret-local-dev-secret-123456';
process.env.SETUP_KEY ||= 'local-setup-key';
process.env.PORTAL_API_KEY ||= 'local-api-key-local-api-key-0001';
process.env.NOTIFY_HR ||= 'off';

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

globalThis.__DP_TEST_RUNNER__ = async (text, params = []) => {
  let script = '';
  params.forEach((p, i) => { if (p !== null && p !== undefined) script += `\\set p${i + 1} '${esc(typeof p === 'object' ? JSON.stringify(p) : p)}'\n`; });
  let sql = text.replace(/\$(\d+)/g, (_, n) => {
    const v = params[Number(n) - 1];
    return v === null || v === undefined ? 'NULL' : `:'p${n}'`;
  }).trim();
  const returnsRows = /^\s*select/i.test(sql) || /returning/i.test(sql);
  if (returnsRows) sql = `WITH __q AS (${sql}) SELECT coalesce(json_agg(__q), '[]') FROM __q`;
  script += sql + ';\n';
  const out = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE || 'depitch'], { input: script, maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error('SQL error: ' + out.stderr.toString() + '\n' + text);
  return returnsRows ? JSON.parse(out.stdout.toString().trim() || '[]') : [];
};

const { default: handler } = await import('../api/portal.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/portal') return handler(req, res);
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html'; // mimic Vercel cleanUrls
  const file = path.join(root, p);
  if (!file.startsWith(root) || file.includes(`${path.sep}api${path.sep}`) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Dé Pitch dev server on http://localhost:${port}`));
