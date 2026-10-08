// The Scoop: server-rendered blog pages (list, post, sitemap) inside the site's header and footer.
import { SHELL } from './blog-shell.js';

export const CATEGORIES = [
  { key: 'signs', label: 'Signs & red flags' },
  { key: 'culture', label: 'Work culture' },
  { key: 'people', label: 'People & stories' },
  { key: 'trends', label: 'Data & trends' },
  { key: 'employers', label: 'For employers' },
  { key: 'series', label: 'Series' }
];
export const CTAS = {
  consultation: { label: 'Book a free consultation', href: '/free-consultation' },
  cv: { label: 'Get your CV revamped', href: '/cv-revamp' },
  interview: { label: 'Book interview prep', href: '/interview-prep' },
  recruitment: { label: 'Hire with Dé Pitch', href: '/recruitment' },
  hcm: { label: 'Talk to us about HR', href: '/enterprise' },
  contact: { label: 'Talk to us', href: '/contact' }
};
// Recruitment and human capital are paused for now: posts using those buttons fall back to
// the free consultation, and the pages stay out of the sitemap. Empty this list to bring them back.
export const PAUSED_CTAS = ['recruitment', 'hcm'];
const PAUSED_PAGES = ['/recruitment', '/enterprise'];
const catLabel = (k) => (CATEGORIES.find((c) => c.key === k) || { label: 'The Scoop' }).label;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/₦/g, 'n').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
export function imageUrl(v, base = '') {
  v = String(v || '').trim();
  if (/^file:\d+$/.test(v)) return `${base}/api/portal?img=${v.slice(5)}`;
  if (/^https:\/\//.test(v)) return v;
  if (/^[a-z0-9-]+$/.test(v)) return `${base}/assets/images/email/${v}.jpg`;
  return `${base}/assets/images/share.jpg`;
}
export function readingMinutes(body) { return Math.max(1, Math.round(String(body || '').split(/\s+/).filter(Boolean).length / 220)); }
const fmtDate = (d) => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }); };

