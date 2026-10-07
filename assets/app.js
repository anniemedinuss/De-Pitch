/* Dé Pitch — shared site behaviour (every page loads this file).
   Replaces Carrd's engine and its add-ons (Common Ninja, Elfsight,
   Chatway, EmailOctopus) with plain JavaScript. */
(function () {
  'use strict';

  /* ================= SETTINGS — edit these ================= */
  var CONFIG = {
    // Where every form is sent. FormSubmit emails each submission (CV
    // attachments included) to this address. The first submission sends a
    // one-time "Activate Form" email to office@depitchhq.com — click it once.
    // Using Formspree / Web3Forms / Getform instead? Paste its URL here.
    formEndpoint: 'https://formsubmit.co/office@depitchhq.com',

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
    form.action = CONFIG.formEndpoint;
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    hidden(form, '_subject', 'Dé Pitch website: ' + form.getAttribute('data-form'));
    hidden(form, '_template', 'table');
    hidden(form, '_captcha', 'false');
    hidden(form, '_next', new URL(next, location.href).href);
    hidden(form, 'form', form.getAttribute('data-form'));
    hidden(form, 'page', document.title);

    form.addEventListener('submit', function () {
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
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

  /* ---------- floating contact button (replaces Chatway) ---------- */
  var fab = document.querySelector('.chat-fab');
  var box = fab.querySelector('.chat-box');
  fab.querySelector('button').addEventListener('click', function () {
    var open = box.classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', function (e) {
    if (!fab.contains(e.target)) box.classList.remove('open');
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
    if (e.key === 'Escape') { closePromo(); closeMenu(); box.classList.remove('open'); }
  });
  var quietPages = ['received', 'newsletterreceived', 'privacypolicy', 'termsandconditions', 'refundpolicy', 'cookiepolicy'];
  if (CONFIG.promoDelay && !store('dp_promo_seen') && quietPages.indexOf(page) === -1) {
    setTimeout(function () {
      if (!menu.classList.contains('open')) promo.classList.add('open');
    }, CONFIG.promoDelay);
  }

  /* ---------- footer year ---------- */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
