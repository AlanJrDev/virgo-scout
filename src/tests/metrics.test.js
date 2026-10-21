// Payload do dashboard por categoria (advogados × arquitetura)
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildPayload, scoreOf, buildTop, buildStats, buildSeries, isMobilePhone } = require('../utils/metrics');

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
  assert.ok(p.pool.find((l) => l.name === 'Completo SA').captured_at); // coluna "Capturado em" ganha dado
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
    { name: 'Contatavel SA', address: 'Asa Sul, Brasília - DF', phone: '61999990000', whatsapp: '5561999990000', rating: 4.8, reviews: 30, website: null, id: 'abc123def456', status: 'contatado' },
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

test('lead sem canal algum é Incontatável mesmo com sinais', () => {
  const { scoreOf } = require('../utils/metrics');
  assert.strictEqual(scoreOf({ rating: 4.9, reviews: 300, instagram: null, email: null }), 0);
  const p = buildPayload([{ name: 'Só IG', instagram: 'xadv', rating: 4.8, reviews: 20 }], { dataDir: TMP, category: 'advogados' });
  assert.notStrictEqual(p.pool[0].badge, 'Incontatável');
});

test('lead fechado desqualifica', () => {
  const p = buildPayload([{ name: 'Fechado ME', phone: '61999990000', closed: true }], { dataDir: TMP, category: 'advogados' });
  assert.strictEqual(p.pool[0].badge, 'Fechado'); assert.strictEqual(p.pool[0].score, 0);
});

test('pool expõe canais e sinais enriquecidos do lead', () => {
  const leads = [
    { name: 'Rico Adv', address: 'Asa Sul, Brasília - DF', phone: '61999990000', rating: 4.7, reviews: 40,
      website: 'https://rico.adv.br', email: 'contato@rico.adv.br', instagram: 'ricoadv',
      whatsapp_hint: true, since_year: 2009, category: 'Cível', closed: false, claimed: false },
  ];
  const p = buildPayload(leads, { dataDir: TMP, category: 'advogados' });
  const l = p.pool[0];
  assert.strictEqual(l.site_url, 'https://rico.adv.br'); // coluna Canais precisa da URL real
  assert.strictEqual(l.email, 'contato@rico.adv.br');
  assert.strictEqual(l.instagram, 'ricoadv');
  assert.strictEqual(l.whatsapp_hint, true);
  assert.strictEqual(l.since_year, 2009);
  assert.strictEqual(l.category, 'Cível');
  assert.strictEqual(l.closed, false);
  assert.strictEqual(l.claimed, false);
  // lead sem enriquecimento: defaults neutros, sem quebrar os campos existentes
  const bare = buildPayload([{ name: 'Puro Adv', address: 'Gama', phone: '61988887777' }], { dataDir: TMP, category: 'advogados' });
  const b = bare.pool[0];
  assert.strictEqual(b.site_url, null);
  assert.strictEqual(b.email, null);
  assert.strictEqual(b.instagram, null);
  assert.strictEqual(b.whatsapp_hint, false);
  assert.strictEqual(b.since_year, null);
  assert.strictEqual(b.category, null);
  assert.strictEqual(b.closed, false);
  assert.strictEqual(b.claimed, false);
  assert.ok(b.site === false && b.phone === true); // campos antigos intactos
});

test('sinais novos somam: email + instagram + não reclamado', () => {
  const { scoreOf } = require('../utils/metrics');
  const base = { phone: '61999990000', rating: 4.0, reviews: 10, website: 'https://x.com' };
  const com = scoreOf({ ...base, email: 'a@b.c', instagram: 'x', claimed: false });
  assert.ok(com > scoreOf(base));
});

test('buildTop expõe types (array) com fallback para source', () => {
  const { buildTop } = require('../utils/metrics');
  const rows = [
    { id: 'a', name: 'Loja A', address: 'Q 1', types: 'tapecaria,estofado', phone: '61999998888', rating: 5, reviews: 10 },
    { id: 'b', name: 'Escritório B', address: 'Q 2', source: 'advogados', phone: '61999997777', rating: 5, reviews: 9 },
    { id: 'c', name: 'Ateliê C', address: 'Q 3', source: 'estofado', phone: '61999996666', rating: 5, reviews: 8 },
  ];
  const top = buildTop(rows, 3);
  const byId = Object.fromEntries(top.map((t) => [t.id, t]));
  assert.deepStrictEqual(byId.a.types, ['tapecaria', 'estofado']);
  assert.deepStrictEqual(byId.b.types, ['advogados']);
  assert.deepStrictEqual(byId.c.types, ['estofado']);
});

