// Auditoria de qualidade de site — fetch + regex, zero dependências.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

function platformOf(t) {
  if (/wixstatic|wix\.com|wixsite/i.test(t)) return 'wix';
  if (/wp-content|wp-includes|wordpress/i.test(t)) return 'wordpress';
  if (/squarespace/i.test(t)) return 'squarespace';
  if (/cdn\.shopify|shopify/i.test(t)) return 'shopify';
  if (/\bcanva\.com\b/i.test(t)) return 'builder';
  if (/godaddy|weebly|site123|jimdo/i.test(t)) return 'builder';
  return 'outro';
}

function auditSite(html, finalUrl) {
  const raw = String(html || '');
  const t = raw.slice(0, 400000);
  const https = /^https:/i.test(String(finalUrl || ''));
  const mobile = /<meta[^>]+name=["']viewport["']/i.test(t);
  const platform = platformOf(t);
  const cy = t.match(/(?:©|&copy;|copyright)[^0-9<]{0,24}((?:19|20)\d{2})/i);
  const copyright_year = cy ? parseInt(cy[1], 10) : null;
  const has_form = /<form[\s>]/i.test(t) || /mailto:/i.test(t);
  const has_booking = /agend|agendar|reserv|booking|schedul/i.test(t);
  const peso_kb = Math.round(Buffer.byteLength(raw, 'utf8') / 1024);
  const stale = !!copyright_year && new Date().getFullYear() - copyright_year >= 3;
  const ruim = !https || !mobile || stale || platform === 'builder';
  return { https, mobile, platform, copyright_year, has_form, has_booking, peso_kb, ruim };
}

async function auditUrl(rawUrl, { fetchImpl, timeoutMs = 8000 } = {}) {
  const f = fetchImpl || fetch;
  let url = String(rawUrl || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const res = await f(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) return null;
    return auditSite(await res.text(), res.url || url);
  } catch { return null; }
}

module.exports = { auditSite, auditUrl };
