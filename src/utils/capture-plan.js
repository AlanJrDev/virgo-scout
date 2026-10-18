/* Planner do Capture V2: budget proporcional, fila por yield histórico, segunda passada por termo. */
const { buildPlan } = require('./df-ra');

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

/* RAs (pares [{ra, query}]) com yield abaixo do threshold: 1 plano por termo
   extra da categoria (termsPool), mantendo a mesma RA. Queries cortadas por
   budget (sem telemetry) voltam com relevant 0 → entram na 2ª passada. */
function lowYieldRAs(plan, telemetry = [], { threshold = 3, termsPool = [] } = {}) {
  const tel = new Map(telemetry.map((t) => [t.query, t]));
  const low = plan.filter((p) => (tel.get(p.query)?.relevant || 0) < threshold);
  const out = [];
  for (const p of low) {
    for (const term of termsPool) {
      out.push(...buildPlan(term, { ra: p.ra }));
    }
  }
  return out;
}

function freshPlaceIds(rows) {
  return new Set((rows || []).map((r) => r && r.place_id).filter(Boolean));
}

module.exports = { defaultBudgetMinutes, orderPlan, lowYieldRAs, freshPlaceIds };