test("buildPayload category 'all': area vem do tipo do próprio lead", () => {
  const { buildPayload } = require('../utils/metrics');
  const rows = [
    { id: '1', name: 'Estofados Rio', address: 'Guará, Brasília - DF', source: 'estofado', phone: '61333334444', rating: 4, reviews: 3 },
  ];
  const p = buildPayload(rows, { dataDir: path.join(__dirname, '..', '..', 'data'), category: 'all' });
  const est = p.areas.find((a) => a.label === 'Estofado');
  assert.ok(est, `areas: ${JSON.stringify(p.areas)}`);
  assert.strictEqual(est.value, 1);
  assert.ok(p.top[0].types.includes('estofado'));
});

test("delta 'all' pareia as duas capturas mais recentes da MESMA categoria", () => {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-delta-'));
  try {
    const older = new Date('2026-10-01T12:00:00Z');
    const mid = new Date('2026-10-02T12:00:00Z');
    const newer = new Date('2026-10-03T12:00:00Z');
    const mk = (file, n, t) => {
      const p = path.join(DIR, file);
      fs.writeFileSync(p, JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `L ${i}` }))));
      fs.utimesSync(p, t, t);
    };
    mk('arquitetura-df-2026-09-20.json', 4, older);
    mk('advogados-df-max.json', 3, mid);
    mk('arquitetura-df-max.json', 2, newer);
    const p = buildPayload([], { dataDir: DIR, category: 'all' });
    assert.strictEqual(p.delta_pct, -50, `esperado arquitetura 2×4=-50, veio ${p.delta_pct}`);
    const adv = buildPayload([], { dataDir: DIR, category: 'advogados' });
    assert.strictEqual(adv.delta_pct, null);
    assert.strictEqual(p.recent.length, 3);
  } finally {
    fs.rmSync(DIR, { recursive: true, force: true });
  }
});

test('scoreOf: zap real vale +15', () => {
  const base = { phone: '61999998888', rating: 4, reviews: 10 };
  const comZap = { ...base, whatsapp: '5561999998888' };
  assert.strictEqual(scoreOf(comZap) - scoreOf(base), 15);
});

test('tier ladder: primeiro-match a > b > c > d', () => {
  const rows = [
    { id: '1', name: 'A', phone: '61999998888', whatsapp: '5561999998888' },                    // a: zap real sem site
    { id: '2', name: 'B', phone: '61999998888', whatsapp: '5561999998888', website: 'https://x.com' }, // b: site rebaixa
    { id: '3', name: 'C', phone: '(61) 3222-1234', instagram: '@x' },                           // c: IG
    { id: '4', name: 'D', phone: '(61) 3222-1234' },                                            // d: resto
  ];
  const out = buildTop(rows, 4);
  const byId = Object.fromEntries(out.map((l) => [l.id, l]));
  assert.strictEqual(byId['1'].tier, 'a');
  assert.strictEqual(byId['2'].tier, 'b');
  assert.strictEqual(byId['3'].tier, 'c');
  assert.strictEqual(byId['4'].tier, 'd');
});

test('tier A: sem site + celular (sem zap declarado) é principal; fixo não é', () => {
  const out = buildTop([
    { id: '1', name: 'Cel', phone: '(61) 99999-8888' },
    { id: '2', name: 'Fix', phone: '(61) 3222-1234' },
    { id: '3', name: 'Zap', phone: '(61) 99999-8888', website: 'https://x.com' },
  ], 3);
  const byId = Object.fromEntries(out.map((l) => [l.id, l]));
  assert.strictEqual(byId['1'].tier, 'a');
  assert.strictEqual(byId['2'].tier, 'd');
  assert.strictEqual(byId['3'].tier, 'b');
});

