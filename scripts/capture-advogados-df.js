/* Runner central do Capture V2 — todas as categorias passam por aqui
   (capture-topografia/arquitetura/tapecaria/estofado só fixam env e chamam main).
   Fases: plano multi-RA (buildPlan) → budget/hrtime → 1ª passada (scrapeMany c/
   deadline) → 2ª passada nos low-yield (novos termos na mesma RA) → dedupe →
   gate de relevância final → save + sidecar data/<basename>-meta.json → sync. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { scrapeMany, DEADLINE_MARGIN_MS } = require('../src/scraper/mapsScraper');
const { dedupeLeads } = require('../src/utils/leads');
const { saveLeads } = require('../src/utils/spreadsheet');
const { sbEnabled, sbFetchAll } = require('../src/utils/sb');
const { syncLeads } = require('./sync-supabase');
const { CATEGORIES, CAT_KEYS, rootsFor, termsOfCategory, relevanceFilter, relevanceScore } = require('../src/utils/categories');
const { buildPlan, findRA } = require('../src/utils/df-ra');
const { defaultBudgetMinutes, orderPlan, lowYieldRAs, freshPlaceIds } = require('../src/utils/capture-plan');
const { normalizeName } = require('../src/utils/queue-util');

async function main() {
  const category = process.env.CAPTURE_CATEGORY || 'advogados';
  // guarda: categoria sem registro/sem raízes de relevância = captura não confiável
  // (todos os cards viram "match" sem category no gate) → aborta antes de gastar
  if (!CATEGORIES[category] || !rootsFor(category)) {
    throw new Error(`[capture] CAPTURE_CATEGORY="${category}" inválida ou sem raízes de relevância — abortando. Válidas: ${CAT_KEYS.join(', ')}`);
  }
  const tag = category;
  const startedAt = new Date().toISOString();
  const stamp = startedAt.slice(0, 10);
  const basename = process.env.BASENAME || `${tag}-df-${stamp}`;
  const explicit = process.env.QUERIES ? process.env.QUERIES.split('|').map((s) => s.trim()).filter(Boolean) : null;
  const maxDetails = parseInt(process.env.MAX_DETAILS || '80', 10);
  const maxScrolls = parseInt(process.env.MAX_SCROLLS || '40', 10);
  const budgetMinEnv = parseFloat(process.env.BUDGET_MIN || process.env.CAPTURE_BUDGET || '') || 0;
  // cap opcional de leads surfados na rodada (0/off = sem limite)
  const capSurfaced = parseInt(process.env.BASE_MAX_SURFACED || '', 10) || 0;
  const t0h = process.hrtime.bigint();

  // fila: strings explícitas do serve-web OU plano multi-RA com o termo principal
  let plan;
  if (explicit) {
    plan = explicit.map((q) => ({ ra: (findRA(q) || {}).ra || null, query: q, _explicit: true }));
  } else {
    plan = buildPlan(termsOfCategory(tag)[0]);
  }
  if (!plan.length) throw new Error('[capture] fila de captura vazia (QUERIES vazia?)');
  const budget = budgetMinEnv || defaultBudgetMinutes(plan.length);
  const deadline = Date.now() + budget * 60000;

  // histórico: yield da última meta do nicho (ordena a fila, boost = yield desc)
  let history = [];
  try {
    const h = JSON.parse(fs.readFileSync(path.join('data', `${tag}-df-max-meta.json`), 'utf8'));
    if (Array.isArray(h.qs)) history = h.qs.map((r) => ({ query: r.query, relevant: r.relevant || 0 }));
  } catch (e) { /* primeira rodada: sem histórico (ordem natural) */ }

  // recaptura incremental: leads frescos da base (≤30d) não recebem detail de novo.
  // Cards da fase 1 NÃO têm place_id — o skip EFETIVO é por NOME normalizado;
  // place_id cobre re-runs futuros com rows que já passaram pelo detail.
  let skipPlaceIds = new Set();
  let skipNames = new Set();
  if (sbEnabled()) {
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const rows = await sbFetchAll(`leads?select=place_id,name&source=eq.${encodeURIComponent(tag)}&updated_at=gte.${since}`);
      skipPlaceIds = freshPlaceIds(rows);
      skipNames = new Set((rows || []).map((r) => r && r.name).filter(Boolean).map(normalizeName));
      console.log(`[capture] skip fresco: ${skipPlaceIds.size} place_ids / ${skipNames.size} nomes (base ≤30d)`);
    } catch (e) {
      console.error(`[capture] skip fresco indisponível (segue sem skip): ${e.message}`);
    }
  } else {
    console.log('[capture] Supabase off — sem skip de place_id/nomes frescos');
  }

  const ordered = orderPlan(plan, history);
  console.log(`[capture] ${ordered.length} buscas | budget=${budget} min | skipPlaceIds=${skipPlaceIds.size} skipNames=${skipNames.size}`);
  const opts = { maxDetails, maxScrolls, deadline, relevance: { category: tag, skipPlaceIds, skipNames } };

  const p1 = await runQueue(ordered, opts);
  const allTel = p1.telemetry;
  let allLeads = p1.leads;
  let cutByBudget = p1.partial;
  if (cutByBudget) console.log('[capture] 1ª passada cortada por budget');

  // 2ª passada: termos extras da categoria nas RAs de baixo yield, se sobrou budget
  const t2Pool = termsOfCategory(tag).slice(1);
  if (t2Pool.length && Date.now() < deadline - DEADLINE_MARGIN_MS) {
    const nonExplicit = ordered.filter((p) => !p._explicit);
    const second = lowYieldRAs(nonExplicit, allTel, { threshold: 3, termsPool: t2Pool });
    if (second.length) {
      console.log(`[capture] 2ª passada: ${second.length} buscas (${t2Pool.join(', ')})`);
      const p2 = await runQueue(second, opts);
      allLeads = allLeads.concat(p2.leads);
      allTel.push(...p2.telemetry);
      cutByBudget = cutByBudget || p2.partial;
    }
  }

  const uniq = dedupeLeads(allLeads.map((l) => ({ ...l, name: l.name || '', address: l.address || '' })).filter((l) => l.name));
  const { kept, dropped } = relevanceFilter(uniq, tag); // defesa extra antes de salvar
  const sample = capSurfaced && capSurfaced < kept.length ? kept.slice(0, capSurfaced) : kept;
  const rejected_sample = uniq
    .filter((r) => relevanceScore(r, tag).verdict === 'reject')
    .slice(0, 15)
    .map((r) => ({ name: r.name, category: r.category }));
  const out = await saveLeads(sample, { basename, outDir: './data', formats: ['csv', 'json', 'xlsx'] });

  const seconds = Number(process.hrtime.bigint() - t0h) / 1e9;
  const meta = {
    generated_at: new Date().toISOString(),
    started_at: startedAt, finished_at: new Date().toISOString(), startedAt, finishedAt: new Date().toISOString(),
    seconds: Math.round(seconds),
    category: tag, basename, budget_min: budget, budget, ra_count: ordered.length, partial: cutByBudget,
    qs: allTel, // compat: histórico do nicho lê h.qs (e Task 5 usa capture.qs)
    telemetry: allTel,
    perRA: perRAStats(allTel),
    rejected_sample,
  };
  fs.writeFileSync(path.join('data', `${basename}-meta.json`), JSON.stringify(meta, null, 2), 'utf8');

  console.log(`[capture] RAW=${allLeads.length} UNICOS=${uniq.length} KEPT=${sample.length} DROPPED=${dropped} em ${meta.seconds}s${capSurfaced ? ` (cap ${capSurfaced})` : ''}`);
  console.log(JSON.stringify(out, null, 2));
  if (sbEnabled()) {
    try {
      const s = await syncLeads({
        category: tag, runBuild: true,
        capture: { category: tag, qs: allTel, budget_min: budget, ra_count: ordered.length, partial: cutByBudget },
      });
      console.log(`[sync] ${s.synced} leads → Supabase (${s.file})`);
    } catch (e) {
      console.error('[sync] falhou (captura salva localmente):', e.message);
    }
  }
}

/* executa a fila (pares) com um browser só; corte/ jitter ficam no scrapeMany */
async function runQueue(queue, opts) {
  const raByQ = new Map(queue.map((p) => [p.query, p.ra || null]));
  const res = await scrapeMany(queue.map((p) => p.query), opts);
  const telemetry = res.telemetry.map((t) => (raByQ.has(t.query) ? { ...t, ra: raByQ.get(t.query) } : t));
  return { leads: res.leads, telemetry, partial: res.partial };
}

/* telemetria agregada por RA (perRA do sidecar) */
function perRAStats(telemetry) {
  const map = new Map();
  for (const t of telemetry) {
    const cur = map.get(t.ra) || { ra: t.ra || null, queries: 0, relevant: 0, cards: 0, ambiguous: 0, dropped: 0, details: 0, seconds: 0 };
    cur.queries += 1;
    for (const k of ['relevant', 'cards', 'ambiguous', 'dropped', 'details', 'seconds']) cur[k] += t[k] || 0;
    map.set(cur.ra, cur);
  }
  return [...map.values()].sort((a, b) => b.relevant - a.relevant);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main };
