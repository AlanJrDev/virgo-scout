// Payload do dashboard por categoria (advogados × arquitetura)
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildPayload } = require('../utils/metrics');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-metrics-'));
fs.writeFileSync(path.join(TMP, 'advogados-df-max.json'), JSON.stringify([
  { name: 'Souza Advocacia Civil', source: 'advogado Brasília DF', address: 'Asa Sul, Brasília - DF', phone: '61999990000', rating: 4.8, reviews: 30 },
]));
fs.writeFileSync(path.join(TMP, 'arquitetura-df-max.json'), JSON.stringify([
  { name: 'Marcos Topografia e Geodésia', address: 'Gama, Brasília - DF', phone: '61988880000' },
]));

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('areas usam o mapa da categoria (arquitetura sem áreas jurídicas)', () => {
  const arq = buildPayload([{ name: 'Marcos Topografia e Geodésia', address: 'Gama' }], { dataDir: TMP, category: 'arquitetura' });
  const labels = arq.areas.map((a) => a.label);
  assert.ok(labels.includes('Topografia'), `labels: ${labels}`);
  assert.ok(labels.every((l) => ['Arquitetura', 'Urbanismo', 'Topografia', 'Outros'].includes(l)), `label inesperado: ${labels}`);
  const adv = buildPayload([{ name: 'Souza Advocacia Civil', source: 'advogado Brasília' }], { dataDir: TMP, category: 'advogados' });
  assert.ok(adv.areas.map((a) => a.label).includes('Civil'));
});

test('top da arquitetura classifica lead sem area gravada', () => {
  const arq = buildPayload([{ name: 'Marcos Topografia e Geodésia', address: 'Gama' }], { dataDir: TMP, category: 'arquitetura' });
  assert.strictEqual(arq.top[0].area, 'Topografia');
});

test('recent e delta filtram arquivos por categoria', () => {
  const adv = buildPayload([], { dataDir: TMP, category: 'advogados' });
  assert.ok(adv.recent.length >= 1);
  assert.ok(adv.recent.every((r) => !r.tag.startsWith('arquitetura')), `recent de advogados misturou: ${JSON.stringify(adv.recent)}`);
  const arq = buildPayload([], { dataDir: TMP, category: 'arquitetura' });
  assert.ok(arq.recent.length === 1 && arq.recent[0].tag.startsWith('arquitetura'));
  // uma captura por categoria → sem delta
  assert.strictEqual(adv.delta_pct, null);
  assert.strictEqual(arq.delta_pct, null);
});
