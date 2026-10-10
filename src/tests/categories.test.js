// src/tests/categories.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { CATEGORIES, CAT_KEYS, tagOf, typeList, typeOfLead, matchesType } = require('../utils/categories');
const { matchFile } = require('../utils/leads-io');

test('registro cobre as 4 categorias com tags sem acento', () => {
  assert.deepStrictEqual(CAT_KEYS, ['advogados', 'arquitetura', 'tapestaria', 'estofado']);
  assert.strictEqual(tagOf('tapestaria'), 'tapestaria');
  assert.strictEqual(tagOf('inexistente'), 'advogados');
  assert.strictEqual(CATEGORIES.tapestaria.label, 'Tapeçaria');
});

test('typeList faz split de types com fallback para source', () => {
  assert.deepStrictEqual(typeList({ types: 'tapestaria,estofado' }), ['tapestaria', 'estofado']);
  assert.deepStrictEqual(typeList({ source: 'arquitetura' }), ['arquitetura']);
  assert.deepStrictEqual(typeList({}), ['advogados']);
  assert.strictEqual(typeOfLead({ types: 'estofado,tapestaria' }), 'estofado');
  assert.strictEqual(typeOfLead({}), 'advogados');
});

test('matchesType: all casa tudo; tag exata casa; tag ausente não casa', () => {
  const l = { types: 'tapestaria,estofado' };
  assert.strictEqual(matchesType(l, 'all'), true);
  assert.strictEqual(matchesType(l, 'tapestaria'), true);
  assert.strictEqual(matchesType(l, 'advogados'), false);
});

test('matchFile separa prefixos de arquivo por categoria', () => {
  assert.strictEqual(matchFile('tapestaria-df-max.json', 'tapestaria'), true);
  assert.strictEqual(matchFile('tapestaria-df-max.json', 'advogados'), false);
  assert.strictEqual(matchFile('advogados-df-max.json', 'advogados'), true);
  assert.strictEqual(matchFile('arquitetura-df-max.json', 'advogados'), false);
  assert.strictEqual(matchFile('estofado-df-max.json', 'estofado'), true);
});
