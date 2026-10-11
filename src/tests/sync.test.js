// Testes do sync de leads → Supabase (fetch stubado)
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-sync-'));
fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify([
  { name: '  Advogado  Teste ', address: 'Rua A, 1 — Brasília', rating: 4.5, reviews: 10, phone: '619999', website: null, source: 'q', area: 'Civil', area_conf: 0.8, captured_at: '2026-10-01T00:00:00.000Z' },
  { name: 'Outro Escritório', address: 'Quadra B', rating: null, reviews: null, phone: null, website: 'https://x.com', source: 'q', area: 'Família', area_conf: 0.7, captured_at: '2026-10-01T00:00:00.000Z' },
]));

const nativeFetch = global.fetch;
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
});
after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  global.fetch = nativeFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('leadId é estável e normaliza espaços/caixa', () => {
  const { leadId, norm } = require('../../scripts/sync-supabase');
  assert.strictEqual(norm('  Advogado  Teste '), 'advogado teste');
  const a = leadId({ name: '  Advogado  Teste ', address: 'Rua A' });
  const b = leadId({ name: 'advogado teste', address: 'rua a' });
  assert.strictEqual(a, b);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test('syncLeads faz upsert em batch e registra captures', async () => {
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 201, text: async () => '' };
  };
  const r = await syncLeads({ dataDir: TMP, runBuild: false });
  assert.strictEqual(r.synced, 2);
  const leadsCall = calls.find((c) => c.url.includes('/rest/v1/leads') && c.opts.method === 'POST');
  assert.ok(leadsCall.url.includes('on_conflict=id'));
  assert.strictEqual(leadsCall.opts.method, 'POST');
  assert.strictEqual(leadsCall.opts.headers.Prefer, 'resolution=merge-duplicates');
  const rows = JSON.parse(leadsCall.opts.body);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, '  Advogado  Teste ');
  assert.match(rows[0].id, /^[0-9a-f]{40}$/);
  assert.strictEqual(rows[0].rating, 4.5);
  assert.strictEqual(rows[1].rating, null);
  const capCall = calls.find((c) => c.url.includes('/rest/v1/captures'));
  const cap = JSON.parse(capCall.opts.body);
  assert.strictEqual(cap[0].status, 'done');
  assert.strictEqual(cap[0].leads_count, 2);
});

test('syncLeads sem env configurado → erro claro', async () => {
  delete process.env.SUPABASE_URL;
  const { syncLeads } = require('../../scripts/sync-supabase');
  await assert.rejects(syncLeads({ dataDir: TMP, runBuild: false }), /SUPABASE_URL/);
});

test('toRow normaliza números brasileiros (rating "4,5", reviews "1.234")', () => {
  const { toRow } = require('../../scripts/sync-supabase');
  const r = toRow({ name: 'X', address: 'Y', rating: '4,5', reviews: '1.234', area_conf: '0,8' });
  assert.strictEqual(r.rating, 4.5);
  assert.strictEqual(r.reviews, 1234);
  assert.strictEqual(r.area_conf, 0.8);
  const r2 = toRow({ name: 'X', rating: 4.2, reviews: 10, area_conf: 0.75 });
  assert.strictEqual(r2.rating, 4.2);
  assert.strictEqual(r2.reviews, 10);
  const r3 = toRow({ name: 'X', rating: 'n/a', reviews: '', area_conf: null });
  assert.strictEqual(r3.rating, null);
  assert.strictEqual(r3.reviews, null);
  assert.strictEqual(r3.area_conf, null);
});

test('toRow mapeia novos campos de enriquecimento (lat BR, claimed, photos, closed)', () => {
  const { toRow } = require('../../scripts/sync-supabase');
  const r = toRow({ name: 'X', address: 'Y', category: 'Advogado trabalhista', lat: '-15,79', lng: '-47,88',
    place_id: '0x935a3b:0x1', claimed: false, hours: 'Aberto ⋅ Fecha 18:00', photos: '12',
    closed: true, instagram: 'https://instagram.com/xadv', facebook: 'https://facebook.com/xadv' });
  assert.strictEqual(r.category, 'Advogado trabalhista');
  assert.strictEqual(r.lat, -15.79);
  assert.strictEqual(r.lng, -47.88);
  assert.strictEqual(r.place_id, '0x935a3b:0x1');
  assert.strictEqual(r.claimed, false);
  assert.strictEqual(r.hours, 'Aberto ⋅ Fecha 18:00');
  assert.strictEqual(r.photos, 12);
  assert.strictEqual(r.closed, true);
  assert.strictEqual(r.instagram, 'https://instagram.com/xadv');
  assert.strictEqual(r.facebook, 'https://facebook.com/xadv');
  const r2 = toRow({ name: 'X', claimed: 'x', closed: undefined, photos: 'n/a', lat: '', instagram: '' });
  assert.strictEqual(r2.claimed, null);
  assert.strictEqual(r2.closed, false);
  assert.strictEqual(r2.photos, null);
  assert.strictEqual(r2.lat, null);
  assert.strictEqual(r2.instagram, null);
  assert.strictEqual(r2.category, null);
});

