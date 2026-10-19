// Análise de sites de leads — fetch + regex, zero dependências.
const BAD_EMAIL = /(sentry|example|wixpress|godaddy|@2x|\.png|\.jpg|\.webp|no-?reply|domain\.com)/i;

// Link DECLARADO de WhatsApp: só o que está em atributo href (não vale texto corrido — vira hint).
function findWaLink(html) {
  const text = String(html || '').slice(0, 400000);
  const hrefs = [];
  for (const m of text.matchAll(/href\s*=\s*"([^"]*)"/gi)) hrefs.push(m[1]);
  for (const m of text.matchAll(/href\s*=\s*'([^']*)'/gi)) hrefs.push(m[1]);
  for (const raw of hrefs) {
    const v = raw.replace(/&amp;/gi, '&'); // decode da entidade HTML (&amp;phone=X sem decode jamais casa [?&]phone=)
    const m = v.match(/wa\.me\/\+?(\d{6,15})/) || v.match(/api\.whatsapp\.com[^"'\s]*[?&]phone=(\d{6,15})/);
    if (m) return m[1];
  }
  return null;
}
// Presença de padrão wa em qualquer texto da página (sem exigir atributo) — sinal fraco, só hint.
function waHint(html) {
  const text = String(html || '').slice(0, 400000);
  return /wa\.me\/\+?\d{6,15}/.test(text) || /api\.whatsapp\.com[^"'\s]*[?&]phone=\d{6,15}/.test(text);
}

function extractSignals(html) {
  const text = String(html || '').slice(0, 400000);
  let email = null;
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    if (!BAD_EMAIL.test(m[0])) { email = m[0].toLowerCase(); break; }
  }
  let instagram = null, facebook = null;
  for (const m of text.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,40})/g)) {
    if (!/^(p|reel|reels|explore|stories|accounts)$/i.test(m[1])) { instagram = m[1]; break; }
  }
  for (const m of text.matchAll(/facebook\.com\/([A-Za-z0-9.-]{2,60})/g)) {
    if (!/^(sharer|share|tr|plugins|policies)(\.php)?$/i.test(m[1])) { facebook = m[1]; break; }
  }
  const whatsapp = findWaLink(html);
  const whatsapp_hint = waHint(html);
  let since_year = null;
  const cy = text.match(/(?:©|&copy;|copyright)[^0-9<]{0,24}((?:19|20)\d{2})/i) || text.match(/desde\s+((?:19|20)\d{2})/i) || text.match(/fundad[ao]\s+em\s+((?:19|20)\d{2})/i);
  if (cy) since_year = parseInt(cy[1], 10);
  const title = (text.match(/<title[^>]*>([^<]{0,140})/i) || [])[1]?.trim() || null;
  return { email, instagram, facebook, whatsapp, whatsapp_hint, since_year, title };
}

async function analyzeSite(rawUrl, { fetchImpl, timeoutMs = 6000 } = {}) {
  const f = fetchImpl || fetch;
  let url = String(rawUrl || '').trim();
  if (!url) return { ok: false, status: 0, final_url: null, email: null, instagram: null, facebook: null, whatsapp: null, since_year: null, title: null };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const res = await f(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', Accept: 'text/html' } });
    const final_url = res.url || url;
    if (!res.ok) return { ok: false, status: res.status, final_url, ...empty() };
    const html = await res.text();
    return { ok: true, status: res.status, final_url, ...extractSignals(html) };
  } catch { return { ok: false, status: 0, final_url: null, ...empty() }; }
}
function empty() { return { email: null, instagram: null, facebook: null, whatsapp: null, since_year: null, title: null }; }
module.exports = { analyzeSite, extractSignals };
