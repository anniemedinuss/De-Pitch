// Outgoing email.
// - If RESEND_API_KEY is set (resend.com, free tier), emails go through Resend.
//   This is needed to email website visitors (points updates, chat replies).
// - Otherwise alerts to Dé Pitch's own inboxes go through FormSubmit, which
//   needs a one-time "Activate" click per receiving address.

const SITE = () => (process.env.SITE_URL || 'https://www.depitchhq.com').replace(/\/$/, '');
const FROM = () => process.env.MAIL_FROM || 'Dé Pitch <hello@depitchhq.com>';

export function canEmailVisitors() {
  return !!process.env.RESEND_API_KEY;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function layout(title, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f6f7;font-family:Arial,Helvetica,sans-serif;color:#0d0f12">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f7;padding:24px 0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
  <tr><td style="background:#011D38;padding:20px 28px"><img src="${SITE()}/assets/images/image01.png" alt="dé pitch" width="120" style="display:block"></td></tr>
  <tr><td style="padding:28px">
  <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3">${esc(title)}</h1>
  ${bodyHtml}
  </td></tr>
  <tr><td style="padding:16px 28px;background:#fafbfb;font-size:12px;color:#6b7178">Dé Pitch · office@depitchhq.com · <a href="${SITE()}" style="color:#6b7178">depitchhq.com</a></td></tr>
  </table></td></tr></table></body></html>`;
}

export async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [to], subject, html, text, reply_to: replyTo || undefined }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    return r.ok;
  } catch (e) {
    return false;
  }
}

// Alert one of Dé Pitch's own inboxes (People Ops or office@).
export async function notify(subject, fields, to) {
  if (process.env.NOTIFY_HR === 'off') return false;
  const inbox = to || process.env.NOTIFY_EMAIL || process.env.ADMIN_EMAIL || 'peopleops@depitchhq.com';
  const link = SITE() + '/portal';
  if (canEmailVisitors()) {
    const rows = Object.entries(fields).filter(([, v]) => v !== '' && v != null).map(([k, v]) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #e3e6e8;color:#6b7178;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #e3e6e8;white-space:pre-wrap">${esc(v)}</td></tr>`).join('');
    return sendEmail({
      to: inbox, subject: `Portal: ${subject}`,
      html: layout(subject, `<table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">${rows}</table>
        <p style="margin-top:20px"><a href="${link}" style="background:#011D38;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open the portal</a></p>`)
    });
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const r = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(inbox)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: SITE(), Origin: SITE() },
      body: JSON.stringify({ _subject: `Portal: ${subject}`, _template: 'table', _captcha: 'false', ...fields, 'Open the portal': link }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    return r.ok;
  } catch (e) {
    return false;
  }
}

export { esc as escapeHtml, SITE as siteUrl };
