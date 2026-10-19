// Testes do backfill de whatsapp (enrich:wa) — fetch stubado, sem banco real
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');

const nativeFetch = global.fetch;

const HTML = `<html><head><title>Souza Advocacia Trabalhista — Brasília</title></head>
  <body><a href="mailto:contato@souzadv.com.br">contato</a>
  <a href="https://instagram.com/souzadv">IG</a>
  <a href="https://wa.me/5561999990000">Zap</a>
  <footer>© 2013 Souza Advocacia. Todos os direitos reservados.</footer></body></html>`;
const HTML_SEM_ZAP = `<html><head><title>Outro Escritorio</title></head>
  <body><a href="mailto:contato@outro.com">contato</a></body></html>`;
const ROWS = [
  { id: 'a1', website: 'souzadv.com.br' },
  { id: 'b2', website: 'https://outro.com' },
];

function stubFetch(rows) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
    }
    return { ok: true, status: 200, text: async () => (url.includes('souzadv') ? HTML : HTML_SEM_ZAP) };
  };
  return calls;
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  global.fetch = nativeFetch;
});

test('enrich:wa consulta leads sem whatsapp e grava só os campos de zap', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = stubFetch(ROWS);
  await main();
  const getCalls = calls.filter((c) => c.url.includes('/rest/v1/leads') && (!c.opts.method || c.opts.method === 'GET'));
  assert.strictEqual(getCalls.length, 1);
  assert.ok(getCalls[0].url.includes('website=not.is.null'), 'filtra leads sem site');
  assert.ok(getCalls[0].url.includes('whatsapp=is.null'), 'só quem ainda não tem zap gravado');
  assert.ok(getCalls[0].url.includes('limit='), 'aceita limite');
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 1, 'só o lead com zap no site leva PATCH');
  assert.ok(patches[0].url.includes('leads?id=eq.a1'));
  const body = JSON.parse(patches[0].opts.body);
  assert.deepStrictEqual(body, { whatsapp: '5561999990000', whatsapp_hint: true, wa_status: 'declared', wa_source: 'site', wa_evidence: 'https://souzadv.com.br' });
  assert.ok(!('enriched_at' in body), 'não mexe em enriched_at');
  assert.ok(!('email' in body), 'não mexe em email');
  assert.ok(!('instagram' in body), 'não mexe em instagram');
});

test('enrich:wa não faz PATCH para lead cujo site não tem zap', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = stubFetch([{ id: 'b2', website: 'https://outro.com' }]);
  await main();
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 0);
});

test('enrich:wa degrada: PATCH 400 colunas wa_ ausentes => instrucao 0010 + erro', async () => {
  const { main } = require('../../scripts/enrich-wa');
  global.fetch = async (url, opts = {}) => {
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_status' column of 'leads' in the schema cache" }) };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'a1', website: 'souzadv.com.br' }]) };
    }
    return { ok: true, status: 200, text: async () => HTML };
  };
  await assert.rejects(main, /wa_status|0010/);
});
