// "You just got X points" email. Table-based layout with inline styles so it
// renders the same in Gmail, Outlook and Apple Mail.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const n = (v) => Number(v || 0).toLocaleString('en-NG');

const INK = '#1a1a1a';
const GREY = '#6b6b6b';
const PAPER = '#f4f2ee';
const CARD = '#ffffff';
const ACCENT = '#f2df4a';
const NAVY = '#011D38';
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

function pill(label, href) {
  return `<a href="${href}" style="display:inline-block;background:${ACCENT};color:${INK};font:600 13px ${FONT};letter-spacing:.06em;text-transform:uppercase;text-decoration:none;padding:12px 26px;border-radius:999px">${esc(label)}</a>`;
}

function rewardCard(r, balance, img) {
  const ready = balance >= r.points;
  const status = ready
    ? `<span style="color:#1f7a4d;font-weight:700">Ready to redeem</span>`
    : `<span style="color:${GREY}">${n(r.points - balance)} points to go</span>`;
  return `<td width="50%" valign="top" style="padding:6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border-radius:18px;overflow:hidden">
      <tr><td style="padding:16px 16px 8px;font:700 15px ${FONT};color:${INK}">${esc(r.title)}</td></tr>
      <tr><td style="padding:0 16px 10px;font:13px/1.45 ${FONT};color:${GREY}">${esc(r.text)}</td></tr>
      <tr><td style="padding:0 12px"><img src="${img}" width="100%" alt="" style="display:block;width:100%;height:auto;border-radius:12px"></td></tr>
      <tr><td style="padding:12px 16px 4px;font:700 18px ${FONT};color:${INK}">${n(r.points)} pts</td></tr>
      <tr><td style="padding:0 16px 16px;font:12px ${FONT}">${status}</td></tr>
    </table></td>`;
}

