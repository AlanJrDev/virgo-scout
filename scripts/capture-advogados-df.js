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
const { defaultBudgetMinutes, orderPlan, lowYieldRAs, collectAltQueries, freshPlaceIds } = require('../src/utils/capture-plan');
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

  // fila: strings explícitas do serve-web OU plano multi-RA com o termo principal.
  // QUERIES env pode vir do usuário (1 string p/ smoke) ou dos wrappers
  // (capture-topografia/arquitetura/tapecaria/estofado injetam a fila inteira).
  // _explicit é SÓ informativo (origem serve-web/wrapper) — não muda comportamento:
  // backfill de ra abaixo re-habilita o entry para a 2ª passada multi-termo.
  let plan;
  if (explicit) {
    plan = explicit.map((q) => ({ ra: (findRA(q) || {}).ra || null, query: q, _explicit: true }));
  } else {
    plan = buildPlan(termsOfCategory(tag)[0]);
  }
  plan = plan.map((p) => ({ ...p, ra: p.ra || ((findRA(p.query) || {}).ra || null) }));
  if (!plan.length) throw new Error('[capture] fila de captura vazia (QUERIES vazia?)');
  const budget = budgetMinEnv || defaultBudgetMinutes(plan.length);
  const deadline = Date.now() + budget * 60000;

  // histórico dedicado por BASENAME (append por rodada): data/<basename>-hist.json
  // = { runs: [{ts, perRA: {ra: {queries, relevant, ...}}, queries: [{query, relevant,...}]}]}
  // (guarda só as 10 últimas). orderPlan usa as queries da ÚLTIMA rodada; ausente/
  // inválido → ordem natural. Fallback legado <tag>-df-max-meta.json, se existir.
  const histFile = path.join('data', `${basename}-hist.json`);
  let history = [];
  try {
    const h = JSON.parse(fs.readFileSync(histFile, 'utf8'));
    const runs = h && Array.isArray(h.runs) ? h.runs : (Array.isArray(h) ? h : []);
    const last = runs.length ? runs[runs.length - 1] : null;
    if (last && Array.isArray(last.queries)) {
      history = last.queries.map((r) => ({ query: r.query, relevant: r.relevant || 0 }));
    }
  } catch (e) {
    try {
      const h = JSON.parse(fs.readFileSync(path.join('data', `${tag}-df-max-meta.json`), 'utf8'));
      if (Array.isArray(h.qs)) history = h.qs.map((r) => ({ query: r.query, relevant: r.relevant || 0 }));
    } catch (e2) { /* primeira rodada: sem histórico (ordem natural) */ }
  }

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

  // 2ª passada multi-termo: TODAS as entries com RA (explicitas incluídas —
  // wrappers topografia/tapecaria/estofado/arquitetura ganham, para cada RA
  // lowYield, queries com os OUTROS termos da categoria). Sem budget restante
  // para mais queries → marca corte e loga (a fila nunca morre silenciosa).
  if (termsOfCategory(tag).length > 1) {
    const low = lowYieldRAs(ordered, allTel, { threshold: 3 });
    // exclude = fila completa executada: nada da 1ª passada é re-rodado
    const second = collectAltQueries(low, tag, ordered.map((p) => p.query));
    if (second.length) {
      if (Date.now() < deadline - DEADLINE_MARGIN_MS) {
        console.log(`[capture] 2ª passada: ${second.length} buscas alternativas (${new Set(low.map((p) => p.ra)).size} RAs lowYield)`);
        const p2 = await runQueue(second, opts);
        allLeads = allLeads.concat(p2.leads);
        allTel.push(...p2.telemetry);
        cutByBudget = cutByBudget || p2.partial;
      } else {
        cutByBudget = true;
        console.log(`[capture] 2ª passada cortada por budget (${new Set(low.map((p) => p.ra)).size} RAs lowYield aguardaram)`);
      }
    }
  }

  const uniq = dedupeLeads(allLeads.map((l) => ({ ...l, name: l.name || '', address: l.address || '' })).filter((l) => l.name));
  const { kept, dropped } = relevanceFilter(uniq, tag); // defesa extra antes de salvar
  // cap opcional de leads surfados: melhor primeiro (score DESC) para não
  // descartar lead relevante antes de ruído; knob sem spec formal (ver report)
  let sample = kept;
  if (capSurfaced && capSurfaced < kept.length) {
    sample = kept
      .slice()
      .sort((a, b) => relevanceScore(b, tag).score - relevanceScore(a, tag).score)
      .slice(0, capSurfaced);
    console.log(`[capture] BASE_MAX_SURFACED=${capSurfaced}: kept=${kept.length} ordenado por relevância, surfando os melhores ${capSurfaced}`);
  }
  const rejected_sample = uniq
    .filter((r) => relevanceScore(r, tag).verdict === 'reject')
    .slice(0, 15)
    .map((r) => ({ name: r.name, category: r.category }));
  const out = await saveLeads(sample, { basename, outDir: './data', formats: ['csv', 'json', 'xlsx'] });

  const seconds = Number(process.hrtime.bigint() - t0h) / 1e9;
  // cópias pequenas (sem refs ao array vivo; sem foundCards de telemetria crua)
  const qsTrim = allTel.map((t) => ({
    query: t.query, ra: t.ra || null, relevant: t.relevant || 0, ambiguous: t.ambiguous || 0,
    dropped: t.dropped || 0, details: t.details || 0, seconds: t.seconds || 0, failed: !!t.failed,
  }));
  const raStats = perRAStats(allTel);
  const perRAObj = {};
  for (const r of raStats) perRAObj[r.ra || '(sem RA)'] = r;
  const finishedAt = new Date().toISOString();
  const meta = {
    generated_at: finishedAt,
    started_at: startedAt, finished_at: finishedAt, startedAt, finishedAt,
    seconds: Math.round(seconds),
    category: tag, basename, budget_min: budget, budget, ra_count: ordered.length, partial: cutByBudget,
    qs: qsTrim,
    telemetry: allTel, // telemetria crua (com foundCards) da mesma rodada
    perRA: raStats,
    rejected_sample,
  };
  fs.writeFileSync(path.join('data', `${basename}-meta.json`), JSON.stringify(meta, null, 2), 'utf8');
  // histórico por rodada (orderPlan boost): append com guard de 10 rodadas
  try {
    let runs = [];
    try {
      const j = JSON.parse(fs.readFileSync(histFile, 'utf8'));
      runs = j && Array.isArray(j.runs) ? j.runs : (Array.isArray(j) ? j : []);
    } catch (e) { /* primeira rodada */ }
    runs.push({ ts: finishedAt, perRA: perRAObj, queries: qsTrim });
    while (runs.length > 10) runs.shift();
    fs.writeFileSync(histFile, JSON.stringify({ runs }, null, 2), 'utf8');
  } catch (e) {
    console.error(`[capture] hist não gravado (${e.message}) — next run roda com ordem natural`);
  }

  console.log(`[capture] RAW=${allLeads.length} UNICOS=${uniq.length} KEPT=${sample.length} DROPPED=${dropped} em ${meta.seconds}s${capSurfaced ? ` (cap ${capSurfaced})` : ''}`);
  console.log(JSON.stringify(out, null, 2));
  if (sbEnabled()) {
    try {
      const s = await syncLeads({
        category: tag, runBuild: true,
        capture: {
          basename, category: tag, started_at: startedAt, seconds: meta.seconds,
          budget_min: budget, ra_count: ordered.length, partial: cutByBudget,
          qs: qsTrim, telemetry: allTel, perRA: raStats,
        },
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
