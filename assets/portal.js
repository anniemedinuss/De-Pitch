/* Dé Pitch portal — one sign-in, three dashboards (employee, client, People Ops). */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var modal = document.getElementById('modal');
  var S = { user: null, announcements: [], counts: {}, adminEmail: 'peopleops@depitchhq.com' };

  /* ================= utilities ================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function api(action, data) {
    var body = Object.assign({}, data || {}, { action: action });
    return fetch('/api/portal', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Portal': '1' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'The portal could not be reached. Check your connection and try again.' }; })
        .then(function (j) {
          if (!r.ok) {
            if (r.status === 401 && ['login', 'session', 'setup'].indexOf(action) === -1) { S.user = null; renderLogin(j.error); }
            if (j.mustChange) { renderChangePassword(); }
            var e = new Error(j.error || 'Something went wrong. Please try again.');
            e.status = r.status;
            throw e;
          }
          return j;
        });
    });
  }

  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = ''; }, 3200);
  }

  function money(n, cur) {
    var v = Number(n) || 0;
    try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: cur || 'NGN', maximumFractionDigits: 2 }).format(v); }
    catch (e) { return (cur || '') + ' ' + v.toLocaleString(); }
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthLabel(p) { if (!p) return ''; var a = p.split('-'); return MONTHS[Number(a[1]) - 1] + ' ' + a[0]; }
  function monthShort(p) { var a = p.split('-'); return MONTHS[Number(a[1]) - 1].slice(0, 3); }
  function fmtDate(d) {
    if (!d) return '';
    var x = new Date(d.length === 10 ? d + 'T00:00:00' : d);
    if (isNaN(x)) return d;
    return x.getDate() + ' ' + MONTHS[x.getMonth()].slice(0, 3) + ' ' + x.getFullYear();
  }
  function sheetDate(d) { if (!d) return ''; var a = d.slice(0, 10).split('-'); return Number(a[1]) + '/' + Number(a[2]) + '/' + a[0].slice(2); }
  function isoToday() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function thisPeriod() { return isoToday().slice(0, 7); }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function initials(name) { return String(name || '?').split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  function size(n) { n = Number(n) || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  var PILL = {
    paid: 'ok', approved: 'ok', filled: 'ok', acknowledged: 'ok', active: 'ok',
    pending: 'warn', submitted: 'warn', draft: 'warn', in_progress: 'info', sent: 'info', shortlist_sent: 'info',
    declined: 'bad', changes_requested: 'bad', closed: 'mute', inactive: 'mute'
  };
  var LABEL = { in_progress: 'in progress', shortlist_sent: 'shortlist sent', changes_requested: 'changes requested', time_off: 'time off', sent: 'awaiting payment' };
  function cap(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }
  function pill(status, text) { return '<span class="pill ' + (PILL[status] || 'mute') + '">' + esc(cap(text || LABEL[status] || status)) + '</span>'; }

  function fileToPayload(input) {
    var f = input && input.files && input.files[0];
    if (!f) return Promise.resolve(null);
    if (f.size > 3 * 1024 * 1024) return Promise.reject(new Error('Files must be 3 MB or smaller.'));
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve({ name: f.name, type: f.type || 'application/octet-stream', data: String(r.result).split(',')[1] }); };
      r.onerror = function () { reject(new Error('That file could not be read.')); };
      r.readAsDataURL(f);
    });
  }
  function formObj(form) {
    var o = {};
    new FormData(form).forEach(function (v, k) { if (typeof v === 'string') o[k] = v; });
    return o;
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Saving…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }
  function fileLink(id, label) {
    return '<a href="/api/portal?file=' + Number(id) + '" target="_blank" rel="noopener">' + esc(label || 'View') + '</a>';
  }
  function downloadText(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ================= modal ================= */
  function openModal(opts) {
    var inner = modal.querySelector('.modal-inner');
    inner.innerHTML =
      '<div class="modal-head"><h3>' + esc(opts.title) + '</h3><button class="close" type="button" aria-label="Close">×</button></div>' +
      '<div class="modal-body">' + opts.body + '</div>' +
      (opts.foot === false ? '' : '<div class="modal-foot">' + (opts.foot || '<button class="btn secondary" data-close type="button">Close</button>') + '</div>');
    modal.classList.toggle('wide', !!opts.wide);
    inner.querySelector('.close').onclick = closeModal;
    $$('[data-close]', inner).forEach(function (b) { b.onclick = closeModal; });
    if (!modal.open) modal.showModal();
    return inner;
  }
  function closeModal() { if (modal.open) modal.close(); }
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  /* ================= printable documents ================= */
  function printDoc(title, inner) {
    var w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups for this site to open the document.', true); return; }
    var logo = location.origin + '/assets/images/image07.png';
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>' +
      'body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#0d0f12;margin:0;background:#f4f6f7}' +
      '.bar{position:sticky;top:0;background:#011D38;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px}' +
      '.bar button{background:#fff;color:#011D38;border:0;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer}' +
      '.doc{background:#fff;max-width:820px;margin:24px auto;padding:44px 48px;box-shadow:0 2px 12px rgba(0,0,0,.08)}' +
      '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #011D38;padding-bottom:18px}' +
      '.top img{width:150px}.top h1{margin:0;font-size:26px;letter-spacing:.06em;color:#011D38;text-align:right}.top p{margin:4px 0 0;text-align:right;color:#555;font-size:13px}' +
      '.meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:22px 0;font-size:13px}.meta h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7178}' +
      '.meta div p{margin:2px 0}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}th{background:#eef3f5;text-align:left;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}' +
      'td{padding:9px 10px;border-bottom:1px solid #e3e6e8}.r{text-align:right;font-variant-numeric:tabular-nums}.tot td{font-weight:700;border-bottom:0}' +
      '.net{margin-top:22px;background:#011D38;color:#fff;border-radius:8px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;font-size:15px}.net b{font-size:24px}' +
      '.note{margin-top:18px;font-size:12px;color:#555;white-space:pre-wrap}.foot{margin-top:30px;border-top:1px solid #e3e6e8;padding-top:12px;font-size:11px;color:#6b7178;text-align:center}' +
      '.two{display:grid;grid-template-columns:1fr 1fr;gap:24px}@media(max-width:640px){.doc{padding:24px}.meta,.two{grid-template-columns:1fr}}' +
      '@media print{body{background:#fff}.bar{display:none}.doc{box-shadow:none;margin:0;max-width:none;padding:0}}' +
      '</style></head><body><div class="bar"><span>' + esc(title) + '</span><button onclick="window.print()">Print / Save as PDF</button></div>' +
      '<div class="doc">' + inner.replace(/%LOGO%/g, logo) + '</div></body></html>');
    w.document.close();
  }

  function lineRows(lines, cur) {
    if (!lines.length) return '<tr><td colspan="2" style="color:#6b7178">None</td></tr>';
    return lines.map(function (l) { return '<tr><td>' + esc(l.label) + '</td><td class="r">' + money(l.amount, cur) + '</td></tr>'; }).join('');
  }

  function payslipHtml(p, u) {
    var acct = u.account_number ? '•••• ' + String(u.account_number).slice(-4) : '';
    return '<div class="top"><img src="%LOGO%" alt="Dé Pitch"><div><h1>PAYSLIP</h1><p>' + esc(monthLabel(p.period)) + '</p></div></div>' +
      '<div class="meta"><div><h4>Employer</h4><p><b>Dé Pitch</b></p><p>office@depitchhq.com</p><p>peopleops@depitchhq.com</p></div>' +
      '<div><h4>Employee</h4><p><b>' + esc(u.name) + '</b></p>' + (u.employee_code ? '<p>ID: ' + esc(u.employee_code) + '</p>' : '') +
      (u.job_title ? '<p>' + esc(u.job_title) + '</p>' : '') + (u.client_name ? '<p>Client: ' + esc(u.client_name) + '</p>' : '') + '</div>' +
      '<div><h4>Payment</h4><p>Pay period: ' + esc(monthLabel(p.period)) + '</p><p>Paid on: ' + esc(fmtDate(p.paid_at)) + '</p>' +
      (p.payment_ref ? '<p>Reference: ' + esc(p.payment_ref) + '</p>' : '') + '</div>' +
      '<div><h4>Bank</h4>' + (u.bank_name ? '<p>' + esc(u.bank_name) + '</p>' : '<p>—</p>') + (acct ? '<p>' + esc(acct) + '</p>' : '') + '</div></div>' +
      '<div class="two"><div><table><thead><tr><th>Earnings</th><th class="r">Amount</th></tr></thead><tbody>' + lineRows(p.earnings, p.currency) +
      '<tr class="tot"><td>Gross pay</td><td class="r">' + money(p.gross, p.currency) + '</td></tr></tbody></table></div>' +
      '<div><table><thead><tr><th>Deductions</th><th class="r">Amount</th></tr></thead><tbody>' + lineRows(p.deductions, p.currency) +
      '<tr class="tot"><td>Total deductions</td><td class="r">' + money(p.total_deductions, p.currency) + '</td></tr></tbody></table></div></div>' +
      '<div class="net"><span>Net pay</span><b>' + money(p.net, p.currency) + '</b></div>' +
      (p.notes ? '<p class="note">' + esc(p.notes) + '</p>' : '') +
      '<p class="foot">Generated from the Dé Pitch portal on ' + esc(fmtDate(isoToday())) + '. Questions about this payslip? Email peopleops@depitchhq.com.</p>';
  }

  function invoiceHtml(inv, c) {
    var rows = inv.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="r">' + money(i.amount, inv.currency) + '</td></tr>'; }).join('');
    return '<div class="top"><img src="%LOGO%" alt="Dé Pitch"><div><h1>INVOICE</h1><p>' + esc(inv.number) + '</p><p>Status: ' + esc(LABEL[inv.status] || inv.status) + '</p></div></div>' +
      '<div class="meta"><div><h4>From</h4><p><b>Dé Pitch</b></p><p>office@depitchhq.com</p><p>+234 903 844 3500</p></div>' +
      '<div><h4>Bill to</h4><p><b>' + esc(c.name) + '</b></p>' + (c.contact_name ? '<p>' + esc(c.contact_name) + '</p>' : '') +
      (c.contact_email ? '<p>' + esc(c.contact_email) + '</p>' : '') + (c.address ? '<p>' + esc(c.address) + '</p>' : '') + '</div>' +
      '<div><h4>Details</h4><p>Service month: ' + esc(monthLabel(inv.period)) + '</p><p>Issued: ' + esc(fmtDate(inv.issue_date)) + '</p>' +
      (inv.due_date ? '<p>Due: ' + esc(fmtDate(inv.due_date)) + '</p>' : '') + '</div><div></div></div>' +
      '<table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead><tbody>' + rows +
      '<tr class="tot"><td class="r">Subtotal</td><td class="r">' + money(inv.subtotal, inv.currency) + '</td></tr>' +
      (Number(inv.tax) ? '<tr class="tot"><td class="r">Tax</td><td class="r">' + money(inv.tax, inv.currency) + '</td></tr>' : '') +
      '</tbody></table><div class="net"><span>Total due</span><b>' + money(inv.total, inv.currency) + '</b></div>' +
      (inv.notes ? '<p class="note">' + esc(inv.notes) + '</p>' : '') +
      '<p class="foot">Thank you for working with Dé Pitch. Questions about this invoice? Email peopleops@depitchhq.com.</p>';
  }

  /* weekly report: the same layout as the Excel template */
  function reportSheet(r, name) {
    var n = Math.max(r.tasks.length, r.blockers.length, 1);
    var rows = '';
    for (var i = 0; i < n; i++) {
      var t = r.tasks[i], b = r.blockers[i];
      rows += '<tr>' +
        (t ? '<td>' + (i + 1) + '</td><td>' + esc(t.description) + '</td><td>' + esc(t.status) + '</td><td class="num">' + esc(t.hours) + '</td><td>' + esc(t.outcome) + '</td>' : '<td></td><td></td><td></td><td></td><td></td>') +
        '<td class="gap"></td>' +
        (b ? '<td>' + esc(b.issue) + '</td><td>' + esc(b.impact) + '</td><td>' + esc(b.action) + '</td><td>' + esc(b.support) + '</td>' : '<td></td><td></td><td></td><td></td>') +
        '</tr>';
    }
    var hours = r.tasks.reduce(function (s, t) { return s + (Number(t.hours) || 0); }, 0);
    return '<div class="sheet"><table>' +
      (name ? '<tr><td class="k">Employee</td><td colspan="4">' + esc(name) + '</td><td class="gap"></td><td colspan="4"></td></tr>' : '') +
      '<tr><td class="k">Client Assigned</td><td colspan="4">' + esc(r.client_name) + '</td><td class="gap"></td><td colspan="4"></td></tr>' +
      '<tr><td class="k">Week Start Date</td><td colspan="4">' + esc(sheetDate(r.week_start)) + '</td><td class="gap"></td><td colspan="4"></td></tr>' +
      '<tr><td class="k">Week End Date</td><td colspan="4">' + esc(sheetDate(r.week_end)) + '</td><td class="gap"></td><td colspan="4"></td></tr>' +
      '<tr><td class="k">Submitted On</td><td colspan="4">' + esc(sheetDate(r.submitted_on)) + '</td><td class="gap"></td><td colspan="4"></td></tr>' +
      '<tr><td colspan="5" class="sec">SECTION : WEEKLY TASK SUMMARY</td><td class="gap"></td><td colspan="4" class="sec">SECTION : CHALLENGES / BLOCKERS</td></tr>' +
      '<tr><th>Task No.</th><th>Task Description</th><th>Status</th><th>Hours Spent</th><th>Outcome / Result</th><td class="gap"></td><th>Issue Encountered</th><th>Impact</th><th>Action Taken</th><th>Support Needed</th></tr>' +
      rows +
      '<tr><td></td><td class="k">Total hours</td><td></td><td class="num"><b>' + hours + '</b></td><td></td><td class="gap"></td><td colspan="4"></td></tr>' +
      '</table></div>';
  }

  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function reportCsv(r, name) {
    var out = [];
    var blank = function () { return ['', '', '', '', '', '', '', '', '', '']; };
    function row(a) { out.push(a.map(csvCell).join(',')); }
    if (name) row(['Employee', name]);
    row(['Client Assigned', r.client_name]);
    row(['Week Start Date', sheetDate(r.week_start)]);
    row(['Week End Date', sheetDate(r.week_end)]);
    row(['Submitted On', sheetDate(r.submitted_on)]);
    row(blank()); row(blank());
    row(['SECTION : WEEKLY TASK SUMMARY', '', '', '', '', '', 'SECTION : CHALLENGES / BLOCKERS', '', '', '']);
    row(['Task No.', 'Task Description', 'Status', 'Hours Spent', 'Outcome / Result', '', 'Issue Encountered', 'Impact', 'Action Taken', 'Support Needed']);
    var n = Math.max(r.tasks.length, r.blockers.length);
    for (var i = 0; i < n; i++) {
      var t = r.tasks[i] || {}, b = r.blockers[i] || {};
      row([t.description ? i + 1 : '', t.description, t.status, t.description ? t.hours : '', t.outcome, '', b.issue, b.impact, b.action, b.support]);
    }
    return '﻿' + out.join('\r\n');
  }
  function reportFileName(r, name) { return 'Weekly report ' + (name ? name + ' ' : '') + r.week_start + '.csv'; }

  /* ================= auth screens ================= */
  function authFrame(inner) {
    app.innerHTML = '<div class="auth"><div class="auth-art"><div><h2>Work that matters starts here.</h2>' +
      '<p>Pay, reports, requests, talent and documents for the people and companies who work with Dé Pitch.</p></div></div>' +
      '<div class="auth-form"><div class="auth-card"><a href="index.html"><img src="assets/images/image07.png" alt="dé pitch"></a>' + inner + '</div></div></div>';
  }

  function renderLogin(msg) {
    closeModal();
    authFrame('<div><h1>Sign in</h1><p class="muted" style="margin-top:6px">Employees, clients and People Ops all sign in here.</p></div>' +
      '<form id="login" class="stack" novalidate>' +
      '<label class="field">Email<input type="email" name="email" id="login-email" autocomplete="username" required></label>' +
      '<label class="field">Password<input type="password" name="password" id="login-password" autocomplete="current-password" required></label>' +
      '<p class="error" id="login-error">' + esc(msg || '') + '</p>' +
      '<button class="btn block" type="submit">Sign in</button></form>' +
      '<p class="small muted">Forgot your password or need an account? Email <b>' + esc(S.adminEmail) + '</b> and People Ops will reset it.</p>' +
      '<p class="small"><a href="index.html">← Back to depitchhq.com</a></p>');
    $('#login').onsubmit = function (e) {
      e.preventDefault();
      var btn = this.querySelector('button'); var err = $('#login-error');
      err.textContent = '';
      busy(btn, true, 'Signing in…');
      api('login', formObj(this)).then(function (j) { S.user = j.user; start(); })
        .catch(function (x) { err.textContent = x.message; busy(btn, false); });
    };
    $('#login-email').focus();
  }

  function renderSetup() {
    authFrame('<div><h1>Set up the portal</h1><p class="muted" style="margin-top:6px">This creates the People Ops account for <b>' + esc(S.adminEmail) + '</b>. It only works once.</p></div>' +
      '<form id="setup" class="stack" novalidate>' +
      '<label class="field">Setup key<input type="password" name="setupKey" id="setup-key" required><span class="hint">The SETUP_KEY value you added in Vercel.</span></label>' +
      '<label class="field">Your name<input name="name" id="setup-name" value="People Ops"></label>' +
      '<label class="field">Choose a password<input type="password" name="password" id="setup-password" autocomplete="new-password" required><span class="hint">At least 10 characters, with letters and numbers.</span></label>' +
      '<p class="error" id="setup-error"></p><button class="btn block" type="submit">Create People Ops account</button></form>');
    $('#setup').onsubmit = function (e) {
      e.preventDefault();
      var btn = this.querySelector('button');
      busy(btn, true);
      api('setup', formObj(this)).then(function (j) { S.user = j.user; start(); })
        .catch(function (x) { $('#setup-error').textContent = x.message; busy(btn, false); });
    };
  }

  function renderChangePassword() {
    closeModal();
    authFrame('<div><h1>Set your password</h1><p class="muted" style="margin-top:6px">Welcome' + (S.user ? ', ' + esc(S.user.name.split(' ')[0]) : '') +
      '. Replace the temporary password People Ops gave you.</p></div>' +
      '<form id="cp" class="stack" novalidate>' +
      '<label class="field">Temporary password<input type="password" name="current" id="cp-current" autocomplete="current-password" required></label>' +
      '<label class="field">New password<input type="password" name="next" id="cp-next" autocomplete="new-password" required><span class="hint">At least 10 characters, with letters and numbers.</span></label>' +
      '<label class="field">Confirm new password<input type="password" name="confirm" id="cp-confirm" autocomplete="new-password" required></label>' +
      '<p class="error" id="cp-error"></p><button class="btn block" type="submit">Save password</button></form>' +
      '<button class="btn ghost" id="cp-out" type="button">Sign out</button>');
    $('#cp').onsubmit = function (e) {
      e.preventDefault();
      var d = formObj(this);
      if (d.next !== d.confirm) { $('#cp-error').textContent = 'The new passwords do not match.'; return; }
      var btn = this.querySelector('button');
      busy(btn, true);
      api('changePassword', d).then(function () { toast('Password saved.'); boot(); })
        .catch(function (x) { $('#cp-error').textContent = x.message; busy(btn, false); });
    };
    $('#cp-out').onclick = signOut;
  }

  function signOut() { api('logout').finally(function () { S.user = null; location.hash = ''; renderLogin(); }); }

  /* ================= shell ================= */
  var NAV = {
    employee: [['overview', 'Overview'], ['pay', 'Pay & payslips'], ['reports', 'Weekly reports'], ['requests', 'Requests'], ['documents', 'Documents']],
    client: [['overview', 'Overview'], ['talents', 'Your talents'], ['invoices', 'Invoices'], ['recruitment', 'Request talent'], ['documents', 'Documents']],
    admin: [['inbox', 'Inbox', 'inbox'], ['people', 'People'], ['clients', 'Clients'], ['payroll', 'Payroll', 'payroll_pending'], ['invoices', 'Invoices', 'invoices_draft'],
      ['reports', 'Weekly reports', 'reports'], ['requests', 'Requests', 'requests'], ['recruitment', 'Talent requests', 'recruitment'],
      ['feedback', 'Reviews & removals', 'feedback'], ['documents', 'Documents'], ['announcements', 'Announcements']]
  };
  var ROLE_LABEL = { employee: 'Employee', client: 'Client', admin: 'People Ops' };

  function currentTab() {
    var tabs = NAV[S.user.role].map(function (n) { return n[0]; });
    var h = location.hash.replace(/^#\/?/, '');
    return tabs.indexOf(h) > -1 ? h : tabs[0];
  }

  function countFor(key) {
    var c = S.counts || {};
    if (key === 'inbox') return (c.reports || 0) + (c.requests || 0) + (c.recruitment || 0) + (c.feedback || 0);
    return c[key] || 0;
  }

  function renderShell() {
    var tab = currentTab();
    var nav = NAV[S.user.role].map(function (n) {
      var c = n[2] ? countFor(n[2]) : 0;
      return '<a href="#/' + n[0] + '" class="' + (n[0] === tab ? 'active' : '') + '"><span>' + esc(n[1]) + '</span>' + (c ? '<span class="count">' + c + '</span>' : '') + '</a>';
    }).join('');
    app.innerHTML =
      '<div class="shell"><aside class="side" id="side"><div class="brand"><img src="assets/images/image07.png" alt="dé pitch"><span>' + esc(ROLE_LABEL[S.user.role]) + '</span></div>' +
      '<nav class="nav" aria-label="Portal">' + nav + '</nav>' +
      '<div class="me"><div><b>' + esc(S.user.name) + '</b><span>' + esc(S.user.email) + '</span></div>' +
      '<button class="btn sm" id="pw-btn" type="button">Change password</button><button class="btn sm" id="out-btn" type="button">Sign out</button></div></aside>' +
      '<div class="main"><div class="topbar"><img src="assets/images/image07.png" alt="dé pitch"><button id="menu-btn" aria-label="Open menu" type="button">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button></div>' +
      '<div class="content" id="content"><p class="muted">Loading…</p></div></div></div>';
    $('#out-btn').onclick = signOut;
    $('#pw-btn').onclick = changePasswordModal;
    $('#menu-btn').onclick = function () { $('#side').classList.add('open'); };
    $('#side').addEventListener('click', function (e) { if (e.target.closest('a')) this.classList.remove('open'); });
    var fn = VIEWS[S.user.role][tab];
    fn($('#content')).catch(function (x) {
      $('#content').innerHTML = '<div class="panel"><p class="error">' + esc(x.message) + '</p><button class="btn secondary" id="retry" type="button">Try again</button></div>';
      $('#retry').onclick = renderShell;
    });
  }

  function refreshCounts() {
    if (S.user.role !== 'admin') return Promise.resolve();
    return api('adm.overview').then(function (j) {
      S.counts = j.counts;
      $$('.nav a').forEach(function (a) {
        var key = a.getAttribute('href').slice(2);
        var def = NAV.admin.filter(function (n) { return n[0] === key; })[0];
        if (!def || !def[2]) return;
        var c = countFor(def[2]);
        var badge = a.querySelector('.count');
        if (c && !badge) { badge = document.createElement('span'); badge.className = 'count'; a.appendChild(badge); }
        if (badge) { if (c) badge.textContent = c; else badge.remove(); }
      });
    }).catch(function () {});
  }

  function changePasswordModal() {
    var m = openModal({
      title: 'Change password',
      body: '<form id="cpm" class="stack"><label class="field">Current password<input type="password" name="current" id="cpm-current" required></label>' +
        '<label class="field">New password<input type="password" name="next" id="cpm-next" required><span class="hint">At least 10 characters, with letters and numbers.</span></label>' +
        '<label class="field">Confirm new password<input type="password" name="confirm" id="cpm-confirm" required></label><p class="error" id="cpm-error"></p></form>',
      foot: '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn" id="cpm-save" type="button">Save password</button>'
    });
    $('#cpm-save', m).onclick = function () {
      var d = formObj($('#cpm', m));
      if (d.next !== d.confirm) { $('#cpm-error', m).textContent = 'The new passwords do not match.'; return; }
      var btn = this; busy(btn, true);
      api('changePassword', d).then(function () { closeModal(); toast('Password changed.'); })
        .catch(function (x) { $('#cpm-error', m).textContent = x.message; busy(btn, false); });
    };
  }

  function head(title, sub, actions) {
    return '<div class="spread page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="row">' + actions + '</div>' : '') + '</div>';
  }
  function announceBar() {
    if (!S.announcements || !S.announcements.length) return '';
    return '<div class="announce"><span class="tag">Update</span><div class="msgs">' + S.announcements.map(function (a) {
      return '<span>' + esc(a.message) + (a.link ? ' <a href="' + esc(a.link) + '" target="_blank" rel="noopener">Read more</a>' : '') + '</span>';
    }).join('') + '</div></div>';
  }
  function table(headers, rows, emptyText) {
    if (!rows.length) return '<div class="table-wrap"><p class="empty">' + esc(emptyText || 'Nothing here yet.') + '</p></div>';
    return '<div class="table-wrap"><table class="t"><thead><tr>' + headers.map(function (h) {
      var right = h.charAt(0) === '>'; return '<th' + (right ? ' class="r"' : '') + '>' + esc(right ? h.slice(1) : h) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function docsTable(rows, opts) {
    opts = opts || {};
    return table(['Document', 'Type'].concat(opts.owner ? ['For'] : []).concat(['Added', '>']), rows.map(function (f) {
      return '<tr><td><b>' + esc(f.title) + '</b><div class="small muted">' + esc(f.filename) + ' · ' + size(f.size) + '</div></td><td>' + esc(f.category) + '</td>' +
        (opts.owner ? '<td>' + esc(f.owner_name || f.client_name || '') + '</td>' : '') +
        '<td>' + esc(fmtDate(f.created_at)) + '</td><td><div class="actions"><a class="btn sm secondary" href="/api/portal?file=' + f.id + '" target="_blank" rel="noopener">View</a>' +
        '<a class="btn sm secondary" href="/api/portal?file=' + f.id + '&dl=1">Download</a>' +
        (opts.del ? '<button class="btn sm danger" data-del-file="' + f.id + '" type="button">Delete</button>' : '') + '</div></td></tr>';
    }), opts.empty || 'No documents yet.');
  }

  /* ================= EMPLOYEE ================= */
  function earningsChart(rows) {
    var year = new Date().getFullYear();
    var byP = {};
    rows.forEach(function (r) { byP[r.period] = r; });
    var vals = [];
    for (var m = 1; m <= 12; m++) {
      var p = year + '-' + String(m).padStart(2, '0');
      vals.push({ p: p, r: byP[p] });
    }
    var max = Math.max.apply(null, vals.map(function (v) { return v.r ? Number(v.r.net) : 0; }).concat([1]));
    var cur = (rows[0] && rows[0].currency) || S.user.pay_currency;
    return '<div class="bars" role="img" aria-label="Net pay by month in ' + year + '">' + vals.map(function (v) {
      var net = v.r ? Number(v.r.net) : 0;
      var h = net ? Math.max(3, Math.round(net / max * 100)) : 0;
      var cls = v.r ? (v.r.status === 'paid' ? 'paid' : 'pending') : '';
      return '<div class="bar ' + cls + '" title="' + esc(monthLabel(v.p) + (v.r ? ': ' + money(net, v.r.currency) + ' (' + v.r.status + ')' : ': no pay record')) + '">' +
        '<div class="fill-wrap"><div class="fill" style="height:' + h + '%">' + (net ? '<span class="amt">' + esc(compact(net, cur)) + '</span>' : '') + '</div></div><span class="m">' + monthShort(v.p) + '</span></div>';
    }).join('') + '</div><div class="legend"><span><i style="background:var(--navy)"></i>Paid</span><span><i style="background:var(--sage)"></i>Pending</span></div>';
  }
  function compact(n, cur) {
    try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: cur || 'NGN', notation: 'compact', maximumFractionDigits: 1 }).format(n); }
    catch (e) { return String(Math.round(n)); }
  }

  var EMP = {};
  EMP.overview = function (el) {
    return api('emp.dashboard').then(function (j) {
      var rows = j.payroll;
      var year = String(new Date().getFullYear());
      var cur = (rows[0] && rows[0].currency) || j.profile.pay_currency;
      var thisMonth = rows.filter(function (r) { return r.period === thisPeriod(); })[0];
      var ytd = rows.filter(function (r) { return r.period.indexOf(year) === 0 && r.status === 'paid'; }).reduce(function (s, r) { return s + Number(r.net); }, 0);
      var lastPaid = rows.filter(function (r) { return r.status === 'paid'; })[0];
      var lr = j.lastReport;
      el.innerHTML = announceBar() +
        head('Hi, ' + j.profile.name.split(' ')[0], esc([j.profile.job_title, j.profile.client_name ? 'placed with ' + j.profile.client_name : ''].filter(Boolean).join(' · '))) +
        '<div class="stats">' +
        '<div class="stat hero"><span class="label">' + esc(MONTHS[new Date().getMonth()]) + ' earnings</span><span class="value">' + (thisMonth ? money(thisMonth.net, thisMonth.currency) : '—') + '</span>' +
        '<span class="sub">' + (thisMonth ? (thisMonth.status === 'paid' ? 'Paid ' + esc(fmtDate(thisMonth.paid_at)) : 'Pending payment') : 'Not added yet') + '</span></div>' +
        '<div class="stat"><span class="label">Earned in ' + year + '</span><span class="value">' + money(ytd, cur) + '</span><span class="sub">Net pay received so far</span></div>' +
        '<div class="stat"><span class="label">Last payment</span><span class="value">' + (lastPaid ? money(lastPaid.net, lastPaid.currency) : '—') + '</span><span class="sub">' + (lastPaid ? esc(monthLabel(lastPaid.period)) : 'No payments yet') + '</span></div>' +
        '<div class="stat"><span class="label">Last weekly report</span><span class="value" style="font-size:1.1rem">' + (lr ? esc(fmtDate(lr.week_start)) : 'None yet') + '</span><span class="sub">' + (lr ? pill(lr.status) : '<a href="#/reports">Submit your first report</a>') + '</span></div>' +
        '</div>' +
        '<div class="cols"><div class="panel"><div class="panel-head"><h2>Earnings by month, ' + year + '</h2><a class="btn sm secondary" href="#/pay">All payslips</a></div>' + earningsChart(rows) + '</div>' +
        '<div class="panel stack"><h2>Quick actions</h2>' +
        '<a class="btn" href="#/reports">Submit weekly report</a>' +
        '<a class="btn secondary" href="#/requests">Request time off or a reimbursement</a>' +
        '<a class="btn secondary" href="#/documents">My documents (' + j.counts.documents + ')</a>' +
        (j.counts.pending_requests ? '<p class="small muted">' + j.counts.pending_requests + ' request(s) waiting for People Ops.</p>' : '') + '</div></div>';
    });
  };

  EMP.pay = function (el) {
    return api('emp.payroll').then(function (j) {
      el.innerHTML = announceBar() + head('Pay & payslips', 'People Ops updates this page when you are paid. Generate a payslip for any paid month.') +
        table(['Month', '>Gross', '>Deductions', '>Net pay', 'Status', 'Paid on', '>'], j.rows.map(function (r) {
          return '<tr><td><b>' + esc(monthLabel(r.period)) + '</b></td><td class="r">' + money(r.gross, r.currency) + '</td><td class="r">' + money(r.total_deductions, r.currency) +
            '</td><td class="r"><b>' + money(r.net, r.currency) + '</b></td><td>' + pill(r.status) + '</td><td>' + esc(fmtDate(r.paid_at)) + '</td>' +
            '<td><div class="actions">' + (r.status === 'paid' ? '<button class="btn sm" data-slip="' + esc(r.period) + '" type="button">Generate payslip</button>' : '<span class="small muted">Available once paid</span>') + '</div></td></tr>';
        }), 'No pay records yet. They appear here once People Ops adds your pay.');
      $$('[data-slip]', el).forEach(function (b) {
        b.onclick = function () {
          var p = b.getAttribute('data-slip');
          api('emp.payslip', { period: p }).then(function (s) { printDoc('Payslip ' + monthLabel(p), payslipHtml(s.payslip, s.profile)); })
            .catch(function (x) { toast(x.message, true); });
        };
      });
    });
  };

  function weekBounds() {
    var t = new Date(isoToday() + 'T00:00:00');
    var dow = (t.getDay() + 6) % 7; // Monday = 0
    var mon = addDays(isoToday(), -dow);
    return { start: mon, end: addDays(mon, 4) };
  }
  var STATUSES = ['Completed', 'In progress', 'Not started', 'Blocked', 'Ongoing'];

  function taskLine(i, t) {
    t = t || {};
    return '<div class="line task-line"><span class="no">' + (i + 1) + '</span>' +
      '<textarea name="description" placeholder="What you worked on" aria-label="Task description">' + esc(t.description) + '</textarea>' +
      '<select name="status" aria-label="Status">' + STATUSES.map(function (s) { return '<option' + (t.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<input name="hours" type="number" min="0" step="0.25" placeholder="0" aria-label="Hours spent" value="' + esc(t.hours || '') + '">' +
      '<textarea name="outcome" placeholder="Outcome / result" aria-label="Outcome or result">' + esc(t.outcome) + '</textarea>' +
      '<button class="x" type="button" aria-label="Remove task">×</button></div>';
  }
  function blockerLine(b) {
    b = b || {};
    return '<div class="line blocker-line"><textarea name="issue" placeholder="Issue encountered" aria-label="Issue encountered">' + esc(b.issue) + '</textarea>' +
      '<textarea name="impact" placeholder="Impact" aria-label="Impact">' + esc(b.impact) + '</textarea>' +
      '<textarea name="action" placeholder="Action taken" aria-label="Action taken">' + esc(b.action) + '</textarea>' +
      '<textarea name="support" placeholder="Support needed" aria-label="Support needed">' + esc(b.support) + '</textarea>' +
      '<button class="x" type="button" aria-label="Remove blocker">×</button></div>';
  }
  function renumber(box) { $$('.task-line .no', box).forEach(function (n, i) { n.textContent = i + 1; }); }

  EMP.reports = function (el) {
    return api('emp.reports').then(function (j) {
      var wb = weekBounds();
      el.innerHTML = announceBar() + head('Weekly reports', 'Submit one report each week. People Ops reviews it and you will see the decision here.') +
        '<form class="panel stack" id="wr" novalidate>' +
        '<div class="grid-3"><label class="field">Client assigned<input name="client_name" id="wr-client" value="' + esc(S.user.client_name) + '" placeholder="Client name"></label>' +
        '<label class="field">Week start date<input type="date" name="week_start" id="wr-start" value="' + wb.start + '" required></label>' +
        '<label class="field">Week end date<input type="date" name="week_end" id="wr-end" value="' + wb.end + '" required></label></div>' +
        '<p class="small muted">Submitted on: ' + esc(fmtDate(isoToday())) + ' (added automatically)</p>' +
        '<div class="section-label">Section: weekly task summary</div>' +
        '<div class="line-head task-line"><span>No.</span><span>Task description</span><span>Status</span><span>Hours</span><span>Outcome / result</span><span></span></div>' +
        '<div class="lines" id="wr-tasks">' + taskLine(0) + taskLine(1) + taskLine(2) + '</div>' +
        '<div><button class="btn sm secondary" id="add-task" type="button">+ Add task</button></div>' +
        '<div class="section-label">Section: challenges / blockers</div>' +
        '<div class="line-head blocker-line"><span>Issue encountered</span><span>Impact</span><span>Action taken</span><span>Support needed</span><span></span></div>' +
        '<div class="lines" id="wr-blockers">' + blockerLine() + '</div>' +
        '<div><button class="btn sm secondary" id="add-blocker" type="button">+ Add blocker</button></div>' +
        '<p class="error" id="wr-error"></p><div class="row" style="justify-content:flex-end"><button class="btn" type="submit">Submit weekly report</button></div></form>' +
        '<div class="panel"><div class="panel-head"><h2>Your reports</h2></div>' +
        table(['Week', 'Client', '>Tasks', '>Hours', 'Status', 'People Ops note', '>'], j.rows.map(function (r, i) {
          var hrs = r.tasks.reduce(function (s, t) { return s + (Number(t.hours) || 0); }, 0);
          return '<tr><td><b>' + esc(fmtDate(r.week_start)) + '</b> – ' + esc(fmtDate(r.week_end)) + '</td><td>' + esc(r.client_name) + '</td><td class="r">' + r.tasks.length +
            '</td><td class="r">' + hrs + '</td><td>' + pill(r.status) + '</td><td class="small">' + esc(r.hr_note) + '</td>' +
            '<td><div class="actions"><button class="btn sm secondary" data-view="' + i + '" type="button">View</button><button class="btn sm secondary" data-csv="' + i + '" type="button">Download</button></div></td></tr>';
        }), 'No reports yet.') + '</div>';

      var tasks = $('#wr-tasks', el), blockers = $('#wr-blockers', el);
      $('#add-task', el).onclick = function () { tasks.insertAdjacentHTML('beforeend', taskLine(tasks.children.length)); };
      $('#add-blocker', el).onclick = function () { blockers.insertAdjacentHTML('beforeend', blockerLine()); };
      el.addEventListener('click', function (e) {
        var x = e.target.closest('.x');
        if (!x) return;
        var box = x.closest('.lines');
        if (box.children.length > 1) { x.closest('.line').remove(); renumber(box); }
        else $$('textarea,input', x.closest('.line')).forEach(function (i) { i.value = ''; });
      });
      $$('[data-view]', el).forEach(function (b) {
        b.onclick = function () {
          var r = j.rows[Number(b.getAttribute('data-view'))];
          var m = openModal({ title: 'Weekly report · ' + fmtDate(r.week_start), wide: true,
            body: reportSheet(r) + (r.hr_note ? '<p><b>People Ops note:</b> ' + esc(r.hr_note) + '</p>' : ''),
            foot: '<button class="btn secondary" id="m-csv" type="button">Download (Excel / CSV)</button><button class="btn" data-close type="button">Close</button>' });
          $('#m-csv', m).onclick = function () { downloadText(reportFileName(r), reportCsv(r)); };
        };
      });
      $$('[data-csv]', el).forEach(function (b) {
        b.onclick = function () { var r = j.rows[Number(b.getAttribute('data-csv'))]; downloadText(reportFileName(r), reportCsv(r)); };
      });
      $('#wr', el).onsubmit = function (e) {
        e.preventDefault();
        var d = formObj(this);
        d.tasks = $$('.task-line', tasks).map(function (l) {
          return { description: $('[name=description]', l).value, status: $('[name=status]', l).value, hours: $('[name=hours]', l).value, outcome: $('[name=outcome]', l).value };
        });
        d.blockers = $$('.blocker-line', blockers).map(function (l) {
          return { issue: $('[name=issue]', l).value, impact: $('[name=impact]', l).value, action: $('[name=action]', l).value, support: $('[name=support]', l).value };
        });
        var btn = this.querySelector('[type=submit]');
        busy(btn, true, 'Submitting…');
        api('emp.submitReport', d).then(function () { toast('Weekly report submitted.'); renderShell(); })
          .catch(function (x) { $('#wr-error').textContent = x.message; busy(btn, false); });
      };
    });
  };

  EMP.requests = function (el) {
    return api('emp.requests').then(function (j) {
      var cur = S.user.pay_currency || 'NGN';
      el.innerHTML = announceBar() + head('Requests', 'Ask for time off, claim a reimbursement, or send People Ops anything else.') +
        '<div class="panel stack"><div class="seg" role="tablist"><button class="on" data-type="time_off" type="button">Time off</button><button data-type="reimbursement" type="button">Reimbursement</button><button data-type="other" type="button">Something else</button></div>' +
        '<form id="rq" class="stack" novalidate><input type="hidden" name="type" value="time_off">' +
        '<div data-for="time_off" class="grid-3"><label class="field">Type of leave<select name="leave_type" id="rq-leave"><option>Annual leave</option><option>Sick leave</option><option>Personal day</option><option>Compassionate leave</option><option>Other leave</option></select></label>' +
        '<label class="field">First day off<input type="date" name="start_date" id="rq-start"></label><label class="field">Last day off<input type="date" name="end_date" id="rq-end"></label></div>' +
        '<div data-for="reimbursement" class="grid-3" hidden><label class="field">What it was for<input name="title" id="rq-title-r" placeholder="e.g. Transport to client office"></label>' +
        '<label class="field">Amount (' + esc(cur) + ')<input type="number" name="amount" id="rq-amount" min="0" step="0.01"></label>' +
        '<label class="field">Receipt<input type="file" name="receipt" id="rq-file" accept=".pdf,.png,.jpg,.jpeg"><span class="hint">PDF or photo, up to 3 MB</span></label></div>' +
        '<div data-for="other" hidden><label class="field">Subject<input name="title" id="rq-title-o" placeholder="What is this about?"></label></div>' +
        '<label class="field">Details<textarea name="details" id="rq-details" placeholder="Anything People Ops should know"></textarea></label>' +
        '<p class="error" id="rq-error"></p><div class="row" style="justify-content:flex-end"><button class="btn" type="submit">Send request</button></div></form></div>' +
        '<div class="panel"><div class="panel-head"><h2>Your requests</h2></div>' +
        table(['Sent', 'Type', 'Request', '>Amount', 'Status', 'People Ops note'], j.rows.map(function (r) {
          return '<tr><td>' + esc(fmtDate(r.created_at)) + '</td><td>' + esc(cap(LABEL[r.type] || r.type)) + '</td><td><b>' + esc(r.title) + '</b>' +
            (r.start_date ? '<div class="small muted">' + esc(fmtDate(r.start_date)) + ' – ' + esc(fmtDate(r.end_date)) + '</div>' : '') +
            '<div class="small muted">' + esc(r.details) + '</div>' + (r.file_id ? '<div class="small">' + fileLink(r.file_id, 'Receipt') + '</div>' : '') + '</td>' +
            '<td class="r">' + (Number(r.amount) ? money(r.amount, r.currency) : '') + '</td><td>' + pill(r.status) + '</td><td class="small">' + esc(r.hr_note) + '</td></tr>';
        }), 'No requests yet.') + '</div>';

      var form = $('#rq', el);
      $$('.seg button', el).forEach(function (b) {
        b.onclick = function () {
          $$('.seg button', el).forEach(function (x) { x.classList.toggle('on', x === b); });
          var t = b.getAttribute('data-type');
          form.type.value = t;
          $$('[data-for]', form).forEach(function (s) {
            s.hidden = s.getAttribute('data-for') !== t;
            $$('input,select', s).forEach(function (i) { i.disabled = s.hidden; });
          });
        };
      });
      $$('[data-for]', form).forEach(function (s) { $$('input,select', s).forEach(function (i) { i.disabled = s.hidden; }); });
      form.onsubmit = function (e) {
        e.preventDefault();
        var d = formObj(form);
        var btn = form.querySelector('[type=submit]');
        busy(btn, true, 'Sending…');
        fileToPayload(d.type === 'reimbursement' ? $('#rq-file', form) : null).then(function (f) {
          if (f) d.file = f;
          d.currency = cur;
          return api('emp.submitRequest', d);
        }).then(function () { toast('Request sent to People Ops.'); renderShell(); })
          .catch(function (x) { $('#rq-error').textContent = x.message; busy(btn, false); });
      };
    });
  };

  EMP.documents = function (el) {
    return api('emp.documents').then(function (j) {
      el.innerHTML = announceBar() + head('Documents', 'Your onboarding documents, employment letter and anything else People Ops shares with you.') +
        docsTable(j.rows, { empty: 'No documents yet. People Ops will upload them here.' });
    });
  };

  /* ================= CLIENT ================= */
  var CLI = {};
  function talentModal(t, kind) {
    var removal = kind === 'removal';
    var m = openModal({
      title: (removal ? 'Request removal: ' : 'Review ') + t.name,
      body: '<form id="tf" class="stack">' + (removal
        ? '<p class="muted">People Ops will contact you before anything changes. A removal only takes effect once People Ops approves it.</p>' +
          '<label class="field">Effective date<input type="date" name="effective_date" id="tf-date" value="' + addDays(isoToday(), 14) + '" required></label>' +
          '<label class="field">Reason<textarea name="comments" id="tf-comments" required placeholder="Tell us what has happened"></textarea></label>'
        : '<div class="field">Rating<div class="stars" id="tf-stars">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-n="' + n + '" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">★</button>'; }).join('') + '</div></div>' +
          '<label class="field">Comments<textarea name="comments" id="tf-comments" required placeholder="What is going well, and what could be better?"></textarea></label>') +
        '<p class="error" id="tf-error"></p></form>',
      foot: '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn' + (removal ? ' danger' : '') + '" id="tf-send" type="button">' + (removal ? 'Send removal request' : 'Send review') + '</button>'
    });
    var rating = 0;
    $$('#tf-stars button', m).forEach(function (b) {
      b.onclick = function () { rating = Number(b.getAttribute('data-n')); $$('#tf-stars button', m).forEach(function (x) { x.classList.toggle('on', Number(x.getAttribute('data-n')) <= rating); }); };
    });
    $('#tf-send', m).onclick = function () {
      var d = formObj($('#tf', m));
      d.kind = kind; d.talent_id = t.id; d.rating = rating;
      var btn = this; busy(btn, true, 'Sending…');
      api('cli.submitFeedback', d).then(function () { closeModal(); toast(removal ? 'Removal request sent to People Ops.' : 'Thanks, your review was sent.'); renderShell(); })
        .catch(function (x) { $('#tf-error', m).textContent = x.message; busy(btn, false); });
    };
  }

  CLI.overview = function (el) {
    return api('cli.dashboard').then(function (j) {
      var cur = (j.client && j.client.currency) || 'NGN';
      var monthly = j.talents.reduce(function (s, t) { return s + Number(t.bill_rate || 0); }, 0);
      var outstanding = j.invoices.filter(function (i) { return i.status === 'sent'; });
      var owed = outstanding.reduce(function (s, i) { return s + Number(i.total); }, 0);
      var pm = j.payroll;
      el.innerHTML = announceBar() + head(j.client ? j.client.name : 'Overview', 'Your Dé Pitch talents, payroll and invoices in one place.') +
        '<div class="stats">' +
        '<div class="stat hero"><span class="label">Talents placed</span><span class="value">' + j.talents.length + '</span><span class="sub">Active with your company</span></div>' +
        '<div class="stat"><span class="label">Monthly payroll</span><span class="value">' + money(monthly, cur) + '</span><span class="sub">Current monthly rate for all talents</span></div>' +
        '<div class="stat"><span class="label">Outstanding invoices</span><span class="value">' + money(owed, cur) + '</span><span class="sub">' + outstanding.length + ' awaiting payment</span></div>' +
        '<div class="stat"><span class="label">Open talent requests</span><span class="value">' + j.openRecruitment + '</span><span class="sub"><a href="#/recruitment">Request a new talent</a></span></div></div>' +
        '<div class="panel"><div class="panel-head"><h2>Payroll by month, per talent</h2><span class="small muted">From your invoices</span></div>' +
        (pm.periods.length ? table(['Talent'].concat(pm.periods.map(function (p) { return '>' + monthShort(p) + ' ' + p.slice(2, 4); })).concat(['>Total']), pm.rows.map(function (r) {
          var tot = 0;
          return '<tr><td><b>' + esc(r.name) + '</b></td>' + pm.periods.map(function (p) { var v = r.amounts[p] || 0; tot += v; return '<td class="r">' + (v ? money(v, pm.currency) : '—') + '</td>'; }).join('') +
            '<td class="r"><b>' + money(tot, pm.currency) + '</b></td></tr>';
        }).concat(['<tr><td><b>Total</b></td>' + pm.periods.map(function (p) {
          var s = pm.rows.reduce(function (a, r) { return a + (r.amounts[p] || 0); }, 0); return '<td class="r"><b>' + money(s, pm.currency) + '</b></td>';
        }).join('') + '<td></td></tr>'])) : '<p class="empty">Monthly payroll appears here once your first invoice is issued.</p>') + '</div>' +
        '<div class="panel"><div class="panel-head"><h2>Recent invoices</h2><a class="btn sm secondary" href="#/invoices">All invoices</a></div>' + invoiceTable(j.invoices.slice(0, 5)) + '</div>';
      bindInvoiceButtons(el, 'cli.invoice');
    });
  };

  function invoiceTable(rows) {
    return table(['Invoice', 'Month', 'Due', '>Total', 'Status', '>'], rows.map(function (i) {
      return '<tr><td><b>' + esc(i.number) + '</b></td><td>' + esc(monthLabel(i.period)) + '</td><td>' + esc(fmtDate(i.due_date)) + '</td><td class="r">' + money(i.total, i.currency) +
        '</td><td>' + pill(i.status) + '</td><td><div class="actions"><button class="btn sm secondary" data-inv="' + i.id + '" type="button">View / download</button></div></td></tr>';
    }), 'No invoices yet.');
  }
  function bindInvoiceButtons(el, action) {
    $$('[data-inv]', el).forEach(function (b) {
      b.onclick = function () {
        api(action, { id: b.getAttribute('data-inv') }).then(function (j) { printDoc('Invoice ' + j.invoice.number, invoiceHtml(j.invoice, j.client)); })
          .catch(function (x) { toast(x.message, true); });
      };
    });
  }

  CLI.talents = function (el) {
    return Promise.all([api('cli.dashboard'), api('cli.feedback')]).then(function (res) {
      var j = res[0], fb = res[1].rows;
      var cur = (j.client && j.client.currency) || 'NGN';
      el.innerHTML = announceBar() + head('Your talents', 'Review a talent at any time. If a placement is not working, send a removal request and People Ops will follow up.') +
        (j.talents.length ? '<div class="talents">' + j.talents.map(function (t) {
          return '<div class="talent"><div class="who"><div class="avatar">' + esc(initials(t.name)) + '</div><div><b>' + esc(t.name) + '</b><div class="small muted">' + esc(t.job_title) + '</div></div></div>' +
            '<dl><dt>Started</dt><dd>' + esc(fmtDate(t.start_date) || '—') + '</dd><dt>Monthly rate</dt><dd>' + money(t.bill_rate, cur) + '</dd><dt>Email</dt><dd>' + esc(t.email) + '</dd></dl>' +
            '<div class="row"><button class="btn sm" data-review="' + t.id + '" type="button">Write a review</button><button class="btn sm danger" data-remove="' + t.id + '" type="button">Request removal</button></div></div>';
        }).join('') + '</div>' : '<div class="panel"><p class="empty">No talents are placed with you yet. <a href="#/recruitment">Request a talent</a>.</p></div>') +
        '<div class="panel"><div class="panel-head"><h2>Reviews and removal requests</h2></div>' +
        table(['Date', 'Talent', 'Type', 'Details', 'Status', 'People Ops note'], fb.map(function (f) {
          return '<tr><td>' + esc(fmtDate(f.created_at)) + '</td><td><b>' + esc(f.talent_name) + '</b></td><td>' + (f.kind === 'removal' ? 'Removal' : 'Review ' + '★'.repeat(f.rating)) +
            '</td><td class="small">' + esc(f.comments) + (f.effective_date ? '<div class="muted">Effective ' + esc(fmtDate(f.effective_date)) + '</div>' : '') + '</td><td>' + pill(f.status) + '</td><td class="small">' + esc(f.hr_note) + '</td></tr>';
        }), 'Nothing sent yet.') + '</div>';
      var byId = {};
      j.talents.forEach(function (t) { byId[t.id] = t; });
      $$('[data-review]', el).forEach(function (b) { b.onclick = function () { talentModal(byId[b.getAttribute('data-review')], 'review'); }; });
      $$('[data-remove]', el).forEach(function (b) { b.onclick = function () { talentModal(byId[b.getAttribute('data-remove')], 'removal'); }; });
    });
  };

  CLI.invoices = function (el) {
    return api('cli.dashboard').then(function (j) {
      el.innerHTML = announceBar() + head('Invoices', 'Every monthly invoice from Dé Pitch. Open one to print or save it as a PDF.') + invoiceTable(j.invoices);
      bindInvoiceButtons(el, 'cli.invoice');
    });
  };

  CLI.recruitment = function (el) {
    return api('cli.recruitment').then(function (j) {
      el.innerHTML = announceBar() + head('Request talent', 'Tell us who you need. People Ops will source candidates and share a shortlist here.') +
        '<form class="panel stack" id="rc" novalidate><div class="grid-3">' +
        '<label class="field">Role title<input name="role_title" id="rc-role" required placeholder="e.g. Social Media Manager"></label>' +
        '<label class="field">How many<input type="number" name="headcount" id="rc-count" min="1" max="100" value="1"></label>' +
        '<label class="field">Employment type<select name="employment_type" id="rc-type"><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Remote</option><option>Hybrid</option></select></label>' +
        '<label class="field">Monthly budget<input name="budget" id="rc-budget" placeholder="e.g. ₦400,000 – ₦550,000"></label>' +
        '<label class="field">Ideal start date<input type="date" name="start_date" id="rc-start"></label></div>' +
        '<label class="field">Skills and requirements<textarea name="skills" id="rc-skills" required placeholder="Experience, tools, responsibilities, working hours"></textarea></label>' +
        '<label class="field">Anything else<textarea name="notes" id="rc-notes"></textarea></label>' +
        '<p class="error" id="rc-error"></p><div class="row" style="justify-content:flex-end"><button class="btn" type="submit">Send talent request</button></div></form>' +
        '<div class="panel"><div class="panel-head"><h2>Your requests</h2></div>' +
        table(['Sent', 'Role', '>Count', 'Status', 'Update from People Ops'], j.rows.map(function (r) {
          return '<tr><td>' + esc(fmtDate(r.created_at)) + '</td><td><b>' + esc(r.role_title) + '</b><div class="small muted">' + esc(r.employment_type) + (r.budget ? ' · ' + esc(r.budget) : '') + '</div></td><td class="r">' + r.headcount +
            '</td><td>' + pill(r.status) + '</td><td class="small">' + esc(r.hr_note) + (r.file_id ? '<div>' + fileLink(r.file_id, 'Open shortlist') + '</div>' : '') + '</td></tr>';
        }), 'No talent requests yet.') + '</div>';
      $('#rc', el).onsubmit = function (e) {
        e.preventDefault();
        var btn = this.querySelector('[type=submit]'); busy(btn, true, 'Sending…');
        api('cli.submitRecruitment', formObj(this)).then(function () { toast('Talent request sent to People Ops.'); renderShell(); })
          .catch(function (x) { $('#rc-error').textContent = x.message; busy(btn, false); });
      };
    });
  };

  CLI.documents = function (el) {
    return api('cli.documents').then(function (j) {
      el.innerHTML = announceBar() + head('Documents', 'Agreements, shortlists and other files from Dé Pitch.') + docsTable(j.rows, { empty: 'No documents yet.' });
    });
  };

  /* ================= ADMIN (People Ops) ================= */
  var ADM = {};
  var cache = { users: null, clients: null };
  function loadPeople(force) {
    if (cache.users && cache.clients && !force) return Promise.resolve(cache);
    return Promise.all([api('adm.users'), api('adm.clients')]).then(function (r) { cache.users = r[0].rows; cache.clients = r[1].rows; return cache; });
  }
  function clientOptions(sel, includeNone) {
    return (includeNone ? '<option value="">— Not placed —</option>' : '<option value="">Choose a company</option>') +
      cache.clients.map(function (c) { return '<option value="' + c.id + '"' + (Number(sel) === Number(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
  }
  function employeeOptions(sel) {
    return '<option value="">Choose an employee</option>' + cache.users.filter(function (u) { return u.role === 'employee'; }).map(function (u) {
      return '<option value="' + u.id + '"' + (Number(sel) === Number(u.id) ? ' selected' : '') + '>' + esc(u.name) + (u.active ? '' : ' (off)') + '</option>';
    }).join('');
  }
  function after(msg) { return function () { closeModal(); toast(msg); refreshCounts(); renderShell(); }; }
  function errIn(m, id) { return function (x) { var e = $(id, m); if (e) e.textContent = x.message; else toast(x.message, true); $$('.modal-foot .btn', m).forEach(function (b) { busy(b, false); }); }; }

  ADM.inbox = function (el) {
    return Promise.all([api('adm.overview'), api('adm.reports', { status: 'submitted' }), api('adm.requests', { status: 'pending' }), api('adm.recruitment'), api('adm.feedback')]).then(function (r) {
      S.counts = r[0].counts;
      var c = r[0].counts;
      var rec = r[3].rows.filter(function (x) { return x.status === 'submitted' || x.status === 'in_progress'; });
      var fb = r[4].rows.filter(function (x) { return x.status === 'submitted'; });
      function block(title, href, rows, empty) {
        return '<div class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2><a class="btn sm secondary" href="' + href + '">Open</a></div>' + (rows.length ? table([], rows) : '<p class="empty">' + esc(empty) + '</p>') + '</div>';
      }
      el.innerHTML = head('Inbox', 'Everything employees and clients have sent that needs a decision.') +
        '<div class="stats"><div class="stat hero"><span class="label">Waiting on you</span><span class="value">' + (c.reports + c.requests + c.recruitment + c.feedback) + '</span><span class="sub">Reports, requests, talent and reviews</span></div>' +
        '<div class="stat"><span class="label">Active employees</span><span class="value">' + c.employees + '</span><span class="sub">' + c.clients + ' active clients</span></div>' +
        '<div class="stat"><span class="label">Pay not yet marked paid</span><span class="value">' + c.payroll_pending + '</span><span class="sub"><a href="#/payroll">Go to payroll</a></span></div>' +
        '<div class="stat"><span class="label">Invoices</span><span class="value">' + c.invoices_draft + ' draft</span><span class="sub">' + c.invoices_unpaid + ' sent and unpaid</span></div></div>' +
        '<div class="cols"><div class="stack">' +
        block('Weekly reports to review (' + c.reports + ')', '#/reports', r[1].rows.slice(0, 6).map(function (x) {
          return '<tr><td><b>' + esc(x.name) + '</b><div class="small muted">' + esc(x.client_name) + '</div></td><td>' + esc(fmtDate(x.week_start)) + ' – ' + esc(fmtDate(x.week_end)) + '</td><td class="r">' + x.tasks.length + ' tasks</td></tr>';
        }), 'No reports waiting.') +
        block('Employee requests (' + c.requests + ')', '#/requests', r[2].rows.slice(0, 6).map(function (x) {
          return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + esc(LABEL[x.type] || x.type) + ': ' + esc(x.title) + '</td><td class="r">' + (Number(x.amount) ? money(x.amount, x.currency) : esc(fmtDate(x.start_date))) + '</td></tr>';
        }), 'No requests waiting.') + '</div><div class="stack">' +
        block('Talent requests (' + c.recruitment + ')', '#/recruitment', rec.slice(0, 6).map(function (x) {
          return '<tr><td><b>' + esc(x.client_name) + '</b></td><td>' + esc(x.role_title) + ' × ' + x.headcount + '</td><td>' + pill(x.status) + '</td></tr>';
        }), 'No open talent requests.') +
        block('Reviews & removals (' + c.feedback + ')', '#/feedback', fb.slice(0, 6).map(function (x) {
          return '<tr><td><b>' + esc(x.talent_name) + '</b><div class="small muted">' + esc(x.client_name) + '</div></td><td>' + (x.kind === 'removal' ? '<span class="pill bad">Removal</span>' : 'Review ' + '★'.repeat(x.rating)) + '</td></tr>';
        }), 'Nothing new from clients.') + '</div></div>';
      refreshCounts();
    });
  };

  /* ---- People ---- */
  function personForm(u, role) {
    u = u || {}; role = u.role || role;
    var emp = role === 'employee';
    return '<form id="pf" class="stack">' +
      (u.id ? '' : '<div class="grid-2"><label class="field">Role<select name="role" id="pf-role"><option value="employee"' + (role === 'employee' ? ' selected' : '') + '>Employee / talent</option>' +
        '<option value="client"' + (role === 'client' ? ' selected' : '') + '>Client user</option><option value="admin"' + (role === 'admin' ? ' selected' : '') + '>People Ops admin</option></select></label>' +
        '<label class="field">Email<input type="email" name="email" id="pf-email" required></label></div>') +
      '<div class="grid-2"><label class="field">Full name<input name="name" id="pf-name" value="' + esc(u.name) + '" required></label>' +
      '<label class="field">Phone<input name="phone" id="pf-phone" value="' + esc(u.phone) + '"></label></div>' +
      '<div class="grid-2"><label class="field"><span data-lbl>' + (emp ? 'Placed with client' : 'Company') + '</span><select name="client_id" id="pf-client">' + clientOptions(u.client_id, true) + '</select></label>' +
      '<label class="field">Job title<input name="job_title" id="pf-title" value="' + esc(u.job_title) + '"></label></div>' +
      '<fieldset data-emp style="border:0;padding:0;margin:0;display:grid;gap:14px"' + (emp ? '' : ' hidden') + '>' +
      '<div class="grid-3"><label class="field">Employee ID<input name="employee_code" id="pf-code" value="' + esc(u.employee_code) + '"></label>' +
      '<label class="field">Start date<input type="date" name="start_date" id="pf-start" value="' + esc(u.start_date) + '"></label>' +
      '<label class="field">Currency<select name="pay_currency" id="pf-cur">' + ['NGN', 'USD', 'GBP', 'EUR', 'CAD'].map(function (c) { return '<option' + ((u.pay_currency || 'NGN') === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="grid-2"><label class="field">Monthly pay (what they earn)<input type="number" step="0.01" min="0" name="monthly_pay" id="pf-pay" value="' + esc(u.monthly_pay || '') + '"></label>' +
      '<label class="field">Monthly bill rate (what the client pays)<input type="number" step="0.01" min="0" name="bill_rate" id="pf-bill" value="' + esc(u.bill_rate || '') + '"></label></div>' +
      '<div class="grid-2"><label class="field">Bank name<input name="bank_name" id="pf-bank" value="' + esc(u.bank_name) + '"></label>' +
      '<label class="field">Account number<input name="account_number" id="pf-acct" value="' + esc(u.account_number) + '"></label></div></fieldset>' +
      (u.id ? '<label class="row small"><input type="checkbox" name="active" id="pf-active"' + (u.active ? ' checked' : '') + '> Account is active (untick to block sign-in)</label>' : '') +
      '<p class="error" id="pf-error"></p></form>';
  }
  function showTempPassword(name, emailAddr, pw) {
    var m = openModal({
      title: 'Share these sign-in details',
      body: '<p>Send these to <b>' + esc(name) + '</b> privately. They will be asked to choose their own password the first time they sign in.</p>' +
        '<dl class="kv"><dt>Sign-in page</dt><dd>' + esc(location.origin + '/portal') + '</dd><dt>Email</dt><dd>' + esc(emailAddr) + '</dd></dl>' +
        '<div class="temp-pass" id="tp">' + esc(pw) + '</div><p class="small muted">This password is shown only once.</p>',
      foot: '<button class="btn secondary" id="tp-copy" type="button">Copy details</button><button class="btn" data-close type="button">Done</button>'
    });
    $('#tp-copy', m).onclick = function () {
      var text = 'Dé Pitch portal\nSign in: ' + location.origin + '/portal\nEmail: ' + emailAddr + '\nTemporary password: ' + pw;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Copied.'); }).catch(function () { toast('Select the password and copy it.', true); });
    };
  }
  function openPerson(u, role) {
    var m = openModal({
      title: u ? 'Edit ' + u.name : 'Add a person', body: personForm(u, role),
      foot: (u ? '<button class="btn danger" id="pf-reset" type="button" style="margin-right:auto">Reset password</button>' : '') +
        '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn" id="pf-save" type="button">' + (u ? 'Save changes' : 'Create account') + '</button>'
    });
    var roleSel = $('#pf-role', m);
    if (roleSel) roleSel.onchange = function () {
      var emp = this.value === 'employee';
      $('[data-emp]', m).hidden = !emp;
      $('[data-lbl]', m).textContent = emp ? 'Placed with client' : 'Company';
    };
    $('#pf-save', m).onclick = function () {
      var d = formObj($('#pf', m));
      if (u) { d.id = u.id; d.active = $('#pf-active', m).checked; }
      var btn = this; busy(btn, true);
      api(u ? 'adm.updateUser' : 'adm.createUser', d).then(function (j) {
        cache.users = null;
        if (j.tempPassword) { renderShell(); showTempPassword(d.name, d.email, j.tempPassword); }
        else after('Saved.')();
      }).catch(errIn(m, '#pf-error'));
    };
    if (u) $('#pf-reset', m).onclick = function () {
      var btn = this;
      if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Click again to confirm'; return; }
      busy(btn, true, 'Resetting…');
      api('adm.resetPassword', { id: u.id }).then(function (j) { showTempPassword(u.name, u.email, j.tempPassword); }).catch(errIn(m, '#pf-error'));
    };
  }

  ADM.people = function (el) {
    return loadPeople(true).then(function () {
      var filter = sessionStorage.getItem('dp_people_filter') || 'employee';
      function draw() {
        var rows = cache.users.filter(function (u) { return u.role === filter; });
        el.innerHTML = head('People', 'Create accounts, place talents with clients, and set pay and bill rates.', '<button class="btn" id="add-person" type="button">+ Add person</button>') +
          '<div class="seg">' + [['employee', 'Employees'], ['client', 'Client users'], ['admin', 'People Ops']].map(function (f) {
            return '<button type="button" data-f="' + f[0] + '" class="' + (filter === f[0] ? 'on' : '') + '">' + f[1] + ' (' + cache.users.filter(function (u) { return u.role === f[0]; }).length + ')</button>';
          }).join('') + '</div>' +
          table(filter === 'employee' ? ['Name', 'Client', '>Monthly pay', '>Bill rate', 'Status', '>'] : ['Name', 'Company', 'Last sign-in', 'Status', '>'], rows.map(function (u) {
            var status = u.active ? (u.must_change ? pill('pending', 'invited') : pill('active')) : pill('inactive', 'off');
            return '<tr><td><b>' + esc(u.name) + '</b><div class="small muted">' + esc(u.email) + (u.job_title ? ' · ' + esc(u.job_title) : '') + '</div></td><td>' + esc(u.client_name || '—') + '</td>' +
              (filter === 'employee' ? '<td class="r">' + money(u.monthly_pay, u.pay_currency) + '</td><td class="r">' + money(u.bill_rate, u.pay_currency) + '</td>' : '<td>' + esc(fmtDate(u.last_login) || 'Never') + '</td>') +
              '<td>' + status + '</td><td><div class="actions"><button class="btn sm secondary" data-edit="' + u.id + '" type="button">Edit</button></div></td></tr>';
          }), 'Nobody here yet.');
        $('#add-person', el).onclick = function () { openPerson(null, filter); };
        $$('[data-f]', el).forEach(function (b) { b.onclick = function () { filter = b.getAttribute('data-f'); sessionStorage.setItem('dp_people_filter', filter); draw(); }; });
        $$('[data-edit]', el).forEach(function (b) { b.onclick = function () { openPerson(cache.users.filter(function (u) { return u.id === Number(b.getAttribute('data-edit')); })[0]); }; });
      }
      draw();
    });
  };

  /* ---- Clients ---- */
  function openClient(c) {
    c = c || {};
    var m = openModal({
      title: c.id ? 'Edit ' + c.name : 'Add a client company',
      body: '<form id="cf" class="stack"><div class="grid-2"><label class="field">Company name<input name="name" id="cf-name" value="' + esc(c.name) + '" required></label>' +
        '<label class="field">Invoice currency<select name="currency" id="cf-cur">' + ['NGN', 'USD', 'GBP', 'EUR', 'CAD'].map(function (x) { return '<option' + ((c.currency || 'NGN') === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label></div>' +
        '<div class="grid-2"><label class="field">Contact person<input name="contact_name" id="cf-contact" value="' + esc(c.contact_name) + '"></label>' +
        '<label class="field">Contact email<input type="email" name="contact_email" id="cf-email" value="' + esc(c.contact_email) + '"></label></div>' +
        '<div class="grid-2"><label class="field">Phone<input name="phone" id="cf-phone" value="' + esc(c.phone) + '"></label><label class="field">Address<input name="address" id="cf-addr" value="' + esc(c.address) + '"></label></div>' +
        (c.id ? '<label class="row small"><input type="checkbox" id="cf-active"' + (c.active ? ' checked' : '') + '> Active client</label>' : '') +
        '<p class="small muted">To let someone from this company sign in, add them under People as a client user.</p><p class="error" id="cf-error"></p></form>',
      foot: '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn" id="cf-save" type="button">Save</button>'
    });
    $('#cf-save', m).onclick = function () {
      var d = formObj($('#cf', m));
      if (c.id) { d.id = c.id; d.active = $('#cf-active', m).checked; }
      busy(this, true);
      api('adm.saveClient', d).then(function () { cache.clients = null; after('Client saved.')(); }).catch(errIn(m, '#cf-error'));
    };
  }
  ADM.clients = function (el) {
    return loadPeople(true).then(function () {
      el.innerHTML = head('Clients', 'Companies that hire talent through Dé Pitch.', '<button class="btn" id="add-client" type="button">+ Add client</button>') +
        table(['Company', 'Contact', '>Talents', 'Currency', 'Status', '>'], cache.clients.map(function (c) {
          return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.contact_name) + '<div class="small muted">' + esc(c.contact_email) + '</div></td><td class="r">' + c.talents + '</td><td>' + esc(c.currency) +
            '</td><td>' + (c.active ? pill('active') : pill('inactive', 'inactive')) + '</td><td><div class="actions"><button class="btn sm secondary" data-c="' + c.id + '" type="button">Edit</button></div></td></tr>';
        }), 'No clients yet.');
      $('#add-client', el).onclick = function () { openClient(); };
      $$('[data-c]', el).forEach(function (b) { b.onclick = function () { openClient(cache.clients.filter(function (c) { return c.id === Number(b.getAttribute('data-c')); })[0]); }; });
    });
  };

  /* ---- Payroll ---- */
  function moneyLine(l) {
    l = l || {};
    return '<div class="line money-line"><input name="label" placeholder="Description" aria-label="Description" value="' + esc(l.label) + '">' +
      '<input name="amount" type="number" step="0.01" placeholder="0.00" aria-label="Amount" value="' + esc(l.amount != null ? l.amount : '') + '"><button class="x" type="button" aria-label="Remove line">×</button></div>';
  }
  function readLines(box) {
    return $$('.line', box).map(function (l) { return { label: $('[name=label]', l).value, amount: $('[name=amount]', l).value }; }).filter(function (l) { return l.label || l.amount; });
  }
  function bindLineBox(m, onChange) {
    m.addEventListener('click', function (e) {
      var x = e.target.closest('.x'); if (!x) return;
      var box = x.closest('.lines');
      if (box.children.length > 1) x.closest('.line').remove(); else $$('input', x.closest('.line')).forEach(function (i) { i.value = ''; });
      if (onChange) onChange();
    });
    m.addEventListener('input', function () { if (onChange) onChange(); });
  }
  function openPay(p) {
    p = p || { earnings: [{ label: 'Basic salary', amount: '' }], deductions: [], currency: 'NGN', period: thisPeriod() };
    var m = openModal({
      title: p.id ? 'Pay for ' + p.name + ' · ' + monthLabel(p.period) : 'Add a pay record',
      body: '<form id="pp" class="stack">' + (p.id ? '' : '<div class="grid-3"><label class="field">Employee<select name="user_id" id="pp-user">' + employeeOptions() + '</select></label>' +
        '<label class="field">Month<input type="month" name="period" id="pp-period" value="' + esc(p.period) + '"></label>' +
        '<label class="field">Currency<select name="currency" id="pp-cur">' + ['NGN', 'USD', 'GBP', 'EUR', 'CAD'].map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label></div>') +
        '<div class="section-label">Earnings</div><div class="lines" id="pp-earn">' + (p.earnings.length ? p.earnings.map(moneyLine).join('') : moneyLine()) + '</div>' +
        '<div><button class="btn sm secondary" type="button" id="pp-add-e">+ Add earning (allowance, bonus…)</button></div>' +
        '<div class="section-label">Deductions</div><div class="lines" id="pp-ded">' + (p.deductions.length ? p.deductions.map(moneyLine).join('') : moneyLine({ label: 'PAYE tax' })) + '</div>' +
        '<div><button class="btn sm secondary" type="button" id="pp-add-d">+ Add deduction (pension, loan…)</button></div>' +
        '<label class="field">Note on payslip (optional)<input name="notes" id="pp-notes" value="' + esc(p.notes) + '"></label>' +
        '<div class="panel" style="background:var(--wash)"><div class="spread"><span>Gross <b class="num" id="pp-g"></b></span><span>Deductions <b class="num" id="pp-d"></b></span><span>Net pay <b class="num" id="pp-n" style="font-size:1.2rem"></b></span></div></div>' +
        '<p class="error" id="pp-error"></p></form>',
      foot: (p.id && p.status === 'pending' ? '<button class="btn danger" id="pp-del" type="button" style="margin-right:auto">Delete</button>' : '') +
        '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn" id="pp-save" type="button">Save</button>'
    });
    var cur = function () { return p.id ? p.currency : $('#pp-cur', m).value; };
    function totals() {
      var g = readLines($('#pp-earn', m)).reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);
      var d = readLines($('#pp-ded', m)).reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);
      $('#pp-g', m).textContent = money(g, cur()); $('#pp-d', m).textContent = money(d, cur()); $('#pp-n', m).textContent = money(g - d, cur());
    }
    bindLineBox($('#pp', m), totals); totals();
    if (!p.id) $('#pp-user', m).onchange = function () {
      var u = cache.users.filter(function (x) { return x.id === Number(this.value); }, this)[0];
      if (!u) return;
      $('#pp-cur', m).value = u.pay_currency || 'NGN';
      var first = $('#pp-earn .line [name=amount]', m);
      if (first && !first.value) first.value = u.monthly_pay || '';
      totals();
    };
    $('#pp-add-e', m).onclick = function () { $('#pp-earn', m).insertAdjacentHTML('beforeend', moneyLine()); };
    $('#pp-add-d', m).onclick = function () { $('#pp-ded', m).insertAdjacentHTML('beforeend', moneyLine()); };
    $('#pp-save', m).onclick = function () {
      var d = formObj($('#pp', m));
      d.earnings = readLines($('#pp-earn', m)); d.deductions = readLines($('#pp-ded', m));
      if (p.id) { d.id = p.id; d.currency = p.currency; }
      busy(this, true);
      api('adm.savePayroll', d).then(after('Pay record saved.')).catch(errIn(m, '#pp-error'));
    };
    if ($('#pp-del', m)) $('#pp-del', m).onclick = function () {
      if (this.dataset.confirm !== '1') { this.dataset.confirm = '1'; this.textContent = 'Click again to delete'; return; }
      api('adm.deletePayroll', { id: p.id }).then(after('Pay record deleted.')).catch(errIn(m, '#pp-error'));
    };
  }
  function markPaidModal(ids, label) {
    var m = openModal({
      title: 'Mark as paid', body: '<p>' + esc(label) + '</p><div class="grid-2"><label class="field">Payment date<input type="date" id="mp-date" value="' + isoToday() + '"></label>' +
        '<label class="field">Payment reference (optional)<input id="mp-ref" placeholder="Bank transfer ref"></label></div><p class="small muted">Employees can generate their payslip as soon as you save.</p><p class="error" id="mp-error"></p>',
      foot: '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn ok" id="mp-save" type="button">Mark paid</button>'
    });
    $('#mp-save', m).onclick = function () {
      busy(this, true);
      api('adm.markPaid', { ids: ids, paid_at: $('#mp-date', m).value, payment_ref: $('#mp-ref', m).value }).then(after('Marked as paid.')).catch(errIn(m, '#mp-error'));
    };
  }
  ADM.payroll = function (el) {
    var per = sessionStorage.getItem('dp_pay_period') || thisPeriod();
    return Promise.all([loadPeople(), api('adm.payroll', { period: per })]).then(function (r) {
      var rows = r[1].rows;
      var totals = {};
      rows.forEach(function (x) { totals[x.currency] = (totals[x.currency] || 0) + Number(x.net); });
      el.innerHTML = head('Payroll', 'Add each person\'s pay for the month, then mark it paid. Paid months unlock payslips for employees.',
        '<input type="month" class="input" id="pay-period" value="' + esc(per) + '" style="width:auto" aria-label="Month">' +
        '<button class="btn secondary" id="pay-gen" type="button">Fill from monthly pay</button><button class="btn" id="pay-add" type="button">+ Add pay record</button>') +
        '<div class="stats"><div class="stat hero"><span class="label">' + esc(monthLabel(per)) + ' net payroll</span><span class="value" style="font-size:1.2rem">' +
        (Object.keys(totals).map(function (c) { return money(totals[c], c); }).join(' + ') || '—') + '</span><span class="sub">' + rows.length + ' people</span></div>' +
        '<div class="stat"><span class="label">Paid</span><span class="value">' + rows.filter(function (x) { return x.status === 'paid'; }).length + '</span></div>' +
        '<div class="stat"><span class="label">Not yet paid</span><span class="value">' + rows.filter(function (x) { return x.status !== 'paid'; }).length + '</span></div></div>' +
        '<div class="row"><button class="btn ok sm" id="pay-mark" type="button" disabled>Mark selected as paid</button><span class="small muted" id="pay-sel"></span></div>' +
        table(['', 'Employee', '>Gross', '>Deductions', '>Net pay', 'Status', '>'], rows.map(function (x) {
          return '<tr><td>' + (x.status !== 'paid' ? '<input type="checkbox" data-pick="' + x.id + '" aria-label="Select ' + esc(x.name) + '">' : '') + '</td>' +
            '<td><b>' + esc(x.name) + '</b><div class="small muted">' + esc(x.job_title || x.email) + '</div></td><td class="r">' + money(x.gross, x.currency) + '</td><td class="r">' + money(x.total_deductions, x.currency) +
            '</td><td class="r"><b>' + money(x.net, x.currency) + '</b></td><td>' + pill(x.status) + (x.paid_at ? '<div class="small muted">' + esc(fmtDate(x.paid_at)) + '</div>' : '') + '</td>' +
            '<td><div class="actions"><button class="btn sm secondary" data-pe="' + x.id + '" type="button">Edit</button>' +
            (x.status === 'paid' ? '<button class="btn sm secondary" data-ps="' + x.id + '" type="button">Payslip</button><button class="btn sm ghost" data-unpay="' + x.id + '" type="button">Undo paid</button>'
              : '<button class="btn sm ok" data-pay="' + x.id + '" type="button">Mark paid</button>') + '</div></td></tr>';
        }), 'No pay records for this month. Use "Fill from monthly pay" to create them for every active employee.');
      $('#pay-period', el).onchange = function () { sessionStorage.setItem('dp_pay_period', this.value || thisPeriod()); renderShell(); };
      $('#pay-add', el).onclick = function () { openPay(); };
      $('#pay-gen', el).onclick = function () {
        var btn = this; busy(btn, true, 'Creating…');
        api('adm.generatePayroll', { period: per }).then(function (j) { toast(j.created + ' pay record(s) created.'); refreshCounts(); renderShell(); }).catch(function (x) { toast(x.message, true); busy(btn, false); });
      };
      var byId = {}; rows.forEach(function (x) { byId[x.id] = x; });
      $$('[data-pe]', el).forEach(function (b) { b.onclick = function () { openPay(byId[b.getAttribute('data-pe')]); }; });
      $$('[data-pay]', el).forEach(function (b) { b.onclick = function () { var x = byId[b.getAttribute('data-pay')]; markPaidModal([x.id], x.name + ' · ' + monthLabel(x.period) + ' · ' + money(x.net, x.currency)); }; });
      $$('[data-unpay]', el).forEach(function (b) {
        b.onclick = function () { api('adm.markPaid', { ids: [Number(b.getAttribute('data-unpay'))], paid: false }).then(function () { toast('Moved back to pending.'); refreshCounts(); renderShell(); }); };
      });
      $$('[data-ps]', el).forEach(function (b) {
        b.onclick = function () { api('adm.payslip', { id: b.getAttribute('data-ps') }).then(function (j) { printDoc('Payslip ' + j.profile.name + ' ' + monthLabel(j.payslip.period), payslipHtml(j.payslip, j.profile)); }); };
      });
      function sel() { return $$('[data-pick]:checked', el).map(function (c) { return Number(c.getAttribute('data-pick')); }); }
      el.addEventListener('change', function (e) {
        if (!e.target.matches('[data-pick]')) return;
        var n = sel().length; $('#pay-mark', el).disabled = !n; $('#pay-sel', el).textContent = n ? n + ' selected' : '';
      });
      $('#pay-mark', el).onclick = function () { var ids = sel(); markPaidModal(ids, ids.length + ' pay record(s) for ' + monthLabel(per)); };
    });
  };

  /* ---- Invoices ---- */
  function invLine(i) {
    i = i || {};
    return '<div class="line inv-line" data-talent="' + esc(i.talent_id || '') + '" data-tname="' + esc(i.talent_name || '') + '"><input name="description" placeholder="Description" aria-label="Description" value="' + esc(i.description) + '">' +
      '<input name="amount" type="number" step="0.01" placeholder="0.00" aria-label="Amount" value="' + esc(i.amount != null ? i.amount : '') + '"><button class="x" type="button" aria-label="Remove line">×</button></div>';
  }
  function openInvoice(inv) {
    var m = openModal({
      title: inv.id ? 'Edit invoice ' + inv.number : 'New invoice', wide: true,
      body: '<form id="iv" class="stack"><div class="grid-3"><label class="field">Client<select name="client_id" id="iv-client">' + clientOptions(inv.client_id) + '</select></label>' +
        '<label class="field">Service month<input type="month" name="period" id="iv-period" value="' + esc(inv.period) + '"></label>' +
        '<label class="field">Currency<select name="currency" id="iv-cur">' + ['NGN', 'USD', 'GBP', 'EUR', 'CAD'].map(function (c) { return '<option' + (inv.currency === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Issue date<input type="date" name="issue_date" id="iv-issue" value="' + esc(inv.issue_date || isoToday()) + '"></label>' +
        '<label class="field">Due date<input type="date" name="due_date" id="iv-due" value="' + esc(inv.due_date || addDays(isoToday(), 14)) + '"></label>' +
        '<label class="field">Tax / VAT amount<input type="number" step="0.01" name="tax" id="iv-tax" value="' + esc(inv.tax || '') + '"></label></div>' +
        '<div class="spread"><div class="section-label" style="flex:1">Line items (one per talent)</div><button class="btn sm secondary" id="iv-fill" type="button">Refill from placed talents</button></div>' +
        '<div class="lines" id="iv-lines">' + (inv.items && inv.items.length ? inv.items.map(invLine).join('') : invLine()) + '</div>' +
        '<div><button class="btn sm secondary" id="iv-add" type="button">+ Add line</button></div>' +
        '<label class="field">Notes / payment instructions<textarea name="notes" id="iv-notes" placeholder="Bank details, payment terms">' + esc(inv.notes) + '</textarea></label>' +
        '<div class="panel" style="background:var(--wash)"><div class="spread"><span>Subtotal <b class="num" id="iv-sub"></b></span><span>Total <b class="num" id="iv-tot" style="font-size:1.2rem"></b></span></div></div>' +
        '<p class="small muted">Drafts are only visible to People Ops. Use "Send to client" when it is ready.</p><p class="error" id="iv-error"></p></form>',
      foot: '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn" id="iv-save" type="button">Save draft</button>'
    });
    function items() {
      return $$('#iv-lines .line', m).map(function (l) {
        return { talent_id: l.getAttribute('data-talent') || null, talent_name: l.getAttribute('data-tname') || '', description: $('[name=description]', l).value, amount: $('[name=amount]', l).value };
      }).filter(function (i) { return i.description || i.amount; });
    }
    function totals() {
      var cur = $('#iv-cur', m).value;
      var s = items().reduce(function (a, i) { return a + (Number(i.amount) || 0); }, 0);
      $('#iv-sub', m).textContent = money(s, cur); $('#iv-tot', m).textContent = money(s + (Number($('#iv-tax', m).value) || 0), cur);
    }
    function fill() {
      var c = $('#iv-client', m).value, p = $('#iv-period', m).value;
      if (!c || !p) { $('#iv-error', m).textContent = 'Choose a client and month first.'; return; }
      api('adm.draftInvoice', { client_id: c, period: p }).then(function (j) {
        $('#iv-lines', m).innerHTML = j.items.length ? j.items.map(invLine).join('') : invLine();
        $('#iv-cur', m).value = j.currency; $('#iv-error', m).textContent = j.items.length ? '' : 'No talents are placed with this client yet. Add lines by hand.';
        totals();
      }).catch(errIn(m, '#iv-error'));
    }
    bindLineBox($('#iv', m), totals); totals();
    $('#iv-fill', m).onclick = fill;
    if (!inv.id) { $('#iv-client', m).onchange = fill; $('#iv-period', m).onchange = function () { if ($('#iv-client', m).value) fill(); }; }
    $('#iv-add', m).onclick = function () { $('#iv-lines', m).insertAdjacentHTML('beforeend', invLine()); };
    $('#iv-save', m).onclick = function () {
      var d = formObj($('#iv', m)); d.items = items(); if (inv.id) d.id = inv.id;
      busy(this, true);
      api('adm.saveInvoice', d).then(after('Invoice saved as a draft.')).catch(errIn(m, '#iv-error'));
    };
  }
  ADM.invoices = function (el) {
    return Promise.all([loadPeople(), api('adm.invoices')]).then(function (r) {
      var rows = r[1].rows;
      el.innerHTML = head('Invoices', 'Create each client\'s monthly invoice from the talents placed with them, send it, then mark it paid.', '<button class="btn" id="inv-new" type="button">+ New invoice</button>') +
        table(['Invoice', 'Client', 'Month', '>Total', 'Status', '>'], rows.map(function (i) {
          var acts = '<button class="btn sm secondary" data-view-inv="' + i.id + '" type="button">View</button>';
          if (i.status === 'draft') acts += '<button class="btn sm secondary" data-edit-inv="' + i.id + '" type="button">Edit</button><button class="btn sm" data-st="sent" data-id="' + i.id + '" type="button">Send to client</button><button class="btn sm danger" data-del-inv="' + i.id + '" type="button">Delete</button>';
          if (i.status === 'sent') acts += '<button class="btn sm ok" data-st="paid" data-id="' + i.id + '" type="button">Mark paid</button><button class="btn sm ghost" data-st="draft" data-id="' + i.id + '" type="button">Back to draft</button>';
          if (i.status === 'paid') acts += '<button class="btn sm ghost" data-st="sent" data-id="' + i.id + '" type="button">Undo paid</button>';
          return '<tr><td><b>' + esc(i.number) + '</b><div class="small muted">Due ' + esc(fmtDate(i.due_date) || '—') + '</div></td><td>' + esc(i.client_name) + '</td><td>' + esc(monthLabel(i.period)) +
            '</td><td class="r">' + money(i.total, i.currency) + '</td><td>' + pill(i.status) + '</td><td><div class="actions">' + acts + '</div></td></tr>';
        }), 'No invoices yet.');
      var byId = {}; rows.forEach(function (i) { byId[i.id] = i; });
      $('#inv-new', el).onclick = function () { openInvoice({ period: thisPeriod(), currency: 'NGN', items: [] }); };
      $$('[data-edit-inv]', el).forEach(function (b) { b.onclick = function () { openInvoice(byId[b.getAttribute('data-edit-inv')]); }; });
      $$('[data-view-inv]', el).forEach(function (b) {
        b.onclick = function () { api('adm.invoice', { id: b.getAttribute('data-view-inv') }).then(function (j) { printDoc('Invoice ' + j.invoice.number, invoiceHtml(j.invoice, j.client)); }); };
      });
      $$('[data-st]', el).forEach(function (b) {
        b.onclick = function () {
          busy(b, true, '…');
          api('adm.invoiceStatus', { id: b.getAttribute('data-id'), status: b.getAttribute('data-st') }).then(function () {
            toast(b.getAttribute('data-st') === 'sent' ? 'Invoice is now visible to the client.' : 'Invoice updated.'); refreshCounts(); renderShell();
          }).catch(function (x) { toast(x.message, true); busy(b, false); });
        };
      });
      $$('[data-del-inv]', el).forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm'; return; }
          api('adm.deleteInvoice', { id: b.getAttribute('data-del-inv') }).then(function () { toast('Draft deleted.'); renderShell(); });
        };
      });
    });
  };

  /* ---- Weekly reports ---- */
  ADM.reports = function (el) {
    var st = sessionStorage.getItem('dp_rep_status') || 'submitted';
    return api('adm.reports', { status: st === 'all' ? '' : st }).then(function (j) {
      el.innerHTML = head('Weekly reports', 'Approve reports or send them back with a note.') +
        '<div class="seg">' + [['submitted', 'To review'], ['approved', 'Approved'], ['changes_requested', 'Changes requested'], ['all', 'All']].map(function (f) {
          return '<button type="button" data-s="' + f[0] + '" class="' + (st === f[0] ? 'on' : '') + '">' + f[1] + '</button>';
        }).join('') + '</div>' +
        table(['Employee', 'Week', 'Client', '>Tasks', '>Hours', 'Blockers', 'Status', '>'], j.rows.map(function (r, i) {
          var hrs = r.tasks.reduce(function (s, t) { return s + (Number(t.hours) || 0); }, 0);
          return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + esc(fmtDate(r.week_start)) + ' – ' + esc(fmtDate(r.week_end)) + '<div class="small muted">Submitted ' + esc(fmtDate(r.submitted_on)) + '</div></td><td>' + esc(r.client_name) +
            '</td><td class="r">' + r.tasks.length + '</td><td class="r">' + hrs + '</td><td>' + (r.blockers.length ? '<span class="pill warn">' + r.blockers.length + '</span>' : '—') + '</td><td>' + pill(r.status) +
            '</td><td><div class="actions"><button class="btn sm" data-r="' + i + '" type="button">Open</button></div></td></tr>';
        }), 'No reports here.');
      $$('[data-s]', el).forEach(function (b) { b.onclick = function () { sessionStorage.setItem('dp_rep_status', b.getAttribute('data-s')); renderShell(); }; });
      $$('[data-r]', el).forEach(function (b) {
        b.onclick = function () {
          var r = j.rows[Number(b.getAttribute('data-r'))];
          var m = openModal({
            title: r.name + ' · week of ' + fmtDate(r.week_start), wide: true,
            body: reportSheet(r, r.name) + '<label class="field">Note to the employee<textarea id="rv-note">' + esc(r.hr_note) + '</textarea></label><p class="error" id="rv-error"></p>',
            foot: '<button class="btn secondary" id="rv-csv" type="button" style="margin-right:auto">Download (Excel / CSV)</button>' +
              '<button class="btn danger" data-dec="changes_requested" type="button">Request changes</button><button class="btn ok" data-dec="approved" type="button">Approve</button>'
          });
          $('#rv-csv', m).onclick = function () { downloadText(reportFileName(r, r.name), reportCsv(r, r.name)); };
          $$('[data-dec]', m).forEach(function (d) {
            d.onclick = function () {
              busy(d, true);
              api('adm.reviewReport', { id: r.id, status: d.getAttribute('data-dec'), hr_note: $('#rv-note', m).value }).then(after('Report updated.')).catch(errIn(m, '#rv-error'));
            };
          });
        };
      });
    });
  };

  /* ---- Requests ---- */
  ADM.requests = function (el) {
    var st = sessionStorage.getItem('dp_req_status') || 'pending';
    return api('adm.requests', { status: st === 'all' ? '' : st }).then(function (j) {
      el.innerHTML = head('Requests', 'Time off, reimbursements and other requests from employees.') +
        '<div class="seg">' + [['pending', 'Waiting'], ['approved', 'Approved'], ['paid', 'Reimbursed'], ['declined', 'Declined'], ['all', 'All']].map(function (f) {
          return '<button type="button" data-s="' + f[0] + '" class="' + (st === f[0] ? 'on' : '') + '">' + f[1] + '</button>';
        }).join('') + '</div>' +
        table(['Employee', 'Type', 'Request', '>Amount', 'Status', '>'], j.rows.map(function (r, i) {
          return '<tr><td><b>' + esc(r.name) + '</b><div class="small muted">' + esc(fmtDate(r.created_at)) + '</div></td><td>' + esc(cap(LABEL[r.type] || r.type)) + '</td><td><b>' + esc(r.title) + '</b>' +
            (r.start_date ? '<div class="small muted">' + esc(fmtDate(r.start_date)) + ' – ' + esc(fmtDate(r.end_date)) + '</div>' : '') + '</td><td class="r">' + (Number(r.amount) ? money(r.amount, r.currency) : '') +
            '</td><td>' + pill(r.status) + '</td><td><div class="actions"><button class="btn sm" data-q="' + i + '" type="button">Open</button></div></td></tr>';
        }), 'No requests here.');
      $$('[data-s]', el).forEach(function (b) { b.onclick = function () { sessionStorage.setItem('dp_req_status', b.getAttribute('data-s')); renderShell(); }; });
      $$('[data-q]', el).forEach(function (b) {
        b.onclick = function () {
          var r = j.rows[Number(b.getAttribute('data-q'))];
          var m = openModal({
            title: (LABEL[r.type] || r.type).replace(/^./, function (c) { return c.toUpperCase(); }) + ' · ' + r.name,
            body: '<dl class="kv"><dt>Employee</dt><dd>' + esc(r.name) + ' (' + esc(r.email) + ')</dd><dt>Request</dt><dd>' + esc(r.title) + '</dd>' +
              (r.start_date ? '<dt>Dates</dt><dd>' + esc(fmtDate(r.start_date)) + ' – ' + esc(fmtDate(r.end_date)) + '</dd>' : '') +
              (Number(r.amount) ? '<dt>Amount</dt><dd>' + money(r.amount, r.currency) + '</dd>' : '') + '<dt>Details</dt><dd>' + esc(r.details) + '</dd>' +
              (r.file_id ? '<dt>Receipt</dt><dd>' + fileLink(r.file_id, r.filename || 'Open receipt') + '</dd>' : '') + '<dt>Status</dt><dd>' + pill(r.status) + '</dd></dl>' +
              '<label class="field">Note to the employee<textarea id="rq-note">' + esc(r.hr_note) + '</textarea></label><p class="error" id="rqa-error"></p>',
            foot: '<button class="btn danger" data-dec="declined" type="button">Decline</button>' + (r.type === 'reimbursement' ? '<button class="btn secondary" data-dec="paid" type="button">Mark reimbursed</button>' : '') +
              '<button class="btn ok" data-dec="approved" type="button">Approve</button>'
          });
          $$('[data-dec]', m).forEach(function (d) {
            d.onclick = function () { busy(d, true); api('adm.reviewRequest', { id: r.id, status: d.getAttribute('data-dec'), hr_note: $('#rq-note', m).value }).then(after('Request updated.')).catch(errIn(m, '#rqa-error')); };
          });
        };
      });
    });
  };

  /* ---- Recruitment ---- */
  ADM.recruitment = function (el) {
    return api('adm.recruitment').then(function (j) {
      el.innerHTML = head('Talent requests', 'New talent requests from clients. Update the status and attach a shortlist to send it to the client.') +
        table(['Client', 'Role', '>Count', 'Budget', 'Status', '>'], j.rows.map(function (r, i) {
          return '<tr><td><b>' + esc(r.client_name) + '</b><div class="small muted">' + esc(r.requested_by) + ' · ' + esc(fmtDate(r.created_at)) + '</div></td><td><b>' + esc(r.role_title) + '</b><div class="small muted">' + esc(r.employment_type) +
            (r.start_date ? ' · start ' + esc(fmtDate(r.start_date)) : '') + '</div></td><td class="r">' + r.headcount + '</td><td>' + esc(r.budget) + '</td><td>' + pill(r.status) +
            '</td><td><div class="actions"><button class="btn sm" data-rc="' + i + '" type="button">Open</button></div></td></tr>';
        }), 'No talent requests yet.');
      $$('[data-rc]', el).forEach(function (b) {
        b.onclick = function () {
          var r = j.rows[Number(b.getAttribute('data-rc'))];
          var m = openModal({
            title: r.role_title + ' · ' + r.client_name,
            body: '<dl class="kv"><dt>Requested by</dt><dd>' + esc(r.requested_by) + '</dd><dt>Headcount</dt><dd>' + r.headcount + '</dd><dt>Type</dt><dd>' + esc(r.employment_type) + '</dd>' +
              '<dt>Budget</dt><dd>' + esc(r.budget || '—') + '</dd><dt>Start</dt><dd>' + esc(fmtDate(r.start_date) || '—') + '</dd><dt>Requirements</dt><dd>' + esc(r.skills) + '</dd>' +
              (r.notes ? '<dt>Notes</dt><dd>' + esc(r.notes) + '</dd>' : '') + (r.file_id ? '<dt>Shortlist</dt><dd>' + fileLink(r.file_id, r.filename || 'Open') + '</dd>' : '') + '</dl>' +
              '<div class="grid-2"><label class="field">Status<select id="ru-status">' + [['submitted', 'New'], ['in_progress', 'Sourcing candidates'], ['shortlist_sent', 'Shortlist sent to client'], ['filled', 'Filled'], ['closed', 'Closed']].map(function (s) {
                return '<option value="' + s[0] + '"' + (r.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
              }).join('') + '</select></label><label class="field">Attach shortlist (visible to the client)<input type="file" id="ru-file" accept=".pdf,.doc,.docx,.xlsx,.csv"></label></div>' +
              '<label class="field">Update for the client<textarea id="ru-note" placeholder="e.g. 3 candidates shortlisted, interviews next week">' + esc(r.hr_note) + '</textarea></label><p class="error" id="ru-error"></p>',
            foot: '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn" id="ru-save" type="button">Save and send to client</button>'
          });
          $('#ru-save', m).onclick = function () {
            var btn = this; busy(btn, true);
            fileToPayload($('#ru-file', m)).then(function (f) {
              var d = { id: r.id, status: $('#ru-status', m).value, hr_note: $('#ru-note', m).value };
              if (f) { d.file = f; if (d.status === 'submitted' || d.status === 'in_progress') d.status = 'shortlist_sent'; }
              return api('adm.updateRecruitment', d);
            }).then(after('Talent request updated.')).catch(errIn(m, '#ru-error'));
          };
        };
      });
    });
  };

  /* ---- Reviews & removals ---- */
  ADM.feedback = function (el) {
    return api('adm.feedback').then(function (j) {
      el.innerHTML = head('Reviews & removals', 'Client reviews of talents, and requests to remove a talent from a placement.') +
        table(['Client', 'Talent', 'Type', 'Details', 'Status', '>'], j.rows.map(function (f, i) {
          return '<tr><td><b>' + esc(f.client_name) + '</b><div class="small muted">' + esc(f.submitted_by) + ' · ' + esc(fmtDate(f.created_at)) + '</div></td><td>' + esc(f.talent_name) +
            '</td><td>' + (f.kind === 'removal' ? '<span class="pill bad">Removal</span>' : 'Review ' + '★'.repeat(f.rating)) + '</td><td class="small">' + esc(f.comments) +
            (f.effective_date ? '<div class="muted">Effective ' + esc(fmtDate(f.effective_date)) + '</div>' : '') + '</td><td>' + pill(f.status) + '</td><td><div class="actions"><button class="btn sm" data-fb="' + i + '" type="button">Open</button></div></td></tr>';
        }), 'Nothing from clients yet.');
      $$('[data-fb]', el).forEach(function (b) {
        b.onclick = function () {
          var f = j.rows[Number(b.getAttribute('data-fb'))];
          var removal = f.kind === 'removal';
          var stillPlaced = Number(f.talent_client_id) === Number(f.client_id);
          var m = openModal({
            title: (removal ? 'Removal request: ' : 'Review of ') + f.talent_name,
            body: '<dl class="kv"><dt>Client</dt><dd>' + esc(f.client_name) + ' (' + esc(f.submitted_by) + ')</dd>' + (removal ? '<dt>Effective date</dt><dd>' + esc(fmtDate(f.effective_date)) + '</dd>' : '<dt>Rating</dt><dd>' + '★'.repeat(f.rating) + '</dd>') +
              '<dt>' + (removal ? 'Reason' : 'Comments') + '</dt><dd>' + esc(f.comments) + '</dd></dl>' +
              (removal && stillPlaced ? '<label class="row small"><input type="checkbox" id="fb-unassign" checked> When approved, remove ' + esc(f.talent_name) + ' from ' + esc(f.client_name) + ' (they stop appearing on the client\'s dashboard and future invoices)</label>' : '') +
              '<label class="field">Note to the client<textarea id="fb-note">' + esc(f.hr_note) + '</textarea></label><p class="error" id="fb-error"></p>',
            foot: removal ? '<button class="btn secondary" data-st="acknowledged" type="button">Acknowledge</button><button class="btn danger" data-st="declined" type="button">Decline</button><button class="btn ok" data-st="approved" type="button">Approve removal</button>'
              : '<button class="btn secondary" data-close type="button">Close</button><button class="btn ok" data-st="acknowledged" type="button">Acknowledge</button>'
          });
          $$('[data-st]', m).forEach(function (d) {
            d.onclick = function () {
              busy(d, true);
              api('adm.updateFeedback', { id: f.id, status: d.getAttribute('data-st'), hr_note: $('#fb-note', m).value, unassign: $('#fb-unassign', m) ? $('#fb-unassign', m).checked : false })
                .then(function () { cache.users = null; after('Saved.')(); }).catch(errIn(m, '#fb-error'));
            };
          });
        };
      });
    });
  };

  /* ---- Documents ---- */
  ADM.documents = function (el) {
    return Promise.all([loadPeople(), api('adm.files')]).then(function (r) {
      el.innerHTML = head('Documents', 'Upload onboarding documents, employment letters and signed agreements. Each person sees only their own documents.',
        '<button class="btn" id="doc-up" type="button">+ Upload document</button>') + docsTable(r[1].rows, { owner: true, del: true, empty: 'No documents uploaded yet.' });
      $('#doc-up', el).onclick = function () {
        var m = openModal({
          title: 'Upload a document',
          body: '<form id="du" class="stack"><div class="seg"><button type="button" class="on" data-to="emp">For an employee</button><button type="button" data-to="cli">For a client company</button></div>' +
            '<label class="field" data-who="emp">Employee<select name="owner_id" id="du-owner">' + employeeOptions() + '</select></label>' +
            '<label class="field" data-who="cli" hidden>Client company<select name="client_id" id="du-client" disabled>' + clientOptions() + '</select></label>' +
            '<div class="grid-2"><label class="field">Title<input name="title" id="du-title" required placeholder="e.g. Employment letter"></label>' +
            '<label class="field">Type<select name="category" id="du-cat"><option>Employment letter</option><option>Onboarding</option><option>Contract</option><option>Policy</option><option>Payslip</option><option>Agreement</option><option>Other</option></select></label></div>' +
            '<label class="field">File<input type="file" id="du-file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.txt"><span class="hint">Up to 3 MB</span></label><p class="error" id="du-error"></p></form>',
          foot: '<button class="btn secondary" data-close type="button">Cancel</button><button class="btn" id="du-save" type="button">Upload</button>'
        });
        $$('[data-to]', m).forEach(function (b) {
          b.onclick = function () {
            $$('[data-to]', m).forEach(function (x) { x.classList.toggle('on', x === b); });
            var to = b.getAttribute('data-to');
            $$('[data-who]', m).forEach(function (w) { w.hidden = w.getAttribute('data-who') !== to; $('select', w).disabled = w.hidden; });
          };
        });
        $('#du-save', m).onclick = function () {
          var btn = this; busy(btn, true, 'Uploading…');
          var d = formObj($('#du', m));
          fileToPayload($('#du-file', m)).then(function (f) { if (!f) throw new Error('Choose a file.'); d.file = f; return api('adm.uploadDocument', d); })
            .then(after('Document uploaded.')).catch(errIn(m, '#du-error'));
        };
      };
      $$('[data-del-file]', el).forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm delete'; return; }
          api('adm.deleteFile', { id: b.getAttribute('data-del-file') }).then(function () { toast('Document deleted.'); renderShell(); });
        };
      });
    });
  };

  /* ---- Announcements ---- */
  ADM.announcements = function (el) {
    return api('adm.announcements').then(function (j) {
      el.innerHTML = head('Announcements', 'Short updates that appear in the bar at the top of the employee (and optionally client) dashboard.') +
        '<form class="panel stack" id="an"><label class="field">Message<input name="message" id="an-msg" maxlength="280" required placeholder="e.g. Salaries for October will be paid on the 28th."></label>' +
        '<div class="grid-2"><label class="field">Show to<select name="audience" id="an-aud"><option value="employees">Employees</option><option value="clients">Clients</option><option value="all">Everyone</option></select></label>' +
        '<label class="field">Link (optional)<input name="link" id="an-link" placeholder="https://"></label></div><p class="error" id="an-error"></p>' +
        '<div class="row" style="justify-content:flex-end"><button class="btn" type="submit">Post announcement</button></div></form>' +
        table(['Message', 'Audience', 'Posted', 'Status', '>'], j.rows.map(function (a) {
          return '<tr><td>' + esc(a.message) + (a.link ? '<div class="small"><a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.link) + '</a></div>' : '') + '</td><td>' + esc(a.audience) +
            '</td><td>' + esc(fmtDate(a.created_at)) + '</td><td>' + (a.active ? pill('active', 'showing') : pill('inactive', 'hidden')) + '</td><td><div class="actions">' +
            '<button class="btn sm secondary" data-tog="' + a.id + '" type="button">' + (a.active ? 'Hide' : 'Show') + '</button><button class="btn sm danger" data-del-an="' + a.id + '" type="button">Delete</button></div></td></tr>';
        }), 'No announcements yet.');
      var byId = {}; j.rows.forEach(function (a) { byId[a.id] = a; });
      $('#an', el).onsubmit = function (e) {
        e.preventDefault(); var btn = this.querySelector('[type=submit]'); busy(btn, true, 'Posting…');
        api('adm.saveAnnouncement', formObj(this)).then(function () { toast('Announcement posted.'); renderShell(); }).catch(function (x) { $('#an-error').textContent = x.message; busy(btn, false); });
      };
      $$('[data-tog]', el).forEach(function (b) {
        b.onclick = function () { var a = byId[b.getAttribute('data-tog')]; api('adm.saveAnnouncement', Object.assign({}, a, { active: !a.active })).then(function () { renderShell(); }); };
      });
      $$('[data-del-an]', el).forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm'; return; }
          api('adm.deleteAnnouncement', { id: b.getAttribute('data-del-an') }).then(function () { toast('Deleted.'); renderShell(); });
        };
      });
    });
  };

  var VIEWS = { employee: EMP, client: CLI, admin: ADM };

  /* ================= boot ================= */
  function start() {
    if (!S.user) return renderLogin();
    if (S.user.must_change) return renderChangePassword();
    api('session').then(function (j) {
      S.user = j.user; S.announcements = j.announcements || [];
      if (!S.user) return renderLogin();
      if (S.user.role === 'admin') return api('adm.overview').then(function (o) { S.counts = o.counts; renderShell(); });
      renderShell();
    }).catch(function (x) { renderLogin(x.message); });
  }
  function boot() {
    api('session').then(function (j) {
      S.adminEmail = j.adminEmail || S.adminEmail;
      if (j.needsSetup) return renderSetup();
      S.user = j.user;
      start();
    }).catch(function (x) {
      app.innerHTML = '<div class="boot"><img src="assets/images/image07.png" alt="dé pitch" width="132"><p class="error" style="max-width:420px;text-align:center">' + esc(x.message) + '</p><p class="small muted" style="max-width:420px;text-align:center">The portal needs its server and database, so it works on the live Vercel site, not in a preview.</p><p class="small"><a href="index.html">← Back to the website</a></p></div>';
    });
  }
  document.addEventListener('click', function (e) {
    var side = document.getElementById('side');
    if (side && side.classList.contains('open') && !side.contains(e.target) && !e.target.closest('#menu-btn')) side.classList.remove('open');
  });
  window.addEventListener('hashchange', function () { if (S.user && !S.user.must_change) renderShell(); });
  boot();
})();
