/* Parser de captura local e determinístico (SEM Groq, sem deps de dotenv/rede).
   Decisões documentadas:
   - Categoria: keywords por nicho = terms OFICIAIS de categories.js + micro-dicionário
     extra. Regra: vence o match MAIS CEDO no prompt; empate de posição → keyword mais
     longa; empate total → termo oficial (adicionado antes do extra).
     Keywords usam prefixo de palavra (plural entra grátis: 'sofas', 'estofados').
   - df:true só com expressão EXPLÍCITA de DF inteiro ('df', 'distrito federal',
     'df inteiro', 'todo o df', 'df todo', 'brasilia inteira', 'todas as cidades').
     'brasília' como palavra = RA Brasília — NÃO contamina df:true.
   - RAs em DUAS passadas sobre o texto normalizado (raName):
     (a) word-boundary para cada RA e ALIAS de df-ra.js — plural aceito ('s'), chaves
         mais longas primeiro com faixa ocupada (senão 'riacho fundo' comeria
         'riacho fundo ii'); coleta TODAS as ocorrências em ordem, dedupe por RA.
     (b) SEM espaços, SÓ para nomes MULTI-palavra (contêm espaço no original):
         substring no prompt sem espaços ou levenshtein ≤ 2 (janela local, strings
         ≤ 40 chars) — resolve 'aguasclaras' e 'planopilkoto'. Nomes de UMA palavra
         ficam de fora da passada (b), senão 'sia' casaria dentro de 'persianas'.
     Saída de ras = ordem de aparição real (intervalos das 2 passadas mesclados). */
const { RAS, ALIAS, buildPlan, raName } = require('./df-ra');
const { CATEGORIES, CAT_KEYS, termsOfCategory } = require('./categories');

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* micro-dicionário local → tag (Groq vira fallback, nunca fonte única) */
const EXTRA_KEYWORDS = {
  advogados: ['direito', 'juridico', 'oab'],
  arquitetura: ['urbanismo'],
  tapecaria: ['tapete', 'carpete'],
  estofado: ['estofado', 'sofa', 'poltrona', 'colchao', 'colchoes'],
  topografia: ['levantamento', 'georref'],
};

/* pares [keyword normalizada, tag] — termos oficiais PRIMEIRO (desempate estável) */
const KW_PAIRS = [];
const kwSeen = new Set();
for (const tag of CAT_KEYS) {
  for (const t of termsOfCategory(tag)) {
    const kw = norm(t);
    if (kw && !kwSeen.has(kw)) { kwSeen.add(kw); KW_PAIRS.push([kw, tag]); }
  }
}
for (const tag of CAT_KEYS) {
  for (const extra of EXTRA_KEYWORDS[tag] || []) {
    const kw = norm(extra);
    if (kw && !kwSeen.has(kw)) { kwSeen.add(kw); KW_PAIRS.push([kw, tag]); }
  }
}

/* chaves de RA/alias normalizadas, mais longas primeiro (faixa ocupada) */
const RA_KEYS = [];
for (const r of RAS) RA_KEYS.push({ kw: raName(r), ra: r });
for (const [alias, ra] of ALIAS) {
  const kw = raName(alias);
  if (!RA_KEYS.some((k) => k.kw === kw && k.ra === ra)) RA_KEYS.push({ kw, ra });
}
RA_KEYS.sort((a, b) => b.kw.length - a.kw.length);

