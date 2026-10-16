// Detecção de anúncio ativo no Google Ads Transparency Center (público).
// FRÁGIL por natureza (página dinâmica): falha => null (= unknown), nunca false.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const EMPTY_RE = /nenhum an[úu]ncio|no ads|sem resultados|no results|nenhum resultado/i;
const CARD_RE = /\d+\s+an[úu]ncios?|ad creatives|an[úu]ncio(s)?\b/i;

function extractLanding(t) {
  const m = String(t || '').match(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=["'<\/\s])/i);
  return m ? m[1].toLowerCase() : null;
}

function parseAdsHtml(html) {
  const t = String(html || '');
  const empty = EMPTY_RE.test(t);
  const active = !empty && CARD_RE.test(t);
  return { active, landing: active ? extractLanding(t) : null };
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
