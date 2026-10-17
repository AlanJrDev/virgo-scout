// Cidades do DF + janela adaptativa (findRA/buildQueries)
const { test } = require('node:test');
const assert = require('node:assert');
const { findRA, buildQueries, RAS, RAS_TIER1 } = require('../utils/df-ra');

test('findRA reconhece RA por nome, plural, sem acento e alias', () => {
  assert.strictEqual(findRA('capturar estofados em Aguas Claras').ra, 'Águas Claras');
  assert.strictEqual(findRA('tapeçaria no Lago Sul').ra, 'Lago Sul');
  assert.strictEqual(findRA('advogados taguatinga').ra, 'Taguatinga');
  assert.strictEqual(findRA('arquitetos no plano piloto').ra, 'Brasília');
  assert.strictEqual(findRA('capturar estofados em ceilandia').ra, 'Ceilândia');
  assert.strictEqual(findRA('nicho sol nascente df').ra, 'Sol Nascente');
});

test('findRA DF inteiro => raType df; texto sem lugar => null', () => {
  assert.deepStrictEqual(findRA('capturar advogados no df inteiro'), { ra: null, raType: 'df' });
  assert.deepStrictEqual(findRA('capturar estofados no Distrito Federal'), { ra: null, raType: 'df' });
  assert.strictEqual(findRA('capturar tapeçarias'), null);
  assert.strictEqual(findRA(''), null);
});

test('RA específico vence menção genérica a DF no mesmo prompt', () => {
  const r = findRA('tapeçaria no df, começando por taguatinga');
  assert.strictEqual(r.raType, 'ra');
  assert.strictEqual(r.ra, 'Taguatinga');
});

test('buildQueries: UF inteiro = todas as RAs, uma query por RA; RA único = 1 query', () => {
  const all = buildQueries('estofado');
  assert.strictEqual(all.length, RAS.length);
  assert.ok(all.every((q) => / Brasília DF$/.test(q)), 'query termina com Brasília DF');
  assert.strictEqual(buildQueries('tapeçaria', { ra: 'Guará' }).length, 1);
  const one = buildQueries('estofado', { ra: 'Guará' })[0];
  assert.strictEqual(one, 'estofado Guará Brasília DF');
  const first = buildQueries('estofado')[0].startsWith('estofado Brasília') ? 'Brasília' : null;
  assert.ok(RAS_TIER1.includes(first), 'primeiro RA capture = tier 1');
});
