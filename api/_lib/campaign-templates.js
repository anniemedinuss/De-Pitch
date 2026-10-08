// Email marketing templates. Each template lists the fields People Ops / Media fill in,
// and renders to table-based HTML with inline styles so it holds up in Gmail, Outlook and Apple Mail.
// Any text field can use {{first_name}}.

const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const IMAGE_LIBRARY = [
  { key: 'meeting', label: 'Two men in a meeting' },
  { key: 'late-night', label: 'Man at laptop, evening' },
  { key: 'lounge', label: 'Man reading on sofa' },
  { key: 'team', label: 'Team at a desk' },
  { key: 'studio', label: 'Woman with laptop and camera' },
  { key: 'planning', label: 'Woman planning with sticky notes' },
  { key: 'busy-day', label: 'Woman on the phone with files' },
  { key: 'hero', label: 'Man laughing in chair' },
  { key: 'interview', label: 'Hands on laptop' },
  { key: 'placement', label: 'Laptop on table' },
  { key: 'cash', label: 'Chair and notebook' },
  { key: 'banner', label: 'Man with coffee' }
];

const f = (key, label, type = 'text', def = '', hint = '') => ({ key, label, type, def, hint });

export const TEMPLATES = [
  {
    id: 'spotlight', name: 'Spotlight', description: 'Big photo with the headline on top, a tick list of benefits and a feature card. Good for launching or pushing one service.',
    fields: [
      f('hero_image', 'Top photo', 'image', 'studio'),
      f('hero_title', 'Headline on the photo', 'text', 'Wherever you are, whenever you’re ready'),
      f('hero_text', 'Line under the headline', 'text', 'Your career partner, on your schedule.'),
      f('button_label', 'Button text', 'text', 'Book now'),
      f('button_url', 'Button link', 'url', 'https://www.depitchhq.com/free-consultation'),
      f('section_title', 'Section heading', 'text', 'Land interviews, faster'),
      f('checklist', 'Tick list (one per line)', 'textarea', 'Recruiter-ready CV\nKeyword-matched for ATS\nInterview coaching\nOne-on-one support\nFast turnaround'),
      f('body', 'Message', 'textarea', 'Hi {{first_name}},\n\nOur CV revamp turns your experience into a story recruiters want to read, so you spend less time applying and more time interviewing.'),
      f('card_image', 'Card photo', 'image', 'planning'),
      f('card_label', 'Card label', 'text', 'CV REVAMP'),
      f('card_text', 'Card text', 'textarea', 'We restructure, rewrite and position your CV around the roles you want, then walk you through every change.'),
      f('card_button', 'Card button text', 'text', 'Get started')
    ]
  },
  {
    id: 'event', name: 'Event poster', description: 'Poster-style invite: large photo with a bold headline, time, date and place, then a soft pink note signed off by hand.',
    fields: [
      f('image', 'Photo', 'image', 'meeting'),
      f('headline', 'Big headline', 'text', 'career clinic'),
      f('info_left', 'Left detail (e.g. time)', 'text', '11:00 to 3:00 PM'),
      f('info_center', 'Middle detail (e.g. date)', 'text', 'Friday 30 October 2026'),
      f('info_right', 'Right detail (e.g. place)', 'text', 'Online, on Zoom'),
      f('message', 'Message', 'textarea', 'Join us for an afternoon of honest CV reviews, mock interviews and real talk about the job market.\nBring your questions. We will bring the answers.'),
      f('signoff', 'Handwritten sign-off', 'text', 'xoxo, the Dé Pitch team'),
      f('button_label', 'Button text (optional)', 'text', 'Save my seat'),
      f('button_url', 'Button link', 'url', 'https://www.depitchhq.com/contact')
    ]
  },
  {
    id: 'note', name: 'Minimal note', description: 'Calm and simple: logo, a rounded photo with a short line on it, a few details and an outlined button. Good for updates and confirmations.',
    fields: [
      f('top_line', 'Opening line', 'text', 'Thank you for choosing Dé Pitch.'),
      f('banner', 'Small grey notice (optional)', 'text', 'Our team replies Monday to Friday, 10am to 5pm.'),
      f('image', 'Photo', 'image', 'lounge'),
      f('image_text', 'Line on the photo', 'text', 'your next move, coming soon'),
      f('intro', 'Message', 'textarea', 'Hi {{first_name}}, we have everything we need and we are already on it. Here are the details:'),
      f('details', 'Details (one per line, "Label: value")', 'textarea', 'Service: CV revamp\nTurnaround: 3 working days'),
      f('button_label', 'Button text', 'text', 'View our services'),
      f('button_url', 'Button link', 'url', 'https://www.depitchhq.com')
    ]
  },
  {
    id: 'offer', name: 'Offer', description: 'Promotion layout: running ticker, a big offer badge, a white card with a highlighted deal, and featured services on black.',
    fields: [
      f('ticker', 'Running bar text', 'text', 'NOW THROUGH 31 OCTOBER'),
      f('badge', 'Offer badge', 'text', '20% OFF'),
      f('subline', 'Line under the badge', 'text', 'every CV revamp this month'),
      f('button_label', 'Button text', 'text', 'Book now'),
      f('button_url', 'Button link', 'url', 'https://www.depitchhq.com/cv-revamp'),
      f('headline', 'Card headline', 'text', 'The job market doesn’t play fair,'),
      f('headline_bold', 'Card headline (bold line)', 'text', 'but we do.'),
      f('body', 'Card message', 'textarea', 'Hi {{first_name}}, our CV revamp and interview prep have helped people land roles across Nigeria and abroad. This month, it costs less.'),
      f('highlight', 'Green highlight box', 'text', 'Plus, get a free LinkedIn review when you book interview prep with your CV.'),
      f('button2_label', 'Card button text', 'text', 'Take 20% off'),
      f('featured_title', 'Featured heading', 'text', 'Featured services'),
      f('item1_title', 'Feature 1 title', 'text', 'CV Revamp'),
      f('item1_text', 'Feature 1 text', 'textarea', 'Rewritten around the roles you want. Recruiter-ready in days.'),
      f('item1_image', 'Feature 1 photo', 'image', 'interview'),
      f('item2_title', 'Feature 2 title', 'text', 'Interview Prep'),
      f('item2_text', 'Feature 2 text', 'textarea', 'Mock interviews with honest feedback, so the real one feels familiar.'),
      f('item2_image', 'Feature 2 photo', 'image', 'busy-day')
    ]
  },
  {
    id: 'showcase', name: 'Service showcase', description: 'Tall photo cards with savings tags and prices, ending with a blue call-to-action panel. Good for showing several services or packages.',
    fields: [
      f('hero_image', 'Top photo', 'image', 'busy-day'),
      f('hero_chip', 'Date chip', 'text', '10 to 19 October'),
      f('hero_title', 'Headline on the photo', 'text', 'Career week at Dé Pitch'),
      f('hero_big', 'Big number', 'text', 'up to -30%'),
      f('heading', 'Heading', 'text', 'Only once a year!'),
      f('subheading', 'Line under heading', 'text', 'Save on the services that move careers forward.'),
      f('chips', 'Small tags (comma separated)', 'text', 'CV revamp, Interview prep, Recruitment'),
      f('item1_image', 'Package 1 photo', 'image', 'team'),
      f('item1_title', 'Package 1 name', 'text', 'Job-ready bundle'),
      f('item1_text', 'Package 1 text', 'textarea', 'CV revamp plus one interview prep session.'),
      f('item1_tag', 'Package 1 savings tag', 'text', 'Save ₦10,000'),
      f('item1_price', 'Package 1 price', 'text', '₦45,000'),
      f('item1_old', 'Package 1 old price', 'text', '₦55,000'),
      f('item2_image', 'Package 2 photo', 'image', 'late-night'),
      f('item2_title', 'Package 2 name', 'text', 'Interview intensive'),
      f('item2_text', 'Package 2 text', 'textarea', 'Three mock interviews with written feedback.'),
      f('item2_tag', 'Package 2 savings tag', 'text', 'Save ₦8,000'),
      f('item2_price', 'Package 2 price', 'text', '₦32,000'),
      f('item2_old', 'Package 2 old price', 'text', '₦40,000'),
      f('end_title', 'Closing headline', 'text', 'Your career has no borders'),
      f('end_text', 'Closing text', 'textarea', 'We work with professionals across Nigeria and beyond.'),
      f('button_label', 'Button text', 'text', 'depitchhq.com'),
      f('button_url', 'Button link', 'url', 'https://www.depitchhq.com')
    ]
  },
  {
    id: 'editorial', name: 'Editorial newsletter', description: 'Magazine-style newsletter with a navy header, two photos with captions, a story and a pull quote.',
    fields: [
      f('kicker', 'Small label', 'text', 'THE SCOOP · OCTOBER'),
      f('headline', 'Headline', 'text', 'What recruiters noticed this month'),
      f('intro', 'Intro', 'textarea', 'Hi {{first_name}}, here is what we are seeing in hiring right now, and how to use it.'),
      f('photo1', 'Photo 1', 'image', 'planning'),
      f('caption1', 'Caption 1', 'text', 'Plan your search like a project.'),
      f('photo2', 'Photo 2', 'image', 'late-night'),
      f('caption2', 'Caption 2', 'text', 'Late applications still get read.'),
      f('story_title', 'Story heading', 'text', 'Three things that got CVs shortlisted'),
      f('story_body', 'Story', 'textarea', 'Numbers beat adjectives. Recruiters skim for results, so lead with them.\n\nOne page per decade of experience is plenty.\n\nTailor the top third of your CV to every role. That is where the decision is made.'),
      f('quote', 'Pull quote', 'text', 'I got two interview calls in the first week after my CV revamp.'),
      f('quote_by', 'Quote by', 'text', 'A Dé Pitch client'),
      f('button_label', 'Button text', 'text', 'Read more on our site'),
      f('button_url', 'Button link', 'url', 'https://www.depitchhq.com/scoop')
    ]
  },
  {
    id: 'welcome', name: 'Welcome', description: 'Deep navy frame with a soft sage card, a big word over the photo, a round photo, your story and a welcome note. Used for the automatic newsletter welcome.',
    fields: [
      f('hero_image', 'Top photo', 'image', 'studio'),
      f('hero_word', 'Big word on the photo', 'text', 'WELCOME'),
      f('headline', 'Headline', 'text', 'Welcome to Dé Pitch, {{first_name}}'),
      f('body', 'Message', 'textarea', 'Thank you for joining us. Your welcome gift is ready: a free career consultation and a 20-point head start on Dé Pitch rewards.'),
      f('gift', 'Gift box (one per line)', 'textarea', 'Free career consultation\n20 points head start'),
      f('button_label', 'Button text', 'text', 'Book my free consultation'),
      f('button_url', 'Button link', 'url', 'https://www.depitchhq.com/free-consultation'),
      f('round_image', 'Round photo', 'image', 'hero'),
      f('story_title', 'Story heading', 'text', 'The story of Dé Pitch'),
      f('story_text', 'Story', 'textarea', 'Dé Pitch began with a simple observation: most people spend their lives in jobs that don’t fit. We started because we believed work could be different, more human, more real.\n\nWhether you’re climbing the corporate ladder, building your own venture or finding your way in the gig economy, we meet you where you are and help you pitch yourself with clarity, confidence and purpose.'),
      f('story_image', 'Story photo', 'image', 'meeting'),
      f('welcome_title', 'Closing heading', 'text', 'Your points are waiting'),
      f('welcome_text', 'Closing text', 'textarea', 'Check your points any time: open the chat button on our website, choose Points & rewards, and enter your name and this email address. Keep earning by referring friends and leaving us a review.'),
      f('help_text', 'Small help text', 'textarea', 'Questions? Reply to this email or write to office@depitchhq.com. We reply Monday to Friday, 10am to 5pm (WAT).')
    ]
  }
];

