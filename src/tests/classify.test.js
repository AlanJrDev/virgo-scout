const { test } = require('node:test');
const assert = require('node:assert');

const { classifyLead, areaDistribution, AREAS } = require('../utils/classify');

test('classifica por nome: escritório trabalhista', () => {
  const r = classifyLead({ name: 'Souza & Lima Advocacia Trabalhista', source: 'advogados DF' });
  assert.strictEqual(r.area, 'Trabalhista');
  assert.ok(r.confidence >= 0.9);
});

test('classifica por nome sem acento: familia', () => {
  const r = classifyLead({ name: 'Escritório Vida Nova - Direito de Família', source: 'x' });
  assert.strictEqual(r.area, 'Família');
});

test('cai na origem quando nome é genérico', () => {
  const r = classifyLead({ name: 'Almeida Advogados', source: 'advogado criminal Brasília' });
  assert.strictEqual(r.area, 'Criminal');
  assert.strictEqual(r.confidence, 0.7);
});

test('nome genérico sem pista na origem vira Geral', () => {
  const r = classifyLead({ name: 'Almeida Advogados', source: 'advogados Distrito Federal' });
  assert.strictEqual(r.area, 'Geral');
  assert.strictEqual(r.confidence, 0.3);
});

test('nome tem prioridade sobre origem conflitante', () => {
  const r = classifyLead({ name: 'Nogueira Previdenciário Adv', source: 'advogado criminal Brasília' });
  assert.strictEqual(r.area, 'Previdenciário');
});

test('areaDistribution cobre todos os leads e ordena desc', () => {
  const leads = [
    { name: 'A Trabalhista', source: '' },
    { name: 'B Trabalhista', source: '' },
    { name: 'C Criminal', source: '' },
    { name: 'D Genérico', source: '' },
  ];
  const dist = areaDistribution(leads);
  const sum = dist.reduce((a, d) => a + d.value, 0);
  assert.strictEqual(sum, 4);
  assert.strictEqual(dist[0].label, 'Trabalhista');
  assert.strictEqual(dist[0].value, 2);
  assert.ok(dist[0].color);
});

test('lista de áreas cobre as especialidades do escopo', () => {
  assert.ok(AREAS.includes('Trabalhista') && AREAS.includes('Criminal') && AREAS.includes('Tributário'));
});