test('wa: zap declarado manda no wa; celular do Maps vira fallback; fixo não vira', () => {
  const out = buildTop([
    { id: '1', name: 'X', phone: '61999998888', whatsapp: '5561999998888' },
    { id: '2', name: 'Y', phone: '61999998888' },
    { id: '3', name: 'F', phone: '(61) 3222-1234' },
  ], 3);
  const byId = Object.fromEntries(out.map((l) => [l.id, l]));
  assert.ok(byId['1'].wa.includes('wa.me/5561999998888'));
  assert.ok(byId['2'].wa.includes('wa.me/5561999998888'));
  assert.strictEqual(byId['2'].wa_mobile, true);
  assert.strictEqual(byId['2'].wa_source, 'maps-celular');
  assert.strictEqual(byId['2'].wa_confidence, 'mobile_phone');
  assert.strictEqual(byId['2'].has_confirmed_wa, false);
  assert.strictEqual(byId['1'].wa_mobile, false);
  assert.strictEqual(byId['3'].wa, null);
  assert.strictEqual(byId['3'].wa_mobile, false);
  assert.strictEqual(byId['3'].phone_link, 'tel:+556132221234');
});

test('phone_link: fixo vira tel:, celular vira wa.me, zap real vira null', () => {
  const out = buildTop([
    { id: '1', name: 'F', phone: '(61) 3222-1234' },
    { id: '2', name: 'M', phone: '(61) 99999-8888' },
    { id: '3', name: 'Z', phone: '61999998888', whatsapp: '5561999998888' },
  ], 3);
  const byId = Object.fromEntries(out.map((l) => [l.id, l]));
  assert.strictEqual(byId['1'].phone_link, 'tel:+556132221234');
  assert.strictEqual(byId['2'].phone_link, 'https://wa.me/5561999998888');
  assert.strictEqual(byId['3'].phone_link, null);
});

test('buildStats: contagens zapReal e tiers', () => {
  const stats = buildStats([
    { phone: '61999998888', whatsapp: '5561999998888' },
    { phone: '61999998888', website: 'https://x.com' },
    { phone: '(61) 3222-1234', instagram: '@x' },
  ]);
  assert.strictEqual(stats.zapReal, 1);
  assert.strictEqual(stats.tierA, 1);
  assert.strictEqual(stats.tierB, 1);
  assert.strictEqual(stats.tierC, 1);
  assert.strictEqual(stats.tierD, 0);
});

const { qualify } = require('../qualify/engine'); // sanity de import no arquivo de teste

test('pool expoe fit/icp/reasons e ordena por fit', () => {
  const leads = [
    { name: 'Forte', reviews: 200, rating: 4.9, whatsapp: '5561999990000', claimed: true },      // sem site, volume
    { name: 'Fraco', reviews: 1, rating: 3.0, website: 'https://x.com' },
  ];
  const p = buildPayload(leads, { dataDir: TMP, category: 'advogados' });
  assert.strictEqual(typeof p.pool[0].fit, 'number');
  assert.ok(Array.isArray(p.pool[0].icp));
  assert.ok(Array.isArray(p.pool[0].reasons));
  assert.strictEqual(p.pool[0].name, 'Forte');       // maior fit primeiro
  assert.ok(p.stats.icpSite >= 1);
  assert.strictEqual(typeof p.stats.avgFit, 'number');
});

test('buildPayload filtra por icp e minFit', () => {
  const leads = [
    { name: 'Site', reviews: 200, whatsapp: '5561999990000', claimed: true },
    { name: 'Sistema', website: 'https://x.com', reviews: 300, whatsapp: '5561999990000' },
  ];
  const p = buildPayload(leads, { dataDir: TMP, category: 'advogados', icp: 'sistema', minFit: 1 });
  assert.strictEqual(p.pool.length, 1);
  assert.strictEqual(p.pool[0].name, 'Sistema');
});

test('buildSeries retorna multi-série coerente com os filtros de oportunidade', () => {
  const now = new Date().toISOString();
  const leads = [
    { name: 'Completa', website: 'x.com', whatsapp: '5561999990001', phone: '5561999990001', rating: 4.8, reviews: 40, captured_at: now },
    { name: 'SiteSemWa', website: 'y.com', rating: 4.6, reviews: 25, captured_at: now },
    { name: 'SemSite', phone: '5561999990002', captured_at: now },
  ];
  const s = buildSeries(leads, Date.now());
  assert.ok(Array.isArray(s.series) && s.series.length >= 6, `series: ${s.series.length}`);
  const byKey = Object.fromEntries(s.series.map((x) => [x.key, x.values]));
  const last = (k) => byKey[k][byKey[k].length - 1];
  assert.strictEqual(last('total'), 3);
  assert.strictEqual(last('comSite'), 2);
  assert.strictEqual(last('semSite'), 1);
  assert.strictEqual(last('comWa'), 1);
  assert.strictEqual(last('alta'), 2);
  assert.strictEqual(last('total'), byKey.total.reduce((a, v) => Math.max(a, v), 0), 'total é acumulado');
  for (const k of ['comSite', 'semSite', 'comWa', 'alta', 'icpSite', 'icpSistema']) {
    assert.ok(last(k) <= last('total'), `${k} <= total`);
    assert.strictEqual(byKey[k].length, s.days.length, `${k} alinhado aos days`);
  }
});

