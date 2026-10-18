// Cidades do DF + janela adaptativa (findRA/buildQueries)
const { test } = require('node:test');
const assert = require('node:assert');
const { findRA, buildQueries, RAS } = require('../utils/df-ra');

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

test('queries de captura com suffixo "Brasília DF": RA específico vence Brasília (pares do runner)', () => {
  assert.strictEqual(findRA('topografia Gama Brasília DF').ra, 'Gama');
  assert.strictEqual(findRA('topografia Brasília DF').ra, 'Brasília');
  assert.strictEqual(findRA('estofado Águas Claras Brasília DF').ra, 'Águas Claras');
});

test('cidades oficiais: 37 RAs + Asa Sul/Norte como termos de busca', () => {
  const OficiaisAusentes = ['Gama', 'Taguatinga', 'Ceilândia', 'Guará', 'Cruzeiro', 'Samambaia', 'Santa Maria', 'São Sebastião', 'Recanto das Emas', 'Lago Sul', 'Riacho Fundo', 'Lago Norte', 'Candangolândia', 'Águas Claras', 'Riacho Fundo II', 'Sudoeste/Octogonal', 'Varjão', 'Park Way', 'Estrutural', 'Sobradinho II', 'Jardim Botânico', 'Itapoã', 'SIA', 'Vicente Pires', 'Fercal', 'Sol Nascente', 'Arniqueira', 'Arapoanga', 'Água Quente', '26 de Setembro', 'Ponte Alta'];
  const tem = new Set(RAS.map((r) => r));
  for (const r of OficiaisAusentes) assert.ok(tem.has(r), `RA oficial faltando: ${r}`);
  const semAsas = RAS.filter((r) => r !== 'Asa Sul' && r !== 'Asa Norte');
  assert.strictEqual(semAsas.length, 37, `RAs oficiais: ${semAsas}`);
});

test('buildQueries: UF inteiro = todas as RAs, uma query por RA; RA único = 1 query', () => {
  const all = buildQueries('estofado');
  assert.strictEqual(all.length, RAS.length);
  assert.ok(all.every((q) => / Brasília DF$/.test(q)), 'query termina com Brasília DF');
  assert.strictEqual(buildQueries('tapeçaria', { ra: 'Guará' }).length, 1);
  const one = buildQueries('estofado', { ra: 'Guará' })[0];
  assert.strictEqual(one, 'estofado Guará Brasília DF');
  const qs = buildQueries('estofado');
  assert.strictEqual(qs[0], 'estofado Brasília DF', 'ordem natural: Brasília primeiro, sem duplicar o termo');
  assert.strictEqual(qs[1], 'estofado Asa Sul Brasília DF', 'ordem natural de RAS (não TIER1)');
});

test('buildPlan: pares ra/query, Brasília sem duplicação, compat buildQueries', () => {
  const { buildPlan, buildQueries } = require('../utils/df-ra');
  const plan = buildPlan('topografia', { ra: 'Brasília' });
  assert.deepStrictEqual(plan, [{ ra: 'Brasília', query: 'topografia Brasília DF' }]);
  const ac = buildPlan('topografia', { ra: 'Águas Claras' });
  assert.strictEqual(ac[0].query, 'topografia Águas Claras Brasília DF');
  const full = buildPlan('topografia');
  assert.strictEqual(full.length, 39); // 37 RAs + Asa Sul + Asa Norte
  assert.strictEqual(new Set(full.map((p) => p.query)).size, full.length); // sem queries duplicadas
  assert.ok(buildQueries('topografia', { ra: 'Brasília' })[0].includes('Brasília DF'));
});

test('findRA: sufixo II vence o prefixo (chave mais longa desempata)', () => {
  assert.strictEqual(findRA('topografia Riacho Fundo II Brasília DF').ra, 'Riacho Fundo II');
  assert.strictEqual(findRA('topografia Sobradinho II Brasília DF').ra, 'Sobradinho II');
});
