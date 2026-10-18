/* Planner do Capture V2: budget proporcional, fila por yield histórico, segunda passada por termo. */
const { buildPlan } = require('./df-ra');
const { termsOfCategory } = require('./categories');

function defaultBudgetMinutes(nQueries) {
  // RAs demoram ~1.6 min (cards+details+jitter); DF inteiro fica capado em 60
  return Math.min(60, Math.round((6 + 1.6 * (nQueries || 0)) * 10) / 10);
}

// history: [{query, relevant}] da meta anterior — queries com yield alto
// (boost) vêm primeiro; entries sem histórico empatam (sort é estável por padrão)
function orderPlan(plan, history = []) {
  if (!history.length) return plan.slice();
  const byQ = new Map(history.map((h) => [h.query, h]));
  return plan.slice().sort((a, b) => {
    const ya = byQ.get(a.query);
    const yb = byQ.get(b.query);
    const ra = ya ? (ya.relevant || 0) : 1; // sem histórico = prioridade média
    const rb = yb ? (yb.relevant || 0) : 1;
    return rb - ra;
  });
}

/* RAs (pares [{ra, query}]) com yield abaixo do threshold. Com termsPool, devolve
   1 plano de captura por termo extra (buildPlan(term, {ra})); SEM termsPool
   devolve os próprios pares low-yield (entrada para collectAltQueries). */
function lowYieldRAs(plan, telemetry = [], { threshold = 3, termsPool = [] } = {}) {
  const tel = new Map(telemetry.map((t) => [t.query, t]));
  const low = plan.filter((p) => (tel.get(p.query)?.relevant || 0) < threshold);
  if (!termsPool.length) return low;
  const out = [];
  for (const p of low) {
    for (const term of termsPool) {
      out.push(...buildPlan(term, { ra: p.ra }));
    }
  }
  return out;
}

/* Alternativas multi-termo para pares low-yield: cada RA ganha query com os
   OUTROS termos da categoria. `exclude` = TODAS as queries já executadas na
   rodada (o runner passa o plan completo/ordered, não só as low) — nada de
   re-rodar query que acabou de virar lead; as próprias queries dos entries low
   ficam de fora também. _explicit só marca origem serve-web e não bloqueia
   bloqueia nada aqui. Dedupe por query, ordem estável; entries sem RA ficam
   de fora. */
function collectAltQueries(entries, category, exclude = []) {
  const terms = termsOfCategory(category);
  const selfQ = new Set(
    (entries || []).map((p) => p && p.query).filter(Boolean)
      .concat((Array.isArray(exclude) ? exclude : [exclude]).filter(Boolean))
  );
  const seen = new Set();
  const out = [];
  for (const p of entries || []) {
    if (!p || !p.ra) continue;
    for (const term of terms) {
      for (const pair of buildPlan(term, { ra: p.ra })) {
        if (selfQ.has(pair.query) || seen.has(pair.query)) continue;
        seen.add(pair.query);
        out.push(pair);
      }
    }
  }
  return out;
}

function freshPlaceIds(rows) {
  return new Set((rows || []).map((r) => r && r.place_id).filter(Boolean));
}

module.exports = { defaultBudgetMinutes, orderPlan, lowYieldRAs, collectAltQueries, freshPlaceIds };