export function templateById(id) { return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0]; }

function wrap(bg, inner, { preheader, footer }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<style>@media (max-width:620px){.col{display:block!important;width:100%!important;padding:0 0 14px!important}.hide-m{display:none!important}.big{font-size:44px!important}}</style></head>
<body style="margin:0;padding:0;background:${bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || '')}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg}"><tr><td align="center" style="padding:18px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">${inner}${footer}</table>
</td></tr></table></body></html>`;
}

export function renderCampaign(templateId, content, ctx) {
  const t = templateById(templateId);
  const c = {};
  for (const fd of t.fields) c[fd.key] = content && content[fd.key] != null ? String(content[fd.key]) : fd.def;
  const first = ctx.firstName || 'there';
  const P = (s) => esc(s).replace(/\{\{\s*(first_name|name)\s*\}\}/gi, esc(first));
  const para = (s, style) => String(s || '').split(/\n\s*\n/).filter((x) => x.trim()).map((x) => `<p style="margin:0 0 14px;${style}">${P(x).replace(/\n/g, '<br>')}</p>`).join('');
  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const img = (v) => {
    v = String(v || '');
    if (/^file:\d+$/.test(v)) return `${ctx.assetBase}/api/portal?img=${v.slice(5)}`;
    if (/^https:\/\//.test(v)) return esc(v);
    return `${ctx.assetBase}/assets/images/email/${encodeURIComponent(v || 'hero')}.jpg`;
  };
  const url = (v) => (/^(https?:|mailto:)/i.test(String(v || '').trim()) ? esc(String(v).trim()) : esc(ctx.siteUrl || 'https://www.depitchhq.com'));
  const pill = (label, href, bg, color, border) => label ? `<a href="${url(href)}" style="display:inline-block;background:${bg};color:${color};font:600 15px ${FONT};text-decoration:none;padding:13px 30px;border-radius:999px;${border ? `border:1.5px solid ${border};` : ''}">${P(label)}</a>` : '';
  const logoDark = `${ctx.assetBase}/assets/images/image07.png`;
  const logoLight = `${ctx.assetBase}/assets/images/image01.png`;
  const pixel = ctx.pixelUrl ? `<img src="${ctx.pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : '';
  const footer = (color = '#6b6b6b') => `<tr><td align="center" style="padding:26px 20px 10px;font:12px/1.7 ${FONT};color:${color}">
    <img src="${logoDark}" width="90" alt="dé pitch" style="display:block;width:90px;height:auto;margin:0 auto 10px;opacity:.85">
    Dé Pitch · office@depitchhq.com · <a href="${esc(ctx.siteUrl || 'https://www.depitchhq.com')}" style="color:${color}">depitchhq.com</a><br>
    You are receiving this because you are a Dé Pitch client, partner or subscriber.<br>
    <a href="${ctx.unsubUrl || '#'}" style="color:${color};text-decoration:underline">Unsubscribe</a>${pixel}</td></tr>`;

  if (t.id === 'spotlight') {
    const CORAL = '#EF4B2C';
    const ticks = lines(c.checklist).map((x) => `<tr><td width="30" valign="top" style="padding:7px 0"><span style="display:inline-block;width:18px;height:18px;border:1.5px solid ${CORAL};border-radius:50%;color:${CORAL};font:700 11px/18px ${FONT};text-align:center">&#10003;</span></td><td style="padding:7px 0;font:700 12px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:#1a1a1a">${P(x)}</td></tr>`).join('');
    return wrap('#f6e7df', `
  <tr><td style="background:#ffffff;border-radius:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td background="${img(c.hero_image)}" bgcolor="#2b2b2b" style="background:#2b2b2b url('${img(c.hero_image)}') center/cover no-repeat;height:440px" valign="top">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:26px 0 0"><img src="${logoLight}" width="120" alt="dé pitch" style="display:block;width:120px;height:auto"></td></tr>
        <tr><td align="center" style="padding:170px 30px 8px;font:600 34px/1.15 ${FONT};color:#ffffff;text-shadow:0 2px 12px rgba(0,0,0,.35)">${P(c.hero_title)}</td></tr>
        <tr><td align="center" style="padding:0 30px 18px;font:15px ${FONT};color:#ffffff;text-shadow:0 1px 8px rgba(0,0,0,.4)">${P(c.hero_text)}</td></tr>
        <tr><td align="center" style="padding:0 0 30px">${pill(c.button_label, c.button_url, 'transparent', '#ffffff', '#ffffff')}</td></tr></table>
      </td></tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;padding:34px 36px 10px" align="center"><div style="font:500 30px/1.2 ${FONT};color:#1a1a1a">${P(c.section_title)}</div></td></tr>
  <tr><td style="background:#ffffff;padding:14px 36px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack"><tr>
    <td class="col" width="52%" valign="top" style="padding-right:14px"><img src="${img(c.card_image)}" width="270" alt="" style="display:block;width:100%;height:auto;border-radius:16px"></td>
    <td class="col" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0">${ticks}</table></td></tr></table></td></tr>
  <tr><td style="background:#ffffff;padding:22px 44px 6px;text-align:center;font:16px/1.6 ${FONT};color:#333">${para(c.body)}</td></tr>
  <tr><td style="background:#ffffff;padding:6px 36px 36px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff6f2;border-radius:18px"><tr>
    <td style="padding:24px 26px"><div style="font:700 11px ${FONT};letter-spacing:.1em;color:${CORAL};margin-bottom:8px">${P(c.card_label)}</div>
    <div style="font:14px/1.6 ${FONT};color:#333;margin-bottom:16px">${P(c.card_text).replace(/\n/g, '<br>')}</div>${pill(c.card_button, c.button_url, CORAL, '#ffffff')}</td></tr></table></td></tr>`,
    { preheader: ctx.preheader, footer: footer() });
  }

  if (t.id === 'event') {
    const PINK = '#f2b8c6', CARD = '#dc9eac';
    return wrap('#f1efea', `
  <tr><td style="padding:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td background="${img(c.image)}" bgcolor="#3a3a3a" style="background:#3a3a3a url('${img(c.image)}') center/cover no-repeat;height:420px" valign="bottom">
        <div class="big" style="font:800 64px/.95 ${FONT};color:${PINK};letter-spacing:-.04em;padding:0 18px 4px">${P(c.headline)}</div>
      </td></tr></table>
  </td></tr>
  <tr><td style="padding:14px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="33%" style="font:14px ${FONT};color:#1a1a1a">${P(c.info_left)}</td>
    <td width="34%" align="center" style="font:14px ${FONT};color:#1a1a1a">${P(c.info_center)}</td>
    <td width="33%" align="right" style="font:14px ${FONT};color:#1a1a1a">${P(c.info_right)}</td></tr></table></td></tr>
  <tr><td style="background:${CARD};padding:70px 34px 34px" align="center">
    <div style="font:15px/1.7 ${FONT};color:#2b2b2b;max-width:460px">${P(c.message).replace(/\n/g, '<br>')}</div>
    <div style="font:italic 20px 'Brush Script MT','Segoe Script','Snell Roundhand',cursive;color:#2b2b2b;margin:14px auto 0;max-width:460px;text-align:right">${P(c.signoff)}</div>
    ${c.button_label ? `<div style="padding:30px 0 6px">${pill(c.button_label, c.button_url, '#1a1a1a', '#ffffff')}</div>` : ''}
    <div style="padding:46px 0 0"><img src="${logoDark}" width="110" alt="dé pitch" style="display:inline-block;width:110px;height:auto"></div>
    <div style="font:10px ${FONT};color:#2b2b2b;letter-spacing:.06em">career &amp; recruitment partner</div>
  </td></tr>`,
    { preheader: ctx.preheader, footer: footer() });
  }

  if (t.id === 'note') {
    const GREY = '#5f5d59';
    const details = lines(c.details).map((x) => {
      const i = x.indexOf(':');
      return i > 0 ? `<div style="font:16px/1.7 ${FONT};color:${GREY}"><b style="text-transform:uppercase;letter-spacing:.03em">${P(x.slice(0, i))}</b> ${P(x.slice(i + 1).trim())}</div>` : `<div style="font:16px/1.7 ${FONT};color:${GREY}">${P(x)}</div>`;
    }).join('');
    return wrap('#fff7f4', `
  <tr><td align="center" style="padding:20px 30px 16px;font:20px ${FONT};color:${GREY}">${P(c.top_line)}</td></tr>
  ${c.banner ? `<tr><td style="padding:0 40px"><div style="background:#f1efea;border-radius:8px;padding:10px 16px;text-align:center;font:700 11px/1.5 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${GREY}">${P(c.banner)}</div></td></tr>` : ''}
  <tr><td align="center" style="padding:30px 0 26px"><img src="${logoDark}" width="200" alt="dé pitch" style="display:block;width:200px;height:auto"></td></tr>
  <tr><td style="padding:0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td background="${img(c.image)}" bgcolor="#8a7f78" style="background:#8a7f78 url('${img(c.image)}') center/cover no-repeat;height:330px;border-radius:16px" align="center" valign="middle">
      <div style="font:600 26px ${FONT};color:#ffffff;text-shadow:0 2px 14px rgba(0,0,0,.45);padding:0 20px">${P(c.image_text)}</div></td></tr></table></td></tr>
  <tr><td align="center" style="padding:30px 46px 10px;font:18px/1.6 ${FONT};color:${GREY}">${P(c.intro).replace(/\n/g, '<br>')}</td></tr>
  <tr><td align="center" style="padding:6px 46px 26px">${details}</td></tr>
  <tr><td align="center" style="padding:0 0 20px">${pill(c.button_label, c.button_url, '#f1efea', GREY, GREY).replace('font:600 15px', 'font:400 18px').replace('padding:13px 30px', 'padding:16px 54px').replace(/text-decoration:none;/, 'text-decoration:none;letter-spacing:.04em;text-transform:uppercase;')}</td></tr>`,
    { preheader: ctx.preheader, footer: footer() });
  }

  if (t.id === 'offer') {
    const tick = Array(2).fill(P(c.ticker)).join(' &nbsp;•&nbsp; ');
    const feat = (n) => c[`item${n}_title`] ? `<tr><td style="padding:0 26px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px"><tr>
      <td valign="middle" style="padding:20px 10px 20px 22px"><div style="font:600 18px ${FONT};color:#1a1a1a;margin-bottom:6px">${P(c[`item${n}_title`])}</div><div style="font:14px/1.55 ${FONT};color:#444">${P(c[`item${n}_text`])}</div>
      <div style="padding-top:14px">${pill('Learn more', c.button_url, '#1a1a1a', '#ffffff').replace('padding:13px 30px', 'padding:9px 20px').replace('font:600 15px', 'font:600 13px')}</div></td>
      <td width="170" valign="middle" style="padding:12px"><img src="${img(c[`item${n}_image`])}" width="160" alt="" style="display:block;width:160px;height:auto;border-radius:12px"></td></tr></table></td></tr>` : '';
    return wrap('#e9e9e7', `
  <tr><td style="background:#111111;padding:9px 10px;font:600 12px ${FONT};letter-spacing:.06em;color:#ffffff;overflow:hidden" align="center">${tick}</td></tr>
  <tr><td style="background:#e4e4e2;padding:34px 30px 40px" align="center">
    <img src="${logoDark}" width="150" alt="dé pitch" style="display:block;width:150px;height:auto;margin:0 auto 28px">
    <div style="display:inline-block;border:3px solid #1a1a1a;border-radius:999px;padding:8px 30px;font:800 40px ${FONT};color:#1a1a1a;letter-spacing:-.01em">${P(c.badge)}</div>
    <div style="font:22px ${FONT};color:#1a1a1a;margin:14px 0 24px">${P(c.subline)}</div>
    ${pill(c.button_label, c.button_url, '#ffffff', '#1a1a1a')}
  </td></tr>
  <tr><td style="background:#e4e4e2;padding:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:28px 28px 0 0"><tr><td align="center" style="padding:36px 40px 30px">
      <div style="font:22px/1.35 ${FONT};color:#1a1a1a">${P(c.headline)}<br><b>${P(c.headline_bold)}</b></div>
      <div style="font:16px/1.6 ${FONT};color:#333;margin:14px 0 20px">${P(c.body).replace(/\n/g, '<br>')}</div>
      ${c.highlight ? `<div style="background:#c8e48f;border-radius:10px;padding:13px 18px;font:600 13px/1.5 ${FONT};letter-spacing:.03em;text-transform:uppercase;color:#1a1a1a;margin-bottom:22px">${P(c.highlight)}</div>` : ''}
      ${pill(c.button2_label, c.button_url, '#111111', '#ffffff')}
    </td></tr></table></td></tr>
  <tr><td style="background:#111111;padding:30px 0 16px">
    <div style="font:600 13px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:#ffffff;text-align:center;padding-bottom:20px">${P(c.featured_title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${feat(1)}${feat(2)}</table></td></tr>`,
    { preheader: ctx.preheader, footer: footer() });
  }

  if (t.id === 'showcase') {
    const BLUE = '#3f86c8';
    const chips = String(c.chips || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => `<span style="display:inline-block;background:#efefef;border-radius:999px;padding:7px 14px;margin:0 4px 6px;font:13px ${FONT};color:#333">${P(x)}</span>`).join('');
    const item = (n) => c[`item${n}_title`] ? `<tr><td style="padding:0 0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td><img src="${img(c[`item${n}_image`])}" width="600" alt="" style="display:block;width:100%;height:auto;max-height:340px;object-fit:cover"></td></tr>
      <tr><td style="padding:20px 24px 24px"><div style="font:800 20px ${FONT};color:${BLUE};text-transform:uppercase;letter-spacing:.01em">${P(c[`item${n}_title`])}</div>
        <div style="font:14px/1.5 ${FONT};color:#555;margin:6px 0 14px">${P(c[`item${n}_text`])}</div>
        ${c[`item${n}_tag`] ? `<span style="display:inline-block;background:${BLUE};color:#fff;font:600 13px ${FONT};padding:5px 10px;border-radius:2px">${P(c[`item${n}_tag`])}</span>` : ''}
        <div style="font:800 28px ${FONT};color:#1a1a1a;margin-top:10px">${P(c[`item${n}_price`])}</div>
        ${c[`item${n}_old`] ? `<div style="font:14px ${FONT};color:#999;text-decoration:line-through">${P(c[`item${n}_old`])}</div>` : ''}
      </td></tr></table></td></tr>` : '';
    return wrap('#f7f4f1', `
  <tr><td style="padding:0 0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td background="${img(c.hero_image)}" bgcolor="#6f6a66" style="background:#6f6a66 url('${img(c.hero_image)}') center/cover no-repeat;height:480px;border-radius:16px" valign="top">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:22px 0 0"><img src="${logoLight}" width="110" alt="dé pitch" style="display:block;width:110px;height:auto"></td></tr>
      <tr><td style="padding:250px 28px 0"><span style="display:inline-block;background:#ffffff;border-radius:999px;padding:6px 14px;font:600 13px ${FONT};color:#1a1a1a">${P(c.hero_chip)}</span></td></tr>
      <tr><td style="padding:10px 28px 0;font:800 26px/1.15 ${FONT};color:#ffffff;text-transform:uppercase;text-shadow:0 2px 10px rgba(0,0,0,.35)">${P(c.hero_title)}</td></tr>
      <tr><td style="padding:2px 28px 26px;font:800 40px ${FONT};color:#ffffff;text-shadow:0 2px 10px rgba(0,0,0,.35)">${P(c.hero_big)}</td></tr></table>
    </td></tr></table></td></tr>
  <tr><td align="center" style="padding:10px 30px 6px;font:700 28px/1.2 ${FONT};color:#1a1a1a">${P(c.heading)}</td></tr>
  <tr><td align="center" style="padding:0 30px 14px;font:16px/1.5 ${FONT};color:#555">${P(c.subheading)}</td></tr>
  <tr><td align="center" style="padding:0 20px 22px">${chips}</td></tr>
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${item(1)}${item(2)}</table></td></tr>
  <tr><td style="background:${BLUE};background-image:linear-gradient(180deg,#b9d7ef 0%,${BLUE} 100%);border-radius:16px;padding:40px 30px" align="center">
    <div style="font:700 28px/1.2 ${FONT};color:#ffffff">${P(c.end_title)}</div>
    <div style="font:15px/1.6 ${FONT};color:#ffffff;margin:10px 0 22px">${P(c.end_text)}</div>
    <a href="${url(c.button_url)}" style="display:inline-block;background:#ffffff;color:#1a1a1a;font:600 18px ${FONT};text-decoration:none;padding:14px 40px;border-radius:8px">${P(c.button_label)}</a>
    <div style="padding-top:26px"><img src="${logoLight}" width="120" alt="dé pitch" style="display:inline-block;width:120px;height:auto"></div></td></tr>`,
    { preheader: ctx.preheader, footer: footer() });
  }

  if (t.id === 'welcome') {
    const NAVY = '#011D38', SAGE = '#e3ede6', ACC = '#7fae8a', INK = '#0f2a1f';
    const gifts = lines(c.gift).map((x) => `<tr><td style="padding:6px 0;font:600 15px ${FONT};color:${NAVY}"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${ACC};color:#fff;text-align:center;font:700 13px/22px ${FONT};margin-right:10px">&#10003;</span>${P(x)}</td></tr>`).join('');
    const nav = (label, href) => `<a href="${esc(href)}" style="color:#ffffff;text-decoration:none;font:500 12px ${FONT};letter-spacing:.06em">${label}</a>`;
    return wrap('#dfeee3', `
  <tr><td style="background:${NAVY};border-radius:28px 28px 0 0;padding:26px 30px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle"><img src="${logoLight}" width="120" alt="dé pitch" style="display:block;width:120px;height:auto"></td>
      <td align="right" valign="middle" class="hide-m">${nav('SERVICES', (ctx.siteUrl || '') + '/#services')} <span style="color:#7d93a8">&nbsp;|&nbsp;</span> ${nav('OUR STORY', (ctx.siteUrl || '') + '/about')} <span style="color:#7d93a8">&nbsp;|&nbsp;</span> ${nav('CONTACT', (ctx.siteUrl || '') + '/contact')}</td>
    </tr></table></td></tr>
  <tr><td style="background:${NAVY};padding:0 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAGE};border-radius:22px 22px 0 0"><tr><td style="padding:0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td background="${img(c.hero_image)}" bgcolor="${SAGE}" style="background:${SAGE} url('${img(c.hero_image)}') center/cover no-repeat;height:400px;border-radius:22px 22px 0 0" align="center" valign="middle">
          <div class="big" style="font:900 72px/1 ${FONT};color:${NAVY};letter-spacing:-.03em;opacity:.92;text-shadow:0 2px 0 rgba(255,255,255,.35)">${P(c.hero_word)}</div></td></tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:30px 40px 10px;font:700 24px/1.25 ${FONT};color:${INK}">${P(c.headline)}</td></tr>
        <tr><td align="center" style="padding:0 48px 18px;font:15px/1.65 ${FONT};color:#24382d">${P(c.body).replace(/\n/g, '<br>')}</td></tr>
        ${gifts ? `<tr><td align="center" style="padding:0 40px 22px"><table role="presentation" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px"><tr><td style="padding:16px 26px"><table role="presentation" cellpadding="0" cellspacing="0">${gifts}</table></td></tr></table></td></tr>` : ''}
        <tr><td align="center" style="padding:0 0 34px">${pill(c.button_label, c.button_url, ACC, '#ffffff')}</td></tr>
        <tr><td align="center" style="padding:0 0 30px"><img src="${img(c.round_image)}" width="220" height="220" alt="" style="display:block;width:220px;height:220px;object-fit:cover;border-radius:50%;border:8px solid #ffffff;box-shadow:0 14px 30px rgba(0,0,0,.25)"></td></tr>
      </table></td></tr></table></td></tr>
  <tr><td style="background:${NAVY};padding:46px 46px 10px" align="center">
    <div style="font:800 24px/1.2 ${FONT};color:#ffffff;text-transform:uppercase;letter-spacing:.01em">${P(c.story_title)}</div>
    <div style="font:14px/1.7 ${FONT};color:#d6e2dc;margin-top:14px">${para(c.story_text, 'color:#d6e2dc')}</div></td></tr>
  <tr><td style="background:${NAVY};padding:10px 46px 0" align="center"><img src="${img(c.story_image)}" width="420" alt="" style="display:block;width:100%;max-width:420px;height:auto;border-radius:18px"></td></tr>
  <tr><td style="background:${NAVY};border-radius:0 0 28px 28px;padding:26px 22px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAGE};border-radius:22px"><tr><td align="center" style="padding:30px 36px 26px">
      <div style="font:800 22px ${FONT};color:${INK};text-transform:uppercase">${P(c.welcome_title)}</div>
      <div style="font:15px/1.65 ${FONT};color:#24382d;margin:12px 0 18px">${P(c.welcome_text).replace(/\n/g, '<br>')}</div>
      <div style="font:12px/1.6 ${FONT};color:#4e6157">${P(c.help_text).replace(/\n/g, '<br>')}</div>
    </td></tr></table></td></tr>`,
    { preheader: ctx.preheader, footer: footer() });
  }

  // editorial
  const NAVY = '#011D38';
  return wrap('#f4f2ee', `
  <tr><td style="background:${NAVY};border-radius:20px 20px 0 0;padding:30px 36px 34px">
    <img src="${logoLight}" width="110" alt="dé pitch" style="display:block;width:110px;height:auto;margin-bottom:28px">
    <div style="font:700 11px ${FONT};letter-spacing:.14em;color:#b8c7c2">${P(c.kicker)}</div>
    <div style="font:700 34px/1.15 Georgia,'Times New Roman',serif;color:#ffffff;margin:10px 0 14px">${P(c.headline)}</div>
    <div style="font:16px/1.6 ${FONT};color:#dfe6ea">${P(c.intro).replace(/\n/g, '<br>')}</div></td></tr>
  <tr><td style="background:#ffffff;padding:26px 26px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack"><tr>
    <td class="col" width="50%" valign="top" style="padding:0 7px 14px 0"><img src="${img(c.photo1)}" width="270" alt="" style="display:block;width:100%;height:auto;border-radius:12px"><div style="font:italic 13px Georgia,serif;color:#666;padding-top:8px">${P(c.caption1)}</div></td>
    <td class="col" width="50%" valign="top" style="padding:0 0 14px 7px"><img src="${img(c.photo2)}" width="270" alt="" style="display:block;width:100%;height:auto;border-radius:12px"><div style="font:italic 13px Georgia,serif;color:#666;padding-top:8px">${P(c.caption2)}</div></td>
  </tr></table></td></tr>
  <tr><td style="background:#ffffff;padding:10px 36px 6px"><div style="font:700 22px/1.3 Georgia,serif;color:#1a1a1a;margin-bottom:12px">${P(c.story_title)}</div><div style="font:16px/1.7 ${FONT};color:#333">${para(c.story_body)}</div></td></tr>
  ${c.quote ? `<tr><td style="background:#ffffff;padding:6px 36px 10px"><div style="border-left:3px solid ${NAVY};padding:6px 0 6px 18px"><div style="font:italic 20px/1.45 Georgia,serif;color:${NAVY}">“${P(c.quote)}”</div><div style="font:600 12px ${FONT};letter-spacing:.06em;text-transform:uppercase;color:#777;margin-top:8px">${P(c.quote_by)}</div></div></td></tr>` : ''}
  <tr><td style="background:#ffffff;border-radius:0 0 20px 20px;padding:20px 36px 36px">${pill(c.button_label, c.button_url, NAVY, '#ffffff')}</td></tr>`,
  { preheader: ctx.preheader, footer: footer() });
}
