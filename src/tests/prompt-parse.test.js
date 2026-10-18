// Parser local de captura (nicho + multi-RA + df explícito) — caso raiz: pedido multi-RA
// capturava SÓ a 1ª RA (findRA devolve UMA). Ver src/utils/prompt-parse.js p/ decisões.
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCapturePrompt, planFor } = require('../utils/prompt-parse');

const PROMPT_ALAN = 'topografia aguas claras, plano piloto, lago sul e lago norte, asa sul e asa norte, sia, cruzeiro e sudoeste';

test('prompt completo do usuário: 9 RAs em ordem de aparição (plano piloto→Brasília)', () => {
  const p = parseCapturePrompt(PROMPT_ALAN);
  assert.strictEqual(p.category, 'topografia');
  assert.strictEqual(p.df, false, 'brasília/plano piloto NÃO liga df explícito');
  assert.deepStrictEqual(p.ras, [
    'Águas Claras', 'Brasília', 'Lago Sul', 'Lago Norte',
    'Asa Sul', 'Asa Norte', 'SIA', 'Cruzeiro', 'Sudoeste/Octogonal',
  ]);
  const raTerms = p.matched.filter((m) => m.ra);
  assert.strictEqual(raTerms.length, 9);
  assert.strictEqual(raTerms.find((m) => m.ra === 'Brasília').term, 'plano piloto');
});

test('planFor: multi-RA achatado e dedupe por query, ordem de aparição', () => {
  const p = parseCapturePrompt(PROMPT_ALAN);
  const { plan, place, placeType, term } = planFor(p.category, p);
  assert.strictEqual(term, 'topografia');
  assert.strictEqual(placeType, 'multi');
  assert.strictEqual(plan.length, 9);
  assert.ok(plan[0].query.includes('Águas Claras'));
  assert.ok(plan[plan.length - 1].query.includes('Sudoeste/Octogonal'));
  const qs = new Set(plan.map((x) => x.query));
  assert.strictEqual(qs.size, plan.length, 'sem queries duplicadas');
  assert.ok(place.includes('Águas Claras'));
});

test('passada (b) sem espaços: planopilkoto→Brasília e aguasclaras→Águas Claras', () => {
  const p = parseCapturePrompt('topografia planopilkoto');
  assert.deepStrictEqual(p.ras, ['Brasília']);
  const q = parseCapturePrompt('estofado aguasclaras');
  assert.strictEqual(q.category, 'estofado');
  assert.deepStrictEqual(q.ras, ['Águas Claras']);
  // levenshtein ≤ 2 na passada sem espaço (não exato): lev('planopilkoto','planopiloto')=1
  const l = parseCapturePrompt('topografia planopilkoto e lagoo sul');
  assert.ok(l.ras.includes('Brasília') && l.ras.includes('Lago Sul'));
});

test('nichos do micro-dicionário: direito→advogados, sofa→estofado, tapete→tapecaria, georref→topografia', () => {
  assert.strictEqual(parseCapturePrompt('direito tributario lago sul').category, 'advogados');
  assert.strictEqual(parseCapturePrompt('sofas e poltronas no guará').category, 'estofado');
  assert.strictEqual(parseCapturePrompt('carpete e tapete na ceilândia').category, 'tapecaria');
  assert.strictEqual(parseCapturePrompt('levantamento georreferenciamento grandemente').category, 'topografia');
  assert.strictEqual(parseCapturePrompt('arquiteto residencial brasilia').category, 'arquitetura');
});

test('caso único: tapecaria lago sul → 1 categoria, 1 RA, 1 query', () => {
  const p = parseCapturePrompt('tapeçaria lago sul');
  assert.strictEqual(p.category, 'tapecaria');
  assert.deepStrictEqual(p.ras, ['Lago Sul']);
  const { plan, placeType } = planFor(p.category, p);
  assert.strictEqual(placeType, 'ra');
  assert.deepStrictEqual(plan, [{ ra: 'Lago Sul', query: 'tapeçaria Lago Sul Brasília DF' }]);
});

test('df explícito: df inteiro → df:true; brasília solta NÃO liga df', () => {
  const d = parseCapturePrompt('advogados df inteiro');
  assert.strictEqual(d.df, true);
  const d2 = parseCapturePrompt('captar estofados no Distrito Federal todo');
  assert.strictEqual(d2.df, true);
  const b = parseCapturePrompt('arquitetura em brasília');
  assert.strictEqual(b.df, false);
  assert.deepStrictEqual(b.ras, ['Brasília']);
  const { place, placeType } = planFor(b.category, b);
  assert.strictEqual(placeType, 'ra');
});

test('low_signal: sem categoria → category null (ras úteis p/ debug, df ok)', () => {
  const p = parseCapturePrompt('capturar cachorros no lago sul');
  assert.strictEqual(p.category, null);
  const e = parseCapturePrompt('');
  assert.strictEqual(e.category, null);
  assert.deepStrictEqual(e.ras, []);
});

test('degens: SIA não vira falso sido dentro de palavras; ra evolução por palavra', () => {
  // 'persianas' contém 'sia' mas com word-boundary não casa
  const pers = parseCapturePrompt('persianas lago sul');
  assert.ok(!pers.ras.includes('SIA'), 'sia não deve casar dentro de persianas');
  assert.deepStrictEqual(pers.ras, ['Lago Sul']);
  // passada sem espaço ignora nomes de 1 palavra: 'sia' não casa em 'asiapimanorte'
  const ns = parseCapturePrompt('topografia asiapimanorte');
  assert.deepStrictEqual(ns.ras, [], 'sia (1 palavra) fica de fora da passada sem espaço');
  // riacho fundo II vence o prefixo
  const rf = parseCapturePrompt('topografia riacho fundo ii');
  assert.ok(rf.ras.includes('Riacho Fundo II') && !rf.ras.includes('Riacho Fundo'), `ras=${rf.ras}`);
});

test('sobreposição entre nicho e lugar: categoria vence pelo match mais cedo', () => {
  // 'tapete' antes de 'estofados': termo oficial de estofado ('tapetes') empata? não —
  // 'tapete' (tapecaria, extra) casa mais cedo → tapecaria
  const t = parseCapturePrompt('tapete estofados');
  assert.strictEqual(t.category, 'tapecaria');
  const e = parseCapturePrompt('estofados tapete');
  assert.strictEqual(e.category, 'estofado');
});