export function pointsEmailHtml({ firstName, points, reason, balance, assetBase, siteLink, nairaPerPoint = 5 }) {
  const img = (f) => `${assetBase}/assets/images/email/${f}`;
  const cashPoints = Math.floor(balance / 1000) * 1000;
  const rewards = [
    { title: 'Interview preparation', text: 'A one-on-one mock interview with honest, practical feedback.', points: 1000, img: img('interview.jpg') },
    { title: 'Placement', text: 'We find, vet and place you in a role that fits.', points: 4000, img: img('placement.jpg') }
  ];
  const progress = Math.min(100, Math.round((balance / 4000) * 100));
  const cashLine = cashPoints >= 1000
    ? `You can cash out <b>${n(cashPoints)} points for ₦${n(cashPoints * nairaPerPoint)}</b> today.`
    : `Reach 1,000 points to cash out. You are ${n(1000 - balance)} points away.`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>You just got ${n(points)} points</title></head>
<body style="margin:0;padding:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden">You now have ${n(balance)} Dé Pitch points. See what they can get you.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">

  <!-- header -->
  <tr><td style="padding:6px 6px 14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle"><img src="${assetBase}/assets/images/image07.png" width="120" alt="dé pitch" style="display:block;width:120px;height:auto"></td>
      <td align="right" valign="middle" style="font:600 11px ${FONT};letter-spacing:.08em">
        <a href="${siteLink}" style="color:${INK};text-decoration:none;border:1px solid #d8d4cc;border-radius:999px;padding:8px 14px;display:inline-block">REWARDS</a>
        <a href="${siteLink}" style="color:${INK};text-decoration:none;border:1px solid #d8d4cc;border-radius:999px;padding:8px 14px;display:inline-block;margin-left:6px">SERVICES</a>
      </td></tr></table>
  </td></tr>

  <!-- hero -->
  <tr><td style="padding:0 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebe7e0;border-radius:24px;overflow:hidden">
      <tr><td align="center" style="padding:34px 28px 6px;font:800 52px/1.02 ${FONT};color:#5d5d5d;letter-spacing:-.02em">You just got<br>${n(points)} points</td></tr>
      <tr><td align="center" style="padding:12px 40px 4px;font:15px/1.55 ${FONT};color:${INK}">Hi ${esc(firstName)}, thank you for ${esc(reason)}. Your points are in, and every one of them can go towards your next move.</td></tr>
      <tr><td align="center" style="padding:18px 0 26px">${pill('See my points', siteLink)}</td></tr>
      <tr><td style="padding:0 18px 18px"><img src="${img('hero.jpg')}" width="100%" alt="" style="display:block;width:100%;height:auto;border-radius:18px"></td></tr>
    </table>
  </td></tr>

  <!-- balance -->
  <tr><td style="padding:14px 6px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border-radius:24px">
      <tr><td style="padding:26px 28px 6px;font:600 12px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${GREY}">Your points so far</td></tr>
      <tr><td style="padding:0 28px;font:800 44px/1.1 ${FONT};color:${INK};letter-spacing:-.02em">${n(balance)} <span style="font-size:18px;font-weight:600;color:${GREY}">points</span></td></tr>
      <tr><td style="padding:16px 28px 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eeeae3;border-radius:999px"><tr>
          <td width="${Math.max(progress, 2)}%" style="background:${ACCENT};border-radius:999px;height:10px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:4px 28px 24px;font:13px/1.5 ${FONT};color:${GREY}">${progress >= 100 ? 'You have enough for any reward.' : `${n(Math.max(0, 4000 - balance))} more points unlocks a full placement.`}</td></tr>
    </table>
  </td></tr>

  <!-- rewards -->
  <tr><td style="padding:22px 12px 4px;font:600 12px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${GREY}">Use your points on</td></tr>
  <tr><td style="padding:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${rewards.map((r) => rewardCard(r, balance, r.img)).join('')}
    </tr></table>
  </td></tr>

  <!-- cash back -->
  <tr><td style="padding:8px 6px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};border-radius:24px;overflow:hidden">
      <tr>
        <td valign="middle" style="padding:24px 10px 24px 26px;color:#fff">
          <div style="font:600 12px ${FONT};letter-spacing:.08em;text-transform:uppercase;opacity:.75">Prefer cash?</div>
          <div style="font:800 26px/1.15 ${FONT};margin:8px 0 8px">1,000 points = ₦${n(1000 * nairaPerPoint)}</div>
          <div style="font:14px/1.5 ${FONT};opacity:.9">${cashLine}</div>
        </td>
        <td width="150" valign="middle" style="padding:16px 16px 16px 0"><img src="${img('cash.jpg')}" width="134" alt="" style="display:block;width:134px;height:auto;border-radius:14px"></td>
      </tr>
    </table>
  </td></tr>

  <!-- how to redeem + keep earning -->
  <tr><td style="padding:14px 6px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border-radius:24px">
      <tr><td style="padding:24px 28px 8px;font:700 18px ${FONT};color:${INK}">Keep earning</td></tr>
      <tr><td style="padding:0 28px 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font:14px ${FONT};color:${INK}">
          <tr><td style="padding:9px 0;border-bottom:1px solid #eeeae3">Leave us a Google review</td><td align="right" style="padding:9px 0;border-bottom:1px solid #eeeae3;font-weight:700">50</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #eeeae3">Refer someone for a CV revamp</td><td align="right" style="padding:9px 0;border-bottom:1px solid #eeeae3;font-weight:700">300</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #eeeae3">Refer someone for interview prep</td><td align="right" style="padding:9px 0;border-bottom:1px solid #eeeae3;font-weight:700">600</td></tr>
          <tr><td style="padding:9px 0">Refer a company that hires through us</td><td align="right" style="padding:9px 0;font-weight:700">3,000</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:12px 28px 24px;font:13px/1.55 ${FONT};color:${GREY}">To check or redeem your points, open the chat button on our website, choose <b style="color:${INK}">Points &amp; rewards</b>, and enter your full name and this email address.</td></tr>
    </table>
  </td></tr>

  <!-- banner -->
  <tr><td style="padding:14px 6px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ACCENT};border-radius:24px;overflow:hidden">
      <tr><td><img src="${img('banner.jpg')}" width="100%" alt="" style="display:block;width:100%;height:auto"></td></tr>
      <tr><td align="center" style="padding:22px 24px 6px;font:800 24px/1.2 ${FONT};color:${INK}">Your next move, on us.</td></tr>
      <tr><td align="center" style="padding:0 24px 22px">${pill('Redeem my points', siteLink).replace(`background:${ACCENT}`, `background:${INK};color:#fff`).replace(`color:${INK};font`, 'color:#fff;font')}</td></tr>
    </table>
  </td></tr>

  <!-- footer -->
  <tr><td align="center" style="padding:22px 20px 8px;font:12px/1.6 ${FONT};color:${GREY}">Dé Pitch · office@depitchhq.com<br>You are receiving this because you joined Dé Pitch rewards. Reply to this email with any questions.</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