test('buildSeries usa janela adaptativa quando a base é mais velha que 9 dias', () => {
  const D = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const leads = [
    { name: 'Velho', website: 'a.com', captured_at: new Date(now - 60 * D).toISOString() },
    { name: 'Meio', whatsapp: '5561999990003', captured_at: new Date(now - 30 * D).toISOString() },
    { name: 'Novo', captured_at: new Date(now - 2000).toISOString() },
  ];
  const s = buildSeries(leads, now);
  assert.strictEqual(s.days.length, 7);
  assert.strictEqual(s.values[0], 1, 'bucket 0 contém só o lead da era mais antiga');
  assert.ok(s.values[3] >= 2, 'meio da janela já tem 2 eras');
  for (let i = 1; i < s.values.length; i++) assert.ok(s.values[i] >= s.values[i - 1], 'acumulado monotônico');
  assert.strictEqual(s.values[s.values.length - 1], 3);
  const fmt = /^\d{2}\/\d{2}$/;
  assert.ok(s.days.every((d) => fmt.test(d)), `labels dd/MM: ${s.days.join(',')}`);
});

// ---- Fase 2: funil da base (funnelSummary pura) ----
const { funnelSummary } = require('../utils/funnel');

test('funnelSummary: contagens/únicos/evidência/tiers sobre arrays em memória', () => {
  const rows = [
    { id: 'a', website: 'https://x.com', phone: '61999990000', whatsapp: '5561999990000', wa_source: 'site', wa_status: 'declared', wa_evidence_url: 'https://x.com' },
    { id: 'b', website: null, phone: '6132224444', whatsapp: '5561999990000', wa_source: 'site', wa_status: 'declared', claimed: true, rating: 4.8, reviews: 200 }, // mesmo zap de a (lead junto) — único conta 1x
    { id: 'c', website: 'https://y.com', phone: null, whatsapp: null, whatsapp_hint: true, wa_source: 'maps', wa_status: 'suspect' },
    { id: 'd', website: null, phone: null, whatsapp: '123', wa_source: null, wa_status: null, claimed: true, rating: 4.9, reviews: 150 }, // zap cru malformado: NÃO conta (hasWa)
    { id: 'e', website: null, phone: '61988880000', whatsapp: '5561988880000', wa_source: 'instagram', wa_status: 'declared', wa_evidence: 'https://ig.com/p/x/', rating: 3.0, reviews: 5 },
    { id: 'f', website: null, phone: null, whatsapp: null, closed: true }, // fechado: fora de semSites/tiers
  ];
  const s = funnelSummary(rows);
  assert.strictEqual(s.total, 6);
  assert.strictEqual(s.comSite, 2);
  assert.strictEqual(s.comPhone, 3);
  assert.strictEqual(s.comZap, 3, 'a + b + e (d tem zap malformado e não conta)');
  assert.strictEqual(s.zapsUnicos, 2, 'a/b compartilham número; e é outro');
  assert.strictEqual(s.comHint, 1, 'hint sem zap válido: só c');
  assert.strictEqual(s.waStatus.declared, 3);
  assert.strictEqual(s.waStatus.suspect, 1);
  assert.strictEqual(s.waStatus.outro, 2, 'd (null) + f (sem wa_status) => outro (buckets fecham em total=6)');
  assert.strictEqual(s.waStatus.invalid, 0);
  assert.strictEqual(s.waSource.site, 2);
  assert.strictEqual(s.waSource.desconhecido, 2, 'd (null) + f (null)');
  assert.strictEqual(s.waSource.maps, 1);
  assert.strictEqual(s.waSource.instagram, 1);
  assert.strictEqual(s.comEvidence, 2, 'a (wa_evidence_url) + e (wa_evidence DB)');
  assert.strictEqual(s.evidencePct, 67, '2/3');
  assert.strictEqual(s.descobertaPct, 50, '1 zap entre os 2 leads COM site (b/e são de lead sem site)');
  assert.strictEqual(s.semSites.total, 3, 'b + d + e (f fechado fora)');
  assert.strictEqual(s.semSites.tierA, 2, 'b: claimed, 4.8, 200; d: claimed, 4.9, 150');
  assert.strictEqual(s.semSites.tierB, 0, 'e: rating 3.0 < 3.5 e reviews 5 < 20 — fora do A e sem sinais');
});

