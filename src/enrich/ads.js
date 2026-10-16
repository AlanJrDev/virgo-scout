// Detecção de anúncio ativo no Google Ads Transparency Center (público).
// FRÁGIL por natureza (página dinâmica): falha => null (= unknown), nunca false.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const EMPTY_RE = /nenhum an[úu]ncio|no ads|sem resultados|no results|nenhum resultado|n[ãa]o encontramos/i;
const CARD_RE = /\b(\d{1,3})\s+an[úu]ncios?\b/i;
const AD_CREATIVES = 'ad creatives';

function extractLanding(t) {
  const m = String(t || '').match(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=["'<\/\s])/i);
  return m ? m[1].toLowerCase() : null;
}

function parseAdsHtml(html) {
  const t = String(html || '');
  let idx = -1;
  let len = 0;
  const card = t.match(CARD_RE);
  if (card) { idx = card.index; len = card[0].length; }
  else {
    const i = t.indexOf(AD_CREATIVES);
    if (i === -1) return EMPTY_RE.test(t) ? { active: false, landing: null } : null;
    idx = i; len = AD_CREATIVES.length;
  }
  const start = Math.max(0, idx - 200);
  const window = t.slice(start, idx + len + 200);
  return { active: true, landing: extractLanding(window) };
}

async function checkAds(query, { fetchImpl, timeoutMs = 10000 } = {}) {
  const f = fetchImpl || fetch;
  const q = String(query || '').trim();
  if (!q) return null;
  const url = 'https://adstransparency.google.com/?region=BR&query=' + encodeURIComponent(q);
  try {
    const res = await f(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) return null;
    return parseAdsHtml(await res.text());
  } catch { return null; }
}

module.exports = { parseAdsHtml, checkAds, extractLanding };