/* levenshtein limitado (strings ≤ 40 chars, early-exit acima de max) */
function levWithin(a, b, max) {
  if (a.length > 40 || b.length > 40 || Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const EMPTY = () => ({ category: null, label: null, ras: [], df: false, matched: [] });
const DF_RE = /(^|[^\p{L}])df([^\p{L}]|$)|distrito federal|df inteiro|todo o df|df todo|brasilia inteira|todas as cidades/u;

/* intervalos [start,end) que ainda não foram ocupados */
function free(intervals, s, e) {
  return !intervals.some(([a, b]) => s < b && a < e);
}

function parseCapturePrompt(text) {
  const arp = raName(text);
  if (!arp) return EMPTY();
  const out = EMPTY();

  /* 1) categoria — match mais cedo; empate → keyword mais longa */
  let best = null;
  for (const [kw, tag] of KW_PAIRS) {
    const m = new RegExp(`(^|[^\\p{L}])${escapeRe(kw)}`, 'u').exec(arp);
    if (!m) continue;
    const idx = m.index + m[1].length;
    if (!best || idx < best.idx || (idx === best.idx && kw.length > best.kw.length)) {
      best = { idx, kw, tag };
    }
  }
  if (best) {
    out.category = best.tag;
    out.label = CATEGORIES[best.tag].label;
    const word = arp.slice(best.idx).split(/[^a-z0-9/]+/)[0] || arp.slice(best.idx, best.idx + best.kw.length);
    out.matched.push({ term: word, ra: null });
  } /* sem nicho: ras/df seguem preenchidos (útil p/ debug e CLI), matched só com RAs */

  /* 2) RAs — passada (a): word-boundary, todas as ocorrências */
  const intervals = [];
  const hits = [];
  for (const k of RA_KEYS) {
    const re = new RegExp(`(^|[^\\p{L}])${escapeRe(k.kw)}(s)?([^\\p{L}]|$)`, 'gu');
    let m;
    while ((m = re.exec(arp))) {
      const start = m.index + m[1].length;
      const end = m.index + m[0].length;
      if (free(intervals, start, end)) {
        intervals.push([start, end]);
        /* core = kw + plural ('s') — m[3] é delimitador final, NÃO entra no termo */
        const coreLen = k.kw.length + (m[2] || '').length;
        hits.push({ start, end: start + coreLen, ra: k.ra, term: arp.slice(start, start + coreLen) });
      }
    }
  }

  /* 3) passada (b): sem espaços, só nomes multi-palavra — substring exata primeiro
     (senão match shiftado com dist 1 rouba a janela); depois fuzzy com tolerância
     proporcional ao comprimento: kk ≥ 16 → lev ≤ 2, senão lev ≤ 1 (senão 'asanorte'
     casaria 'manorte' com dist 2). Nomes de UMA palavra ficam DE FORA — senão 'sia'
     casaria dentro de 'persianas'. */
  const nsChars = [];
  const nsAt = []; /* nsPos[i] = posição do i-ésimo char sem espaço no prompt original */
  for (let i = 0; i < arp.length; i++) {
    if (!/\s/.test(arp[i])) { nsChars.push(arp[i]); nsAt.push(i); }
  }
  const ns = nsChars.join('');
  const raFound = new Set(hits.map((h) => h.ra)); // já achados na passada (a)
  const nsHits = [];
  for (const k of RA_KEYS) {
    if (!k.kw.includes(' ') || raFound.has(k.ra)) continue;
    const kk = k.kw.replace(/\s+/g, '');
    const maxDist = kk.length >= 16 ? 2 : 1;
    if (kk.length > ns.length) continue;
    let cand = null; /* {s, wl, d} — vence MENOR d, depois posição mais cedo */
    for (let s = 0; s + 1 <= ns.length; s++) {
      for (const wl of [kk.length, kk.length + 1, kk.length - 1]) {
        if (s + wl > ns.length) continue;
        const win = ns.slice(s, s + wl);
        const d = win === kk ? 0 : levWithin(win, kk, maxDist);
        if (d > maxDist) continue;
        if (cand && (d > cand.d || (d === cand.d && s >= cand.s))) continue;
        const start = nsAt[s];
        const end = nsAt[Math.min(s + wl, ns.length) - 1] + 1;
        if (!free(intervals, start, end)) continue;
        cand = { s, wl, d, start, end };
        if (d === 0) break;
      }
      if (cand && cand.d === 0) break;
    }
    if (cand) {
      intervals.push([cand.start, cand.end]);
      raFound.add(k.ra);
      nsHits.push({ start: cand.start, end: cand.end, ra: k.ra, term: arp.slice(cand.start, cand.end) });
    }
  }

  /* 4) merge: ordem de aparição, matches mais longos vencem empate de posição */
  hits.push(...nsHits);
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const taken = [];
  for (const h of hits) {
    if (!free(taken, h.start, h.end) || out.ras.includes(h.ra)) continue;
    taken.push([h.start, h.end]);
    out.ras.push(h.ra);
    out.matched.push({ term: h.term, ra: h.ra });
  }

  /* 5) df explícito — 'brasília' solta é RA, nunca df */
  out.df = DF_RE.test(arp);
  return out;
}

/* plano de queries a partir do parse: df → DF inteiro; senão pares por RA em ordem
   de aparição (dedupe por query); sem RA e sem df → DF inteiro (comportamento atual) */
function planFor(category, parsed) {
  const term = (CATEGORIES[category] || CATEGORIES.advogados).label.toLowerCase();
  if (parsed.df || !(parsed.ras && parsed.ras.length)) {
    return { term, plan: buildPlan(term), place: 'DF', placeType: 'df' };
  }
  const seen = new Set();
  const plan = [];
  for (const ra of parsed.ras) {
    for (const pair of buildPlan(term, { ra })) {
      if (seen.has(pair.query)) continue;
      seen.add(pair.query);
      plan.push(pair);
    }
  }
  return {
    term, plan,
    place: parsed.ras.join(', '),
    placeType: parsed.ras.length === 1 ? 'ra' : 'multi',
  };
}

module.exports = { parseCapturePrompt, planFor };