test('batching: 1346 leads → 3 requisições (500+500+346)', async () => {
  const big = Array.from({ length: 1346 }, (_, i) => ({ name: `Lead ${i}`, address: `End ${i}` }));
  fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify(big));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  const r = await syncLeads({ dataDir: TMP, runBuild: false });
  assert.strictEqual(r.synced, 1346);
  const leadCalls = calls.filter((c) => c.url.includes('/rest/v1/leads') && c.opts.method === 'POST');
  assert.strictEqual(leadCalls.length, 3);
  assert.strictEqual(JSON.parse(leadCalls[0].opts.body).length, 500);
  assert.strictEqual(JSON.parse(leadCalls[2].opts.body).length, 346);
});

test('newestLeadsFile por categoria: arquitetura e advogados isolados', () => {
  const { newestLeadsFile } = require('../../src/utils/leads-io');
  fs.writeFileSync(path.join(TMP, 'arquitetura-df-max.json'), JSON.stringify([{ name: 'Esc Arq', address: 'Rua 1' }]));
  const arq = newestLeadsFile(TMP, 'arquitetura');
  assert.ok(arq && arq.endsWith('arquitetura-df-max.json'), `esperava arq, veio ${arq}`);
  const adv = newestLeadsFile(TMP, 'advogados');
  assert.ok(adv && !adv.includes('arquitetura'), `advogados pegou arquivo de arquitetura: ${adv}`);
  assert.ok(adv.endsWith('leads-teste.v2.json'));
  assert.ok(newestLeadsFile(TMP, 'advogados') === adv);
});

test('syncLeads categoria arquitetura: tag em source, query em origin', async () => {
  fs.writeFileSync(path.join(TMP, 'arquitetura-df-max.json'), JSON.stringify([{ name: 'Esc Arq', address: 'Rua 1', source: 'topografia Gama' }]));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  const r = await syncLeads({ dataDir: TMP, category: 'arquitetura', runBuild: false });
  assert.strictEqual(r.synced, 1);
  const leadCall = calls.find((c) => c.url.includes('/rest/v1/leads') && c.opts.method === 'POST');
  const rows = JSON.parse(leadCall.opts.body);
  assert.strictEqual(rows[0].name, 'Esc Arq');
  assert.strictEqual(rows[0].source, 'arquitetura');
  assert.strictEqual(rows[0].origin, 'topografia Gama');
});

test('syncLeads categoria advogados: tag em source, query em origin', async () => {
  fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify([{ name: 'Adv Teste', address: 'Rua A', source: 'advogados Distrito Federal' }]));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  await syncLeads({ dataDir: TMP, category: 'advogados', runBuild: false });
  const leadCalls = calls.filter((c) => c.url.includes('/rest/v1/leads') && c.opts.method === 'POST');
  const firstRow = JSON.parse(leadCalls[0].opts.body)[0];
  assert.strictEqual(firstRow.source, 'advogados');
  assert.strictEqual(firstRow.origin, 'advogados Distrito Federal');
});

test('toRow grava origin e normaliza telefone/endereço BR', () => {
  const { toRow, normPhone } = require('../../scripts/sync-supabase');
  const r = toRow({ name: 'X', address: '  Rua   A , 10 ', source: 'advogados DF', phone: '55 (61) 98144-7373' });
  assert.strictEqual(r.origin, 'advogados DF');
  assert.strictEqual(r.phone, '61981447373');
  assert.strictEqual(r.address, 'Rua A , 10');
  assert.strictEqual(normPhone('061 98144-7373'), '61981447373');
  assert.strictEqual(normPhone('+55 61 99999-9999'), '61999999999');
  assert.strictEqual(normPhone('12345'), '12345'); // inválido: não degrada
  assert.strictEqual(normPhone(null), null);
  assert.strictEqual(toRow({ name: 'Y' }).origin, null);
});