test('funnelSummary: base vazia e shape completo', () => {
  const s = funnelSummary([]);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.comZap, 0);
  assert.strictEqual(s.descobertaPct, 0);
  assert.strictEqual(s.evidencePct, 0);
  assert.deepStrictEqual(s.semSites, { total: 0, tierA: 0, tierB: 0 });
  assert.deepStrictEqual(Object.keys(s).sort(), ['comEvidence', 'comHint', 'comPhone', 'comSite', 'comZap', 'descobertaPct', 'evidencePct', 'semSites', 'total', 'waSource', 'waStatus', 'zapsUnicos']);
});

test('isMobilePhone: celular BR (13 díg) true; fixo, 0800 e vazio false', () => {
  assert.strictEqual(isMobilePhone('5561992509853'), true); // Sandra Estofados
  assert.strictEqual(isMobilePhone('61992509853'), true); // local 11 dígitos vira 13
  assert.strictEqual(isMobilePhone('(61) 99250-9853'), true); // com máscara
  assert.strictEqual(isMobilePhone('6132724904'), false); // fixo
  assert.strictEqual(isMobilePhone('556132724904'), false); // fixo com 55
  assert.strictEqual(isMobilePhone('0800 000 1000'), false);
  assert.strictEqual(isMobilePhone(''), false);
});

test('buildTop: celular sem zap declarado (Sandra) vira WhatsApp fallback', () => {
  const out = buildTop([{ id: 'sandra', name: 'Sandra Estofados', phone: '61992509853' }], 1);
  const l = out[0];
  assert.ok(l.wa && l.wa.includes('wa.me/5561992509853'), `wa=${l.wa}`);
  assert.strictEqual(l.wa_mobile, true);
  assert.strictEqual(l.has_confirmed_wa, false);
  assert.strictEqual(l.wa_source, 'maps-celular');
  assert.strictEqual(l.wa_confidence, 'mobile_phone');
  assert.strictEqual(l.wa_digits, '5561992509853');
});

test('buildStats: comZapCelular/comZapTotal e fontes do zap declarado', () => {
  const stats = buildStats([
    { phone: '61999998888', whatsapp: '5561999998888', wa_source: 'maps' },
    { phone: '61999997777', whatsapp: '5561999997777', wa_source: 'site' },
    { phone: '61999996666', whatsapp: '5561999996666', wa_source: 'instagram' },
    { phone: '61999995555' }, // celular sem zap declarado → fallback
    { phone: '(61) 3272-4904' }, // fixo → nada
  ]);
  assert.strictEqual(stats.comZap, 3);
  assert.strictEqual(stats.zapReal, 3);
  assert.strictEqual(stats.comZapCelular, 1);
  assert.strictEqual(stats.comZapTotal, 4);
  assert.strictEqual(stats.comZapMaps, 1);
  assert.strictEqual(stats.comZapSiteOficial, 1);
  assert.strictEqual(stats.comZapIg, 1);
  assert.strictEqual(stats.comZapSite, 0);
  assert.strictEqual(stats.comZapHint, 0);
});

test('buildPayload expõe nichos agrupando types (string multi, único por lead, desc)', () => {
  const p = buildPayload([
    { id: '1', name: 'Multi A', address: 'Gama', types: 'advogados,topografia' },
    { id: '2', name: 'Multi B', address: 'Gama', types: 'topografia,estofado' },
    { id: '3', name: 'Dup C', address: 'Gama', types: 'estofado,estofado' },
  ], { dataDir: TMP, category: 'all' });
  assert.deepStrictEqual(p.nichos.map((n) => n.label), ['Estofado', 'Topografia', 'Advogados']);
  assert.deepStrictEqual(p.nichos.map((n) => n.value), [2, 2, 1]);
});
