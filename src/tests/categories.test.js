// src/tests/categories.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { CATEGORIES, CAT_KEYS, tagOf, typeList, typeOfLead, matchesType, rootsFor, relevanceFilter, relevanceScore, termsOfCategory } = require('../utils/categories');
const { matchFile } = require('../utils/leads-io');

test('registro cobre as categorias com tags sem acento', () => {
  assert.deepStrictEqual(CAT_KEYS, ['advogados', 'arquitetura', 'tapecaria', 'estofado', 'topografia']);
  assert.strictEqual(tagOf('tapecaria'), 'tapecaria');
  assert.strictEqual(tagOf('inexistente'), 'advogados');
  assert.strictEqual(CATEGORIES.tapecaria.label, 'Tapeçaria');
});

test('typeList faz split de types com fallback para source', () => {
  assert.deepStrictEqual(typeList({ types: 'tapecaria,estofado' }), ['tapecaria', 'estofado']);
  assert.deepStrictEqual(typeList({ source: 'arquitetura' }), ['arquitetura']);
  assert.deepStrictEqual(typeList({}), ['advogados']);
  assert.strictEqual(typeOfLead({ types: 'estofado,tapecaria' }), 'estofado');
  assert.strictEqual(typeOfLead({}), 'advogados');
});

test('matchesType: all casa tudo; tag exata casa; tag ausente não casa', () => {
  const l = { types: 'tapecaria,estofado' };
  assert.strictEqual(matchesType(l, 'all'), true);
  assert.strictEqual(matchesType(l, 'tapecaria'), true);
  assert.strictEqual(matchesType(l, 'advogados'), false);
});

test('matchFile separa prefixos de arquivo por categoria', () => {
  assert.strictEqual(matchFile('tapecaria-df-max.json', 'tapecaria'), true);
  assert.strictEqual(matchFile('tapecaria-df-max.json', 'advogados'), false);
  assert.strictEqual(matchFile('advogados-df-max.json', 'advogados'), true);
  assert.strictEqual(matchFile('arquitetura-df-max.json', 'advogados'), false);
  assert.strictEqual(matchFile('estofado-df-max.json', 'estofado'), true);
});

test('relevanceFilter: mantem raizes do nicho e descarta ruído misturado pelo Maps', () => {
  assert.deepStrictEqual(rootsFor('topografia').length >= 1, true);
  const out = relevanceFilter([
    { name: 'TOPOGRAFIA PLANALTO', category: 'Engenheiro(a) agrônomo(a)' },
    { name: '2GEO Consultoria Ambiental e Engenharia', category: 'Engenharia ambiental' },
    { name: 'Garcia Topografia', category: 'Empresa de Terraplenagem' },
    { name: 'Residencial Santa Mônica', category: 'Complexo habitacional' },
    { name: 'Jardim Botânico de Brasília', category: 'Jardim botânico' },
    { name: 'Amey Limpeza e Impermeabilização de Estofados', category: 'Serviço de limpeza de estofado' },
  ], 'topografia');
  assert.deepStrictEqual(out.kept.map((r) => r.name), ['TOPOGRAFIA PLANALTO', '2GEO Consultoria Ambiental e Engenharia', 'Garcia Topografia']);
  assert.strictEqual(out.dropped, 3);
  const est = relevanceFilter([
    { name: 'Amey Limpeza e Impermeabilização de Estofados', category: 'Serviço de limpeza' },
    { name: 'Distribuidora de Réfrigeração', category: null },
  ], 'estofado');
  assert.deepStrictEqual(est.kept.map((r) => r.name), ['Amey Limpeza e Impermeabilização de Estofados', 'Distribuidora de Réfrigeração']);
  assert.strictEqual(relevanceFilter([{ name: 'Qualquer' }], 'desconhecida').kept.length, 1);
});

test('relevanceScore: match por nome, reject por categoria, ambiguo sem sinal', () => {
  assert.deepStrictEqual(relevanceScore({ name: 'TOPOGRAFIA PLANALTO', category: 'Engenheiro(a) agrônomo(a)' }, 'topografia'), { score: 2, verdict: 'match' });
  assert.deepStrictEqual(relevanceScore({ name: 'Residencial Santa Mônica', category: 'Complexo habitacional' }, 'topografia'), { score: 0, verdict: 'reject' });
  assert.deepStrictEqual(relevanceScore({ name: '2GEO Consultoria', category: null }, 'topografia'), { score: 1, verdict: 'match' });
  assert.deepStrictEqual(relevanceScore({ name: 'Amey Limpeza e Impermeabilização de Estofados', category: 'Serviço de limpeza' }, 'topografia'), { score: 0, verdict: 'reject' });
  assert.deepStrictEqual(relevanceScore({ name: 'Garcia Topografia', category: 'Empresa de Terraplenagem' }, 'topografia'), { score: 2, verdict: 'match' });
  assert.strictEqual(relevanceScore({ name: 'X' }, 'desconhecida').verdict, 'ambiguo');
});

test('termsOfCategory: termos do registro, fallback [cat]', () => {
  assert.deepStrictEqual(termsOfCategory('topografia'), ['topografia', 'topógrafo', 'levantamento topográfico', 'georreferenciamento']);
  assert.deepStrictEqual(termsOfCategory('desconhecida'), ['desconhecida']);
});

test('fase 2: termos novos por categoria (sem nicho novo, topografia intocada)', () => {
  assert.ok(termsOfCategory('advogados').includes('advogado trabalhista'));
  assert.ok(termsOfCategory('tapecaria').includes('persianas'));
  assert.ok(termsOfCategory('estofado').includes('encapamento de estofados'));
  assert.ok(termsOfCategory('arquitetura').includes('projeto arquitetônico'));
  assert.deepStrictEqual(termsOfCategory('topografia'), ['topografia', 'topógrafo', 'levantamento topográfico', 'georreferenciamento'], 'nicho rico já tem raízes suficientes — não mexer');
  for (const cat of ['advogados', 'arquitetura', 'tapecaria', 'estofado']) {
    const termos = termsOfCategory(cat);
    assert.strictEqual(new Set(termos).size, termos.length, `${cat}: sem duplicados`);
  }
});
