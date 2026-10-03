// Conjuntos de queries das duas categorias de captura
const { test } = require('node:test');
const assert = require('node:assert');

const { QUERIES } = require('../../scripts/queries');
const { QUERIES_ARQ, CITIES_ARQ } = require('../../scripts/queries-arquitetura');

test('queries de advogados: 26, únicas, sem vazias', () => {
  assert.strictEqual(QUERIES.length, 26);
  assert.strictEqual(new Set(QUERIES).size, QUERIES.length);
  assert.ok(QUERIES.every((q) => q && q.trim()));
});

test('queries de arquitetura: 3 termos × 13 cidades (DF + satélites) = 39', () => {
  assert.strictEqual(CITIES_ARQ.length, 13);
  assert.strictEqual(QUERIES_ARQ.length, 39);
  assert.strictEqual(new Set(QUERIES_ARQ).size, 39);
  for (const c of CITIES_ARQ) {
    assert.ok(QUERIES_ARQ.some((q) => q.includes(c)), `falta cidade: ${c}`);
  }
  assert.ok(QUERIES_ARQ.some((q) => q.startsWith('escritório de arquitetura ')));
  assert.ok(QUERIES_ARQ.some((q) => q.startsWith('topografia ')));
  assert.ok(QUERIES_ARQ.some((q) => q.startsWith('urbanismo ')));
  for (const c of ['Ceilândia', 'Taguatinga', 'Águas Claras', 'Samambaia', 'Guará', 'Sobradinho', 'Planaltina', 'Gama', 'Santa Maria', 'Brazlândia', 'Cidade Ocidental', 'Novo Gama']) {
    assert.ok(CITIES_ARQ.includes(c), `falta satélite: ${c}`);
  }
});
