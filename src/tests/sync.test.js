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
  const leadsCall = calls.find((c) => c.url.includes('/rest/v1/leads'));
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

test('batching: 1346 leads → 3 requisições (500+500+346)', async () => {
  const big = Array.from({ length: 1346 }, (_, i) => ({ name: `Lead ${i}`, address: `End ${i}` }));
  fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify(big));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  const r = await syncLeads({ dataDir: TMP, runBuild: false });
  assert.strictEqual(r.synced, 1346);
  const leadCalls = calls.filter((c) => c.url.includes('/rest/v1/leads'));
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

test('syncLeads categoria arquitetura: lê arquivo arq e grava source=arquitetura', async () => {
  fs.writeFileSync(path.join(TMP, 'arquitetura-df-max.json'), JSON.stringify([{ name: 'Esc Arq', address: 'Rua 1', source: 'topografia Gama' }]));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  const r = await syncLeads({ dataDir: TMP, category: 'arquitetura', runBuild: false });
  assert.strictEqual(r.synced, 1);
  const leadCall = calls.find((c) => c.url.includes('/rest/v1/leads'));
  const rows = JSON.parse(leadCall.opts.body);
  assert.strictEqual(rows[0].name, 'Esc Arq');
  assert.strictEqual(rows[0].source, 'arquitetura');
});

test('syncLeads categoria advogados preserva a query no source', async () => {
  fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify([{ name: 'Adv Teste', address: 'Rua A', source: 'advogados Distrito Federal' }]));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  await syncLeads({ dataDir: TMP, category: 'advogados', runBuild: false });
  const leadCalls = calls.filter((c) => c.url.includes('/rest/v1/leads'));
  const firstRow = JSON.parse(leadCalls[0].opts.body)[0];
  assert.strictEqual(firstRow.source, 'advogados Distrito Federal');
});
