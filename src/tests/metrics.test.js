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

test('payload ganha quality (completude) e pool com a base completa', () => {
  const leads = [
    { name: 'Completo SA', address: 'Rua 1, Brasilia', phone: '61999999999', website: 'https://x.com', rating: 4.8, reviews: 10, captured_at: '2026-10-01T00:00:00.000Z' },
    { name: 'Sem Nada ME', address: '', phone: null, website: null, rating: null, reviews: null },
    { name: 'Quase La Ltda', address: 'Quadra 2', phone: null, website: 'https://y.com', rating: 4.0, reviews: 3 },
  ];
  const p = buildPayload(leads, { dataDir: TMP, category: 'advogados' });
  assert.strictEqual(p.pool.length, 3); // pool = base completa (antes cap 30)
  assert.ok(p.pool[0].captured_at); // coluna "Capturado em" ganha dado
  const q = p.quality;
  assert.strictEqual(q.semTelefone, 2);
  assert.strictEqual(q.semSite, 1);
  assert.strictEqual(q.semAvaliacao, 1);
  assert.strictEqual(q.semEndereco, 1);
  // 4 checks x 3 leads = 12; faltam 5 (L2: 4, L3: telefone) => 7/12 = 58%
  assert.strictEqual(q.completude, 58);
});

test('região da categoria usa origin quando source é tag', () => {
  const p = buildPayload([{ name: 'Esc Topo', address: 'Rua Sem DF', source: 'arquitetura', origin: 'topografia Gama' }], { dataDir: TMP, category: 'arquitetura' });
  assert.strictEqual(p.regions[0].label, 'Gama');
});

test('score reflete contatabilidade: sem telefone = 0, sem site soma', () => {
  const { scoreOf } = require('../utils/metrics');
  // incontatável zera, mesmo com reputação excelente
  assert.strictEqual(scoreOf({ rating: 5, reviews: 500 }), 0);
  // mesmo lead: sem site pontua acima (é a oportunidade do produto)
  const sem = scoreOf({ phone: '61999990000', rating: 4.5, reviews: 30, website: null });
  const com = scoreOf({ phone: '61999990000', rating: 4.5, reviews: 30, website: 'https://x.com' });
  assert.ok(sem > com, `sem=${sem} com=${com}`);
  // contatável com boa reputação chega ao topo
  assert.ok(scoreOf({ phone: '61999990000', rating: 4.8, reviews: 200 }) >= 80);
});

test('pool marca Incontatável e carrega id/status do pipeline', () => {
  const leads = [
    { name: 'Contatavel SA', address: 'Asa Sul, Brasília - DF', phone: '61999990000', rating: 4.8, reviews: 30, website: null, id: 'abc123def456', status: 'contatado' },
    { name: 'Fantasma MEI', address: '', phone: null, rating: 5, reviews: 900, website: null },
  ];
  const p = buildPayload(leads, { dataDir: TMP, category: 'advogados' });
  const a = p.pool.find((l) => l.name === 'Contatavel SA');
  const b = p.pool.find((l) => l.name === 'Fantasma MEI');
  assert.strictEqual(a.id, 'abc123def456');
  assert.strictEqual(a.status, 'contatado');
  assert.ok(a.badge === 'Alta' || a.badge === 'Média', 'contatável não é Incontatável');
  assert.ok(a.wa.includes('wa.me'));
  assert.ok(a.wa.includes('Virgo%20Tech')); // mensagem personalizada no link
  assert.strictEqual(b.badge, 'Incontatável');
  assert.strictEqual(b.score, 0);
  // qualificado = telefone + sem site + nota 4,5 (a inversão da estratégia)
  assert.strictEqual(p.stats.qualif, 1);
});