test('dedupe por id (nome+endereço) mantém a linha mais rica', async () => {
  fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify([
    { name: 'Mesmo Escritório', address: 'Rua A', rating: 4.0, reviews: 5, phone: null, website: null, source: 'q' },
    { name: 'mesmo escritório', address: 'rua a', rating: 4.8, reviews: 100, phone: '61999999999', website: 'https://r.com', source: 'q' },
    { name: 'Outro', address: 'Rua B', rating: 3, reviews: 1, source: 'q' },
  ]));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  const r = await syncLeads({ dataDir: TMP, runBuild: false });
  assert.strictEqual(r.synced, 2);
  assert.strictEqual(r.deduped, 1);
  const rows = JSON.parse(calls.find((c) => c.url.includes('/rest/v1/leads') && c.opts.method === 'POST').opts.body);
  assert.strictEqual(rows.length, 2);
  const keeper = rows.find((x) => /mesmo/i.test(x.name));
  assert.strictEqual(keeper.reviews, 100);
  assert.strictEqual(keeper.website, 'https://r.com');
  const cap = JSON.parse(calls.find((c) => c.url.includes('/rest/v1/captures')).opts.body);
  assert.strictEqual(cap[0].leads_count, 2);
});

test('descarta artefato de paginação do Maps (nome vazio ou Resultados)', async () => {
  fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify([
    { name: 'Resultados', address: '' },
    { name: '  ', address: 'Rua Z' },
    { name: 'Advogado Real', address: 'Rua A' },
  ]));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  const r = await syncLeads({ dataDir: TMP, runBuild: false });
  assert.strictEqual(r.synced, 1);
  const rows = JSON.parse(calls.find((c) => c.url.includes('/rest/v1/leads') && c.opts.method === 'POST').opts.body);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Advogado Real');
});

test('placeIdOrHash prefere place_id e cai para sha1', () => {
  const { placeIdOrHash, leadId } = require('../../scripts/sync-supabase');
  const a = { name: 'Loja', address: 'Rua A', place_id: '0x1:0x9' };
  const b = { name: 'Loja', address: 'Rua A' };
  assert.strictEqual(placeIdOrHash(a), '0x1:0x9');
  assert.strictEqual(placeIdOrHash(b), leadId(b));
});

test('toRow carrega whatsapp do Maps (dígitos) e preserva null', () => {
  const { toRow } = require('../../scripts/sync-supabase');
  const r1 = toRow({ name: 'Loja', address: 'Q 1', source: 'tapecaria', whatsapp: '+55 (61) 99863-8116' });
  assert.strictEqual(r1.whatsapp, '5561998638116');
  const r2 = toRow({ name: 'Loja', address: 'Q 2', source: 'tapecaria' });
  assert.strictEqual(r2.whatsapp, null);
});

test('planUpsert: negócio novo vira insert', () => {
  const { planUpsert, toRow } = require('../../scripts/sync-supabase');
  const nr = toRow({ name: 'Nova', address: 'Rua B', source: 'tapecaria' });
  nr.types = 'tapecaria';
  const plan = planUpsert([nr], []);
  assert.strictEqual(plan.inserts.length, 1);
  assert.strictEqual(plan.patches.length, 0);
  assert.strictEqual(plan.deletes.length, 0);
});

test('planUpsert: existente com mesmo place_id ganha patch não-degradante + types unidos', () => {
  const { planUpsert, toRow } = require('../../scripts/sync-supabase');
  const novo = toRow({ name: 'Loja Y', address: 'QI 1', source: 'estofado', phone: '', rating: '4,8', reviews: '12' });
  novo.place_id = '0x2:0x9';
  novo.types = 'estofado';
  const existente = { id: '0x2:0x9', place_id: '0x2:0x9', types: 'tapecaria', source: 'tapecaria' };
  const plan = planUpsert([novo], [existente]);
  assert.strictEqual(plan.inserts.length, 0);
  const p = plan.patches[0];
  assert.strictEqual(p.id, '0x2:0x9');
  assert.strictEqual(p.set.types, 'estofado,tapecaria');
  assert.strictEqual(p.set.phone, undefined);          // null não degrada
  assert.strictEqual(p.set.rating, 4.8);               // valor novo entra
  assert.strictEqual(p.set.source, 'estofado');        // proveniência atualiza
  assert.ok(!('status' in p.set));                     // status intocado
  assert.deepStrictEqual(plan.deletes, []);
});

test('planUpsert: row sha1 antigo do mesmo lugar migra o id para place_id e órfão é deletado', () => {
  const { planUpsert, toRow, leadId } = require('../../scripts/sync-supabase');
  const novo = toRow({ name: 'Loja Z', address: 'SAAN', source: 'tapecaria' });
  novo.place_id = '0x3:0x9';
  novo.types = 'tapecaria';
  const antigo = { id: leadId({ name: 'Loja Z', address: 'SAAN' }), place_id: null, types: 'advogados', source: 'advogados' };
  const plan = planUpsert([novo], [antigo]);
  assert.strictEqual(plan.patches[0].id, antigo.id);
  assert.strictEqual(plan.patches[0].set.id, '0x3:0x9');
  assert.strictEqual(plan.patches[0].set.types, 'advogados,tapecaria');
  assert.deepStrictEqual(plan.deletes, []);
});
