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

// Candidatos a página interna de contato a partir dos href da homepage (decisão C):
// keyword no valor do href, exclusões cirúrgicas 1-7, cap 2, profundidade 1.
const CONTACT_RE = /contato|fale|atendimento|whatsapp|contact|or[cç]ament|budget|agendament|\bsac\b/i;

function contactCandidates(html, base) {
  const out = [];
  const norm = (u) => String(u).replace(/\/+$/, '').toLowerCase();
  let baseOrigin = '';
  try { baseOrigin = new URL(base).origin; } catch { return out; }
  const seen = new Set([norm(base)]); // base já sai do pool (exclusão 4)
  const hrefs = [];
  const text = String(html || '').slice(0, 400000);
  for (const m of text.matchAll(/href\s*=\s*"([^"]*)"/gi)) hrefs.push(m[1]);
  for (const m of text.matchAll(/href\s*=\s*'([^']*)'/gi)) hrefs.push(m[1]);
  for (const raw of hrefs) {
    if (out.length >= 2) break;                                       // cap 2 (decisão C)
    const v = raw.replace(/&amp;/gi, '&');                            // mesmo decode do findWaLink
    if (/wa\.me|whatsapp/i.test(v)) continue;                         // (6) link de wa não é candidato
    let u;
    try { u = new URL(v, base); } catch { continue; }                 // (1) mailto:/tel:/javascript:
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;  // (2) dupla garantia
    if (u.hash) continue;                                             // (3) âncora interna
    if (u.origin !== baseOrigin) continue;                            // (7) fora do domínio
    if (seen.has(norm(u.href))) continue;                             // (4) dedupe/igual à base
    if (!CONTACT_RE.test(v)) continue;                                // (5) keyword no valor do href
    seen.add(norm(u.href));
    out.push(u.href);
  }
  return out;
}

// v2 (Fase 1): home + visitas internas de contato (cap 2, budget por domínio).
// Zap só de href declarado; wa_evidence_url = URL da página onde o zap foi achado.
async function analyzeSite(rawUrl, { fetchImpl, timeoutMs = 6000, budgetMs = 12000 } = {}) {
  const f = fetchImpl || fetch;
  let url = String(rawUrl || '').trim();
  if (!url) return { ok: false, status: 0, final_url: null, ...sansWa() };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const t0 = Date.now();
  const cfg = { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', Accept: 'text/html' } };
  let res;
  try {
    res = await f(url, { ...cfg, signal: AbortSignal.timeout(timeoutMs) });
  } catch { return { ok: false, status: 0, final_url: null, ...sansWa() }; }
  const final_url = res.url || url;
  if (!res.ok) return { ok: false, status: res.status, final_url, ...sansWa() };
  let html;
  try {
    html = await res.text();
  } catch { return { ok: false, status: res.status, final_url, ...sansWa() }; } // text() falhou pós-ok: chamadores não capturam
  const sig = extractSignals(html);
  const out = { ok: true, status: res.status, final_url, ...sig, wa_evidence_url: null, pages_visited: 0 };
  if (sig.whatsapp) return out;                              // home declarou zap → zero visitas (decisão D)
  for (const cand of contactCandidates(html, final_url)) {   // cap 2, profundidade 1 (decisão C)
    const restante = budgetMs - (Date.now() - t0);
    if (restante - 2000 < 800) break;                        // reserva 2s + mínimo útil 800ms (decisão D)
    let sub;
    try {
      const r2 = await f(cand, { ...cfg, signal: AbortSignal.timeout(Math.min(4000, restante)) });
      if (!r2.ok) continue;                                  // candidato ruim → próximo (decisão D)
      sub = await r2.text();
    } catch { continue; }
    out.pages_visited++;
    const subSig = extractSignals(sub);
    for (const k of ['email', 'instagram', 'facebook', 'since_year', 'title']) {
      if (out[k] == null && subSig[k] != null) out[k] = subSig[k]; // fill-if-null: home mantém prioridade (decisão E)
    }
    out.whatsapp_hint = !!out.whatsapp_hint || !!subSig.whatsapp_hint; // hint = OR acumulado (decisão E)
    if (subSig.whatsapp) {
      out.whatsapp = subSig.whatsapp;
      out.wa_evidence_url = cand;                            // string fetchada, antes de redirect (decisão E)
      break;                                                 // primeira página com zap encerra o loop
    }
  }
  return out;
}
function empty() { return { email: null, instagram: null, facebook: null, whatsapp: null, since_year: null, title: null }; }
// Shape ok:false com os campos novos zerados (decisão F)
function sansWa() { return { ...empty(), whatsapp_hint: false, wa_evidence_url: null, pages_visited: 0 }; }
module.exports = { analyzeSite, extractSignals };
