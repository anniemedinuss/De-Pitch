/* Dé Pitch — shared site behaviour (every page loads this file).
   Replaces Carrd's engine and its add-ons (Common Ninja, Elfsight,
   Chatway, EmailOctopus) with plain JavaScript. */
(function () {
  'use strict';

  /* ================= SETTINGS — edit these ================= */
  var CONFIG = {
    // Every website form is saved in the portal (People Ops → Website enquiries).

    // Google Analytics / Ads IDs from the old site. They load only after a
    // visitor accepts cookies. Set to [] to turn analytics off.
    analyticsIds: ['G-7HQ6NNKRQ8', 'AW-17950309566'],

    // "Get 10% off" popup: delay in milliseconds. 0 turns it off.
    promoDelay: 9000
  };
  /* ========================================================= */

  function store(key, val) {
    try {
      if (val === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, val);
    } catch (e) { return null; }
  }
  var page = document.body.getAttribute('data-page') || '';

  /* ---------- old Carrd links (depitchhq.com/#cvrevamp) keep working ---------- */
  var LEGACY = {
    aboutdepitch: 'about.html', cvrevamp: 'cv-revamp.html', humancapitalmanagement: 'enterprise.html',
    enterprise: 'enterprise.html', humancapital: 'enterprise.html#humancapital',
    recruitment: 'recruitment.html', recruitmentdets: 'recruitment.html#recruitmentdets',
    recruitmentrequest: 'recruitment.html#recruitmentrequest', interviewprep: 'interview-prep.html',
    interviewprepsignup: 'interview-prep.html#interviewprepsignup', freeconsultation: 'free-consultation.html',
    blog: 'scoop.html', contact: 'contact.html', learnmore: 'contact.html#learnmore',
    theorigin: 'about.html#theorigin', received: 'thank-you.html', newsletterreceived: 'youre-in.html',
    privacypolicy: 'privacy-policy.html', termsandconditions: 'terms.html',
    refundpolicy: 'refund-policy.html', cookiepolicy: 'cookie-policy.html'
  };
  if (page === 'home') {
    var legacy = LEGACY[location.hash.replace('#', '')];
    if (legacy) { location.replace(legacy); return; }
  }

  /* ---------- mobile menu ---------- */
  var menu = document.getElementById('mobile-menu');
  function openMenu() {
    menu.classList.add('open');
    menu.removeAttribute('aria-hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  document.querySelector('.menu-toggle').addEventListener('click', openMenu);
  menu.querySelector('.close').addEventListener('click', closeMenu);
  menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMenu); });

  /* ---------- forms ---------- */
  function hidden(form, name, value) {
    var input = form.querySelector('input[name="' + name + '"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  }
  document.querySelectorAll('form[data-form]').forEach(function (form) {
    var next = form.getAttribute('data-success') === 'newsletterreceived' ? 'youre-in.html' : 'thank-you.html';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      var fields = {}, fileInput = null;
      new FormData(form).forEach(function (v, k) {
        if (typeof v === 'string') { if (k.charAt(0) !== '_') fields[k] = v; }
      });
      fileInput = form.querySelector('input[type="file"]');
      var f = fileInput && fileInput.files && fileInput.files[0];
      if (f && f.size > 3 * 1024 * 1024) { alert('Please upload a file of 3 MB or less.'); if (btn) { btn.disabled = false; btn.textContent = label; } return; }
      var readFile = f ? new Promise(function (resolve) { var r = new FileReader(); r.onload = function () { resolve({ name: f.name, type: f.type || 'application/pdf', data: String(r.result).split(',')[1] }); }; r.onerror = function () { resolve(null); }; r.readAsDataURL(f); }) : Promise.resolve(null);
      readFile.then(function (file) {
        return fetch('/api/portal', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': '1' },
          body: JSON.stringify({ action: 'public.form', form: form.getAttribute('data-form'), fields: fields, file: file, page: document.title, hp: (form.querySelector('[name=_honey]') || {}).value || '' })
        });
      }).then(function (r) {
        if (r.ok) { location.href = next; return; }
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status >= 400 && r.status < 500 && j.error) { alert(j.error); if (btn) { btn.disabled = false; btn.textContent = label; } return; }
          throw new Error('server');
        });
      }).catch(function () {
        alert('Sorry, your message could not be sent. Please check your connection and try again, or email office@depitchhq.com.');
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
      if (window.gtag) {
        window.gtag('event', 'conversion_event_submit_lead_form', { form_name: form.getAttribute('data-form') });
        window.gtag('event', 'ads_conversion_Submit_lead_form_1', {});
      }
      store('dp_promo_seen', '1');
    });
  });

  // Date pickers: no past dates
  var now = new Date();
  var iso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  document.querySelectorAll('input[type="date"]').forEach(function (d) { d.min = iso; });

  /* ---------- live chat + points widget (replaces Chatway) ---------- */
  var fab = document.querySelector('.chat-fab');
  var box = fab.querySelector('.chat-box');
  var openBtn = fab.querySelector('.cw-open');
  var badge = fab.querySelector('.cw-badge');
  var chatPane = box.querySelector('[data-pane="chat"]');
  var pointsPane = box.querySelector('[data-pane="points"]');
  var chat = {};
  try { chat = JSON.parse(store('dp_chat') || '{}') || {}; } catch (e) { chat = {}; }
  var member = {};
  try { member = JSON.parse(store('dp_member') || '{}') || {}; } catch (e) { member = {}; }
  var lastId = 0, pollTimer = null, seenStaff = Number(chat.seenStaff || 0);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(action, data) {
    return fetch('/api/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': '1' },
      body: JSON.stringify(Object.assign({}, data || {}, { action: action }))
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Please try again, or email office@depitchhq.com.'); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function saveChat() { store('dp_chat', JSON.stringify(chat)); }
  function fmtTime(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function isOpen() { return box.classList.contains('open'); }

  function setOpen(open) {
    box.classList.toggle('open', open);
    openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { badge.hidden = true; renderChat(); schedulePoll(); }
  }
  openBtn.addEventListener('click', function () { setOpen(!isOpen()); });
  box.querySelector('.cw-x').addEventListener('click', function () { setOpen(false); });
  box.querySelectorAll('.cw-tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      var tab = b.getAttribute('data-tab');
      box.querySelectorAll('.cw-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      chatPane.hidden = tab !== 'chat';
      pointsPane.hidden = tab !== 'points';
      if (tab === 'points') renderPoints();
    });
  });
  document.querySelectorAll('[data-open-points]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); setOpen(true); box.querySelector('[data-tab="points"]').click(); });
  });

  /* working hours: Mon–Fri, 10am–5pm Lagos time */
  function office() {
    var parts = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date())
        .forEach(function (p) { parts[p.type] = p.value; });
    } catch (e) { var d = new Date(); parts = { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()], hour: String((d.getUTCHours() + 1) % 24) }; }
    var day = parts.weekday, hour = Number(parts.hour) % 24;
    var weekend = day === 'Sat' || day === 'Sun';
    if (!weekend && hour >= 10 && hour < 17) return { open: true, msg: 'We usually reply within a few minutes' };
    if (!weekend && hour < 10) return { open: false, msg: 'We are offline right now. We will reply today from 10am.' };
    if (weekend || day === 'Fri') return { open: false, msg: 'We are offline for the weekend. We will reply on the next working day (Monday).' };
    return { open: false, msg: 'We are offline for today. We will reply tomorrow from 10am.' };
  }
  function paintOffice() {
    var o = office();
    var st = box.querySelector('.cw-status');
    if (st) st.textContent = o.open ? 'We usually reply within a few minutes' : 'Offline now';
    var note = chatPane.querySelector('.cw-note');
    if (note) note.textContent = o.open ? 'Dé Pitch will reply here. If you leave, we will get back to you at ' + (chat.email || 'your email') + '.' : o.msg + ' We will reply here and at ' + (chat.email || 'your email') + '.';
    var intro = chatPane.querySelector('.cw-offline');
    if (intro) { intro.hidden = o.open; intro.textContent = o.msg; }
  }
  setInterval(paintOffice, 60000);

  /* chat */
  function renderChat() {
    if (!chat.token) {
      chatPane.innerHTML = '<p class="cw-intro">Questions about your CV, interviews or hiring? Send us a message and we will reply right here.</p><p class="cw-offline" hidden></p>' +
        '<form class="cw-form" id="cw-start"><input class="hp" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<label>Your name<input name="name" required maxlength="120" value="' + esc(member.name || '') + '"></label>' +
        '<label>Email<input type="email" name="email" required maxlength="160" value="' + esc(member.email || '') + '"></label>' +
        '<label>Message<textarea name="message" required maxlength="2000" rows="3"></textarea></label>' +
        '<p class="cw-err" role="alert"></p><button class="btn btn-dark" type="submit">Send message</button></form>';
      chatPane.querySelector('#cw-start').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = this, btn = f.querySelector('button'); var d = Object.fromEntries(new FormData(f));
        btn.disabled = true; btn.textContent = 'Sending…';
        d.page = document.title;
        api('public.chatStart', d).then(function (j) {
          chat = { token: j.token, name: d.name, email: d.email, seenStaff: 0 };
          member = { name: d.name, email: d.email }; store('dp_member', JSON.stringify(member));
          saveChat(); lastId = 0; renderChat(); addMessages(j.messages || []);
        }).catch(function (x) { f.querySelector('.cw-err').textContent = x.message; btn.disabled = false; btn.textContent = 'Send message'; });
      });
      paintOffice();
      return;
    }
    if (chatPane.querySelector('.cw-thread')) return;
    chatPane.innerHTML = '<div class="cw-thread" aria-live="polite"></div>' +
      '<p class="cw-note">Dé Pitch will reply here. If you leave, we will get back to you at ' + esc(chat.email) + '.</p>' +
      '<form class="cw-send" id="cw-send"><textarea name="message" rows="2" maxlength="2000" placeholder="Write a message" aria-label="Message" required></textarea><button class="btn btn-dark" type="submit" aria-label="Send">Send</button></form>' +
      '<button type="button" class="cw-link" id="cw-new">Start a new conversation</button>';
    lastId = 0;
    var ta = chatPane.querySelector('textarea');
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatPane.querySelector('#cw-send button').click(); } });
    chatPane.querySelector('#cw-send').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = ta.value.trim(); if (!msg) return;
      var btn = this.querySelector('button'); btn.disabled = true;
      api('public.chatSend', { token: chat.token, message: msg, after: lastId }).then(function (j) { ta.value = ''; addMessages(j.messages || []); })
        .catch(function (x) { if (x.status === 404) { resetChat(); } else alert(x.message); })
        .finally(function () { btn.disabled = false; ta.focus(); });
    });
    chatPane.querySelector('#cw-new').addEventListener('click', resetChat);
    paintOffice();
    poll(); schedulePoll();
  }
  function resetChat() { chat = {}; saveChat(); lastId = 0; chatPane.innerHTML = ''; renderChat(); }
  function autoNote() {
    var o = office(), thread = chatPane.querySelector('.cw-thread');
    if (o.open || !thread || thread.querySelector('.cw-auto')) return;
    var el = document.createElement('div');
    el.className = 'cw-msg staff cw-auto';
    el.innerHTML = '<span class="who">Dé Pitch · automatic reply</span><p>' + esc('Thanks for your message! ' + o.msg + ' Our working hours are Monday to Friday, 10am to 5pm.') + '</p>';
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
  }
  function addMessages(msgs) {
    var thread = chatPane.querySelector('.cw-thread');
    var fromVisitor = msgs.some(function (m) { return m.sender === 'visitor' && m.id > lastId; });
    msgs.forEach(function (m) {
      if (m.id <= lastId) return;
      lastId = m.id;
      if (m.sender === 'staff' && m.id > seenStaff) {
        if (isOpen() && !chatPane.hidden) { seenStaff = m.id; chat.seenStaff = seenStaff; saveChat(); }
        else badge.hidden = false;
      }
      if (!thread) return;
      var el = document.createElement('div');
      el.className = 'cw-msg ' + (m.sender === 'staff' ? 'staff' : 'me');
      el.innerHTML = '<span class="who">' + (m.sender === 'staff' ? 'Dé Pitch' : 'You') + ' · ' + esc(fmtTime(m.created_at)) + '</span><p>' + esc(m.body) + '</p>';
      thread.appendChild(el);
    });
    if (thread) thread.scrollTop = thread.scrollHeight;
    if (fromVisitor) { var last = msgs[msgs.length - 1]; if (last && last.sender === 'visitor') autoNote(); }
  }
  function poll() {
    if (!chat.token) return;
    api('public.chatPoll', { token: chat.token, after: lastId }).then(function (j) { addMessages(j.messages || []); })
      .catch(function (x) { if (x.status === 404) resetChat(); });
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!chat.token) return;
    pollTimer = setTimeout(function () { poll(); schedulePoll(); }, isOpen() ? 5000 : 30000);
  }
  if (chat.token) { lastId = 0; poll(); schedulePoll(); }

  /* points */
  var CAT = null;
  function num(n) { return Number(n || 0).toLocaleString('en-NG'); }
  function earnTable(cat) {
    return '<div class="cw-cols"><div><h5>Earn points</h5><ul class="cw-list">' + cat.earn.map(function (e) { return '<li><span>' + esc(e.label) + '</span><b>' + num(e.points) + '</b></li>'; }).join('') + '</ul></div>' +
      '<div><h5>Use your points</h5><ul class="cw-list">' + cat.rewards.map(function (r) { return '<li><span>' + esc(r.label) + '</span><b>' + num(r.points) + '</b></li>'; }).join('') + '</ul></div></div>';
  }
  function memberFields() {
    return '<label>Full name<input name="name" required maxlength="120" value="' + esc(member.name || '') + '"></label>' +
      '<label>Email<input type="email" name="email" required maxlength="160" value="' + esc(member.email || '') + '"></label>';
  }
  function renderPoints(view) {
    view = view || 'home';
    if (view === 'home') {
      pointsPane.innerHTML = '<p class="cw-intro">Earn points when you leave us a Google review or refer someone who uses Dé Pitch. Enter your full name and email to see your points.</p>' +
        '<form class="cw-form" id="cw-lookup">' + memberFields() + '<p class="cw-err" role="alert"></p><button class="btn btn-dark" type="submit">See my points</button></form>' +
        '<div class="cw-row"><button type="button" class="cw-link" data-go="review">I left a Google review</button><button type="button" class="cw-link" data-go="refer">Refer someone</button></div>' +
        '<div id="cw-cat"></div>';
      var showCat = function (c) { CAT = c; var el = pointsPane.querySelector('#cw-cat'); if (el) el.innerHTML = earnTable(c); };
      if (CAT) showCat(CAT);
      pointsPane.querySelector('#cw-lookup').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = this, d = Object.fromEntries(new FormData(f)), btn = f.querySelector('button');
        btn.disabled = true; btn.textContent = 'Checking…';
        api('public.points', d).then(function (j) {
          member = { name: d.name, email: d.email }; store('dp_member', JSON.stringify(member));
          CAT = j.catalogue;
          if (!j.found) { f.querySelector('.cw-err').textContent = 'No points yet for that name and email. Leave a review or refer someone to start earning.'; btn.disabled = false; btn.textContent = 'See my points'; showCat(j.catalogue); return; }
          renderAccount(j);
        }).catch(function (x) { f.querySelector('.cw-err').textContent = x.message; btn.disabled = false; btn.textContent = 'See my points'; });
      });
      bindGo();
      return;
    }
    if (view === 'review') {
      pointsPane.innerHTML = '<button type="button" class="cw-link" data-go="home">← Back</button><h5>Claim 50 points for a Google review</h5>' +
        '<p class="cw-intro">Leave a Google review for Dé Pitch, then tell us the name it was posted under. People Ops checks it and adds your points.</p>' +
        '<form class="cw-form" id="cw-claim"><input class="hp" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' + memberFields() +
        '<label>Name shown on your Google review<input name="review_name" required maxlength="120"></label>' +
        '<label>Link to your review (optional)<input name="review_link" maxlength="400" placeholder="https://"></label>' +
        '<p class="cw-err" role="alert"></p><button class="btn btn-dark" type="submit">Claim my points</button></form>';
    }
    if (view === 'refer') {
      pointsPane.innerHTML = '<button type="button" class="cw-link" data-go="home">← Back</button><h5>Refer someone</h5>' +
        '<p class="cw-intro">You earn points once the person you refer becomes a Dé Pitch client: 300 for a CV revamp, 600 for interview preparation, 3,000 for a recruitment client.</p>' +
        '<form class="cw-form" id="cw-claim"><input class="hp" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' + memberFields() +
        '<label>Their full name<input name="ref_name" required maxlength="120"></label>' +
        '<label>Their email<input type="email" name="ref_email" maxlength="160"></label>' +
        '<label>Their phone<input name="ref_phone" maxlength="40"></label>' +
        '<label>What they need<select name="ref_service" required><option value="">Choose a service</option><option value="cv">CV revamp</option><option value="interview">Interview preparation</option><option value="recruitment">Recruitment (a company hiring)</option></select></label>' +
        '<label>Company (if hiring)<input name="ref_company" maxlength="160"></label>' +
        '<p class="cw-err" role="alert"></p><button class="btn btn-dark" type="submit">Send referral</button></form>';
    }
    var form = pointsPane.querySelector('#cw-claim');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = Object.fromEntries(new FormData(form)), btn = form.querySelector('button');
      d.type = view === 'review' ? 'google_review' : 'referral';
      btn.disabled = true; btn.textContent = 'Sending…';
      api('public.pointsClaim', d).then(function () {
        member = { name: d.name, email: d.email }; store('dp_member', JSON.stringify(member));
        pointsPane.innerHTML = '<div class="cw-done"><b>Thank you!</b><p>People Ops will review this and add your points. We will email you when they land.</p><button type="button" class="btn btn-dark" data-go="home">Back to points</button></div>';
        bindGo();
      }).catch(function (x) { form.querySelector('.cw-err').textContent = x.message; btn.disabled = false; btn.textContent = 'Try again'; });
    });
    bindGo();
  }
  function bindGo() { pointsPane.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { renderPoints(b.getAttribute('data-go')); }); }); }

  function renderAccount(j) {
    var cat = j.catalogue;
    var pend = (j.claims || []).filter(function (c) { return c.status === 'pending'; }).length + (j.redemptions || []).filter(function (r) { return r.status === 'pending'; }).length;
    pointsPane.innerHTML = '<button type="button" class="cw-link" data-go="home">← Back</button>' +
      '<div class="cw-balance"><span>Hi ' + esc(String(j.name).split(' ')[0]) + ', you have</span><b>' + num(j.balance) + ' points</b>' +
      (j.available !== j.balance ? '<span>' + num(j.available) + ' available (some are waiting on a redemption)</span>' : '') +
      (pend ? '<span>' + pend + ' request(s) being reviewed by People Ops</span>' : '') + '</div>' +
      '<h5>Redeem</h5><ul class="cw-list cw-redeem">' + cat.rewards.map(function (r) {
        var ok = j.available >= r.points;
        return '<li><span>' + esc(r.label) + '<small>' + num(r.points) + ' points' + (ok ? '' : ' · ' + num(r.points - j.available) + ' to go') + '</small></span>' +
          '<button type="button" class="btn ' + (ok ? 'btn-dark' : 'btn-outline') + ' cw-sm" data-redeem="' + r.key + '"' + (ok ? '' : ' disabled') + '>Redeem</button></li>';
      }).join('') + '</ul>' +
      '<div class="cw-row"><button type="button" class="cw-link" data-go="review">Claim review points</button><button type="button" class="cw-link" data-go="refer">Refer someone</button></div>' +
      '<h5>History</h5>' + ((j.history || []).length ? '<ul class="cw-list cw-hist">' + j.history.map(function (h) {
        return '<li><span>' + esc(h.reason) + '<small>' + esc(fmtTime(h.created_at)) + '</small></span><b class="' + (h.points < 0 ? 'neg' : 'pos') + '">' + (h.points > 0 ? '+' : '') + num(h.points) + '</b></li>';
      }).join('') + '</ul>' : '<p class="cw-intro">No points yet.</p>');
    bindGo();
    pointsPane.querySelectorAll('[data-redeem]').forEach(function (b) {
      b.addEventListener('click', function () { redeemForm(j, b.getAttribute('data-redeem')); });
    });
  }
  function redeemForm(j, key) {
    var r = j.catalogue.rewards.filter(function (x) { return x.key === key; })[0];
    var cash = key === 'cash';
    var maxCash = Math.floor(j.available / 1000) * 1000;
    pointsPane.innerHTML = '<button type="button" class="cw-link" id="cw-back">← Back</button><h5>Redeem: ' + esc(cash ? 'cash' : r.label) + '</h5>' +
      '<form class="cw-form" id="cw-redeem">' +
      (cash ? '<label>Points to cash in (steps of 1,000)<input type="number" name="points" min="1000" step="1000" max="' + maxCash + '" value="' + maxCash + '" required></label><p class="cw-intro" id="cw-cash"></p>' +
        '<label>Bank name, account number and account name<textarea name="details" rows="3" required maxlength="600"></textarea></label>'
        : '<p class="cw-intro">This uses ' + num(r.points) + ' points. People Ops will contact you to book it.</p><label>Anything we should know (optional)<textarea name="details" rows="2" maxlength="600"></textarea></label>') +
      '<p class="cw-err" role="alert"></p><button class="btn btn-dark" type="submit">Send request</button></form>';
    pointsPane.querySelector('#cw-back').addEventListener('click', function () { renderAccount(j); });
    var f = pointsPane.querySelector('#cw-redeem');
    function cashText() { var p = Number(f.points.value) || 0; pointsPane.querySelector('#cw-cash').textContent = num(Math.floor(p / 1000) * 1000) + ' points = ₦' + num(Math.floor(p / 1000) * 1000 * j.catalogue.nairaPerPoint); }
    if (cash) { f.points.addEventListener('input', cashText); cashText(); }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = Object.fromEntries(new FormData(f)), btn = f.querySelector('button');
      d.reward = key; d.name = member.name; d.email = member.email;
      btn.disabled = true; btn.textContent = 'Sending…';
      api('public.redeem', d).then(function () {
        pointsPane.innerHTML = '<div class="cw-done"><b>Request sent</b><p>People Ops will confirm your redemption by email.</p><button type="button" class="btn btn-dark" data-go="home">Back to points</button></div>';
        bindGo();
      }).catch(function (x) { f.querySelector('.cw-err').textContent = x.message; btn.disabled = false; btn.textContent = 'Send request'; });
    });
  }

  // Links in points emails open the rewards tab: /?points=1
  if (/[?&]points=1/.test(location.search)) setTimeout(function () { setOpen(true); box.querySelector('[data-tab="points"]').click(); }, 300);

  document.addEventListener('click', function (e) {
    if (!e.target.isConnected) return; // the widget re-drew itself during this click
    if (isOpen() && !fab.contains(e.target) && !e.target.closest('[data-open-points]')) setOpen(false);
  });

  /* ---------- cookie consent (replaces Elfsight) + analytics ---------- */
  function loadAnalytics() {
    if (!CONFIG.analyticsIds.length || window.gtag) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + CONFIG.analyticsIds[0];
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    CONFIG.analyticsIds.forEach(function (id) { window.gtag('config', id); });
  }
  var cookie = document.getElementById('cookie');
  var consent = store('dp_cookie_consent');
  if (consent === 'all') loadAnalytics();
  else if (!consent) cookie.classList.add('show');
  cookie.querySelector('[data-accept]').addEventListener('click', function () {
    store('dp_cookie_consent', 'all'); cookie.classList.remove('show'); loadAnalytics();
  });
  cookie.querySelector('[data-decline]').addEventListener('click', function () {
    store('dp_cookie_consent', 'essential'); cookie.classList.remove('show');
  });

  /* ---------- promo popup (replaces EmailOctopus) ---------- */
  var promo = document.getElementById('promo');
  function closePromo() { promo.classList.remove('open'); store('dp_promo_seen', '1'); }
  promo.querySelector('.x').addEventListener('click', closePromo);
  promo.addEventListener('click', function (e) { if (e.target === promo) closePromo(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePromo(); closeMenu(); setOpen(false); }
  });
  var quietPages = ['received', 'newsletterreceived', 'privacypolicy', 'termsandconditions', 'refundpolicy', 'cookiepolicy'];
  if (CONFIG.promoDelay && !store('dp_promo_seen') && quietPages.indexOf(page) === -1) {
    setTimeout(function () {
      if (!menu.classList.contains('open') && !box.classList.contains('open') && !chat.token) promo.classList.add('open');
    }, CONFIG.promoDelay);
  }

  /* ---------- footer year ---------- */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
