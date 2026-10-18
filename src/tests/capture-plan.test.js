// Testes do planner de budget do Capture V2 (partes puras, sem browser)
const { test } = require('node:test');
const assert = require('node:assert');
const { findRA, buildQueries } = require('../utils/df-ra');
const { defaultBudgetMinutes, orderPlan, lowYieldRAs, collectAltQueries, freshPlaceIds } = require('../utils/capture-plan');

test('budget proporcional: 1 RA ~8 min; DF inteiro cap 60', () => {
  assert.strictEqual(defaultBudgetMinutes(1), 7.6);
  assert.strictEqual(defaultBudgetMinutes(10), 22);
  assert.strictEqual(defaultBudgetMinutes(39), 60); // cap
});

test('orderPlan: histórico de yield ordena desc; sem histórico mantém ordem (boost = fila de yield)', () => {
  const plan = [
    { ra: 'Brasília', query: 'q-bra' },
    { ra: 'Águas Claras', query: 'q-ac' },
    { ra: 'Gama', query: 'q-ga' },
  ];
  const hist = [{ query: 'q-ac', relevant: 13 }, { query: 'q-bra', relevant: 5 }];
  const ordered = orderPlan(plan, hist);
  assert.deepStrictEqual(ordered.map((p) => p.query), ['q-ac', 'q-bra', 'q-ga']);
  assert.deepStrictEqual(orderPlan(plan, []).map((p) => p.query), ['q-bra', 'q-ac', 'q-ga']);
});

test('lowYieldRAs: RA com < N relevantes na primeira passada entra na segunda (um plano por termo)', () => {
  const plan = [{ ra: 'Gama', query: 'q-ga' }, { ra: 'Águas Claras', query: 'q-ac' }];
  const tel = [{ query: 'q-ga', relevant: 1 }, { query: 'q-ac', relevant: 12 }];
  const second = lowYieldRAs(plan, tel, { threshold: 3, termsPool: ['levantamento topográfico', 'georreferenciamento'] });
  assert.deepStrictEqual(second.map((p) => p.query), [
    'levantamento topográfico Gama Brasília DF',
    'georreferenciamento Gama Brasília DF',
  ]);
  assert.strictEqual(second[0].ra, 'Gama');
});

test('lowYieldRAs sem termsPool devolve os próprios pares low-yield (entrada do collectAltQueries)', () => {
  const plan = [{ ra: 'Gama', query: 'q-ga' }, { ra: 'Águas Claras', query: 'q-ac' }];
  const tel = [{ query: 'q-ga', relevant: 1 }, { query: 'q-ac', relevant: 12 }];
  assert.deepStrictEqual(lowYieldRAs(plan, tel, { threshold: 3 }), [{ ra: 'Gama', query: 'q-ga' }]);
});

test('collectAltQueries: entries de QUERIES (incl. _explicit) com RA ganham alternativas dos outros termos', () => {
  const entries = [
    { ra: 'Gama', query: 'topógrafo Gama Brasília DF' }, // _explicit não bloqueia nada aqui
    { ra: 'Gama', query: 'levantamento topográfico Gama Brasília DF' },
    { ra: null, query: 'advogado sem lugar' },             // sem RA: fora
  ];
  const alt = collectAltQueries(entries, 'topografia');
  assert.deepStrictEqual(alt.map((p) => p.query), [
    'topografia Gama Brasília DF',
    'georreferenciamento Gama Brasília DF',
  ]);
  assert.strictEqual(alt[0].ra, 'Gama');
});

test('integração: plan de wrapper topografia com backfill findRA → alternativas por RA lowYield (não só Brasília)', () => {
  const qs = buildQueries('topografia');
  // mesmo fluxo do runner: entries de QUERIES (serve-web/wrapper) + backfill de ra
  const plan = qs.map((q) => ({ ra: (findRA(q) || {}).ra || null, query: q, _explicit: true }));
  const lowRAs = new Set(['Gama', 'Águas Claras', 'Ceilândia']);
  assert.ok(plan.every((p) => p.ra), 'todas as RAs resolvíveis (wrap Brasília DF não sequestra o RA)');
  const tel = plan.map((p) => ({ query: p.query, relevant: lowRAs.has(p.ra) ? 0 : 20 }));
  const low = lowYieldRAs(plan, tel, { threshold: 3 });
  const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  assert.deepStrictEqual(low.map((p) => norm(p.ra)).sort(), ['Aguas Claras', 'Ceilandia', 'Gama']);
  const alt = collectAltQueries(low, 'topografia', plan.map((p) => p.query));
  const gamas = alt.filter((p) => p.ra === 'Gama').map((p) => p.query).sort();
  assert.deepStrictEqual(gamas, [
    'georreferenciamento Gama Brasília DF',
    'levantamento topográfico Gama Brasília DF',
    'topógrafo Gama Brasília DF',
  ]);
  // 3 RAs low yield, NÃO só Brasília
  const rasAlt = new Set(alt.map((p) => p.ra));
  for (const ra of lowRAs) assert.ok(rasAlt.has(ra), `alternativas por RA ausentes: ${ra}`);
  // nada da fila executada (plan completo) volta como "novo"
  const executed = new Set(plan.map((p) => p.query));
  assert.ok(alt.every((p) => !executed.has(p.query)));
});

test('freshPlaceIds: Set só com place_id presente', () => {
  const rows = [{ place_id: '0x1' }, {}, { place_id: '0x2' }, { place_id: '' }];
  const s = freshPlaceIds(rows);
  assert.ok(s instanceof Set);
  assert.strictEqual(s.size, 2);
  assert.ok(s.has('0x1') && s.has('0x2'));
});
