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

test('categoria arquitetura: classifica por nome (3 áreas)', () => {
  assert.strictEqual(classifyLead({ name: 'Marcos Topógrafos e Consultoria', source: '' }, 'arquitetura').area, 'Topografia');
  assert.strictEqual(classifyLead({ name: 'Studio de Projeto Arquitetônico', source: '' }, 'arquitetura').area, 'Arquitetura');
  assert.strictEqual(classifyLead({ name: 'Planejamento Urbano DF Ltda', source: '' }, 'arquitetura').area, 'Urbanismo');
});

test('categoria arquitetura: origem (query) com nome genérico; fallback Outros', () => {
  const r = classifyLead({ name: 'Almeida Comércio', source: 'escritório de arquitetura Taguatinga' }, 'arquitetura');
  assert.strictEqual(r.area, 'Arquitetura');
  assert.strictEqual(r.confidence, 0.7);
  const g = classifyLead({ name: 'Loja de Roupas', source: 'mercado central' }, 'arquitetura');
  assert.strictEqual(g.area, 'Outros');
  assert.strictEqual(g.confidence, 0.3);
});

test('categoria padrão (advogados) não muda comportamento', () => {
  const a = classifyLead({ name: 'Souza & Lima Advocacia Trabalhista', source: 'advogados DF' });
  const b = classifyLead({ name: 'Souza & Lima Advocacia Trabalhista', source: 'advogados DF' }, 'advogados');
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.area, 'Trabalhista');
});

test('areaDistribution aceita categoria arquitetura', () => {
  const leads = [
    { name: 'Escritório de Arquitetura A', source: '' },
    { name: 'Escritório de Arquitetura B', source: '' },
    { name: 'Topografia Gama', source: '' },
    { name: 'Loja X', source: 'nada' },
  ];
  const dist = areaDistribution(leads, 'arquitetura');
  const sum = dist.reduce((a, d) => a + d.value, 0);
  assert.strictEqual(sum, 4);
  assert.strictEqual(dist[0].label, 'Arquitetura');
  assert.strictEqual(dist[0].value, 2);
  assert.ok(dist.some((d) => d.label === 'Topografia'));
  assert.ok(dist.some((d) => d.label === 'Outros'));
});

test('quando source virou tag de categoria, o contexto vem de origin', () => {
  const { classifyLead } = require('../../src/utils/classify');
  const arq = classifyLead({ name: 'Escritorio Generico', source: 'arquitetura', origin: 'topografia no Gama' }, 'arquitetura');
  assert.strictEqual(arq.area, 'Topografia');
  assert.strictEqual(arq.confidence, 0.7);
  const adv = classifyLead({ name: 'Nome Generico SA', source: 'advogados', origin: 'advogados trabalhista Brasilia' }, 'advogados');
  assert.strictEqual(adv.area, 'Trabalhista');
  assert.strictEqual(adv.confidence, 0.7);
});

test('sem origin (linha legada) o contexto continua vindo de source', () => {
  const { classifyLead } = require('../../src/utils/classify');
  const r = classifyLead({ name: 'Nome Generico SA', source: 'advogados criminal DF' }, 'advogados');
  assert.strictEqual(r.area, 'Criminal');
  assert.strictEqual(r.confidence, 0.7);
});

test('categoria oficial do Maps ganha do nome', () => {
  const r = classifyLead({ name: 'Melo & Irmãos', category: 'Advogado trabalhista' });
  assert.deepStrictEqual(r, { area: 'Trabalhista', confidence: 0.95 });
});

test('título do site é a quarta camada', () => {
  const r = classifyLead({ name: 'Studio A', origin: '', site_title: 'Topografia e Agrimensura no DF' }, 'arquitetura');
  assert.strictEqual(r.area, 'Topografia');
  assert.strictEqual(r.confidence, 0.6);
});

test('lead fechado não vira área especial', () => {
  const r = classifyLead({ name: 'Advogado criminal X', closed: true });
  assert.strictEqual(r.area, 'Criminal'); // classificação segue; score é quem desqualifica
});