// A small, safe Markdown subset: ## headings, paragraphs, **bold**, *italic*, [links](url), lists, > quotes, ![images](src).
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:)[^)\s]+)\)/g, (m, t, u) => `<a href="${u}"${/^https?:/.test(u) && !/depitchhq\.com/.test(u) ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`);
}
export function renderMarkdown(md, base = '') {
  const blocks = String(md || '').replace(/\r/g, '').split(/\n\s*\n/);
  const toc = [];
  const html = blocks.map((b) => {
    const t = b.trim();
    if (!t) return '';
    let m;
    if ((m = t.match(/^(#{2,3})\s+(.+)$/))) {
      const id = slugify(m[2]);
      if (m[1].length === 2) toc.push({ id, text: m[2] });
      return `<h${m[1].length} id="${id}">${inline(m[2])}</h${m[1].length}>`;
    }
    if ((m = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) return `<figure><img src="${esc(imageUrl(m[2], base))}" alt="${esc(m[1])}" loading="lazy">${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ''}</figure>`;
    const lines = t.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('') + '</ul>';
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return '<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('') + '</ol>';
    if (lines.every((l) => /^>\s?/.test(l))) return `<blockquote>${lines.map((l) => inline(l.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
  return { html, toc };
}

function page({ title, description, canonical, image, type = 'website', jsonld = [], main, noindex }) {
  const head = `<title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  ${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="Dé Pitch">
  <meta name="twitter:card" content="summary_large_image">
  ${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n  ')}`;
  return SHELL.replace('{{HEAD}}', head).replace('{{MAIN}}', main);
}

const newsletter = (title = 'Get The Scoop in your inbox', text = 'New stories on work, money and life, plus a welcome gift: a free career consultation and 20 Dé Pitch points.') => `
  <section class="wrap block"><div class="solid black center stack scoop-news">
    <p class="eyebrow">The Scoop</p><h2 class="h-lg">${esc(title)}</h2><p class="lead" style="margin:.6rem auto 0">${esc(text)}</p>
    <form class="form inline" data-form="Scoop newsletter" data-success="newsletterreceived" method="POST" style="margin-top:1.4rem">
      <input type="text" name="_honey" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <input type="text" name="name" placeholder="Name" maxlength="128" required aria-label="Name">
      <input type="email" name="email" placeholder="Email" maxlength="128" required aria-label="Email">
      <button type="submit" class="btn btn-light">Subscribe</button>
    </form></div></section>`;

function card(p, base, big) {
  return `<a class="post-card${big ? ' big' : ''}" href="/scoop/${esc(p.slug)}">
    <div class="post-img"><img src="${esc(imageUrl(p.cover))}" alt="${esc(p.cover_alt || p.title)}" loading="lazy"></div>
    <div class="post-meta"><span>${esc(catLabel(p.category))}</span><span>${readingMinutes(p.body)} min read</span></div>
    <h${big ? 2 : 3}>${esc(p.title)}</h${big ? 2 : 3}>
    <p>${esc(p.excerpt)}</p></a>`;
}

export function renderIndex(posts, { base, category }) {
  const list = category ? posts.filter((p) => p.category === category) : posts;
  const chips = `<nav class="scoop-cats" aria-label="Topics"><a href="/scoop" class="${category ? '' : 'on'}">All</a>${CATEGORIES.filter((c) => posts.some((p) => p.category === c.key)).map((c) => `<a href="/scoop?category=${c.key}" class="${category === c.key ? 'on' : ''}">${esc(c.label)}</a>`).join('')}</nav>`;
  const main = `<main class="page-main" data-page="blog">
  <section class="wrap block scoop-head"><p class="eyebrow">The Scoop</p><h1 class="h-xl">Work, life and everything in between.</h1>
    <p class="lead">Honest stories and sharp takes on careers, money and work culture in Nigeria and beyond.</p>${posts.length ? chips : ''}</section>
  <section class="wrap block">${list.length ? `<div class="post-grid">${list.map((p, i) => card(p, base, i === 0 && !category)).join('')}</div>`
    : '<p class="lead scoop-empty">New stories are on the way. Join the list below and we’ll send them to you first.</p>'}</section>
  ${newsletter()}
</main>`;
  const url = `${base}/scoop${category ? '?category=' + category : ''}`;
  return page({
    title: category ? `${catLabel(category)} | The Scoop | Dé Pitch` : 'The Scoop: work, careers and culture | Dé Pitch',
    description: 'The Scoop by Dé Pitch: honest stories and sharp takes on careers, money, hiring and work culture in Nigeria.',
    canonical: url, image: `${base}/assets/images/share.jpg`,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'Blog', name: 'The Scoop by Dé Pitch', url: `${base}/scoop`,
      publisher: { '@type': 'Organization', name: 'Dé Pitch', logo: { '@type': 'ImageObject', url: `${base}/assets/images/image07.png` } },
      blogPost: list.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${base}/scoop/${p.slug}`, datePublished: p.published_at })) }],
    main
  });
}

export function renderPost(p, { base, related = [], preview = false }) {
  const { html, toc } = renderMarkdown(p.body);
  const faq = (Array.isArray(p.faq) ? p.faq : []).filter((x) => x && x.q && x.a);
  const cta = (!PAUSED_CTAS.includes(p.cta) && CTAS[p.cta]) || CTAS.consultation;
  const url = `${base}/scoop/${p.slug}`;
  const img = imageUrl(p.cover, base);
  const desc = p.seo_description || p.excerpt || '';
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: desc, image: [img], url, mainEntityOfPage: url,
      datePublished: p.published_at || p.created_at, dateModified: p.updated_at || p.published_at,
      author: { '@type': p.author_type === 'org' ? 'Organization' : 'Person', name: p.author || 'Dé Pitch', ...(p.author_role ? { jobTitle: p.author_role } : {}) },
      publisher: { '@type': 'Organization', name: 'Dé Pitch', url: base, logo: { '@type': 'ImageObject', url: `${base}/assets/images/image07.png` } },
      articleSection: catLabel(p.category), inLanguage: 'en-NG', wordCount: String(p.body || '').split(/\s+/).length },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' },
      { '@type': 'ListItem', position: 2, name: 'The Scoop', item: base + '/scoop' },
      { '@type': 'ListItem', position: 3, name: p.title, item: url }] }
  ];
  if (faq.length) jsonld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) });
  const main = `<main class="page-main" data-page="blog">
  <article class="post">
    <header class="wrap post-head">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/scoop">The Scoop</a> <span>/</span> <a href="/scoop?category=${esc(p.category)}">${esc(catLabel(p.category))}</a></nav>
      <h1>${esc(p.title)}</h1>
      ${p.excerpt ? `<p class="post-dek">${esc(p.excerpt)}</p>` : ''}
      <div class="post-byline"><span><b>${esc(p.author || 'Dé Pitch')}</b>${p.author_role ? ' · ' + esc(p.author_role) : ''}</span><span>${esc(fmtDate(p.published_at || p.updated_at))}</span><span>${readingMinutes(p.body)} min read</span></div>
    </header>
    <figure class="wrap post-cover"><img src="${esc(imageUrl(p.cover))}" alt="${esc(p.cover_alt || p.title)}"></figure>
    <div class="wrap post-layout">
      ${toc.length > 2 ? `<aside class="post-toc"><p class="eyebrow">In this story</p><ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></aside>` : '<aside class="post-toc"></aside>'}
      <div class="post-body">
        ${html}
        <div class="post-bridge"><p>${esc(p.bridge || 'Every career needs a different next move. That is what we work through, one to one, in a free consultation.').replace(/\n/g, '<br>')}</p>
          <a class="btn btn-dark" href="${cta.href}">${esc(p.cta_label || cta.label)}</a></div>
        ${faq.length ? `<section class="post-faq"><h2 id="questions">Questions people ask</h2>${faq.map((x) => `<details><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('')}</section>` : ''}
        <div class="post-share"><span>Share:</span>
          <a href="https://wa.me/?text=${encodeURIComponent(p.title + ' ' + url)}" target="_blank" rel="noopener">WhatsApp</a>
          <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">LinkedIn</a>
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(p.title)}&url=${encodeURIComponent(url)}" target="_blank" rel="noopener">X</a></div>
      </div>
    </div>
  </article>
  ${related.length ? `<section class="wrap block"><h2 class="h-lg" style="margin-bottom:18px">Keep reading</h2><div class="post-grid three">${related.map((r) => card(r, base)).join('')}</div></section>` : ''}
  ${newsletter()}
</main>`;
  return page({ title: (p.seo_title || p.title) + ' | Dé Pitch', description: desc, canonical: url, image: img, type: 'article', jsonld, main, noindex: preview || p.status !== 'published' });
}

export function renderNotFound(base) {
  return page({ title: 'Story not found | Dé Pitch', description: 'This story is not available.', canonical: base + '/scoop', image: base + '/assets/images/share.jpg', noindex: true,
    main: `<main class="page-main"><section class="wrap block scoop-head"><p class="eyebrow">The Scoop</p><h1 class="h-xl">We couldn’t find that story.</h1><p class="lead">It may have moved. <a href="/scoop">See all stories</a>.</p></section></main>` });
}

export function renderSitemap(base, posts) {
  const pages = ['/', '/about', '/cv-revamp', '/interview-prep', '/recruitment', '/enterprise', '/free-consultation', '/contact', '/scoop', '/privacy-policy', '/terms', '/refund-policy', '/cookie-policy'].filter((u) => !PAUSED_PAGES.includes(u));
  const urls = pages.map((u) => `<url><loc>${base}${u === '/' ? '/' : u}</loc></url>`)
    .concat(posts.map((p) => `<url><loc>${base}/scoop/${esc(p.slug)}</loc><lastmod>${String(p.updated_at || p.published_at).slice(0, 10)}</lastmod></url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${urls.join('\n  ')}\n</urlset>\n`;
}
