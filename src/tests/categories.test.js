// src/tests/categories.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { CATEGORIES, CAT_KEYS, tagOf, typeList, typeOfLead, matchesType } = require('../utils/categories');
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
