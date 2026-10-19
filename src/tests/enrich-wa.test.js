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

test('enrich:wa consulta leads sem whatsapp (com cooldown 0011) e grava zap + tracking', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = stubFetch(ROWS);
  await main();
  const getCalls = calls.filter((c) => c.url.includes('/rest/v1/leads') && (!c.opts.method || c.opts.method === 'GET'));
  assert.strictEqual(getCalls.length, 1);
  assert.ok(getCalls[0].url.includes('website=not.is.null'), 'filtra leads sem site');
  assert.ok(getCalls[0].url.includes('whatsapp=is.null'), 'só quem ainda não tem zap gravado');
  assert.ok(getCalls[0].url.includes('wa_attempts=lt.6'), 'cap de tentativas (0011)');
  assert.ok(getCalls[0].url.includes('or=(wa_last_try.is.null,wa_last_try.lte.'), 'cooldown 7d na fila');
  assert.ok(getCalls[0].url.includes('wa_attempts'), 'select traz wa_attempts p/ tracking');
  assert.ok(getCalls[0].url.includes('limit='), 'aceita limite');
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 1, 'UM PATCH por lead com zap');
  assert.ok(patches[0].url.includes('leads?id=eq.a1'));
  const body = JSON.parse(patches[0].opts.body);
  const { wa_attempts, wa_last_try, ...lead } = body;
  assert.strictEqual(wa_attempts, 1);
  assert.ok(typeof wa_last_try === 'string' && wa_last_try.endsWith('Z'), 'tracking wa_last_try em ISO');
  assert.deepStrictEqual(lead, { whatsapp: '5561999990000', whatsapp_hint: true, wa_status: 'declared', wa_source: 'site', wa_evidence: 'https://souzadv.com.br' });
  assert.ok(!('enriched_at' in body), 'não mexe em enriched_at');
  assert.ok(!('email' in body), 'não mexe em email');
  assert.ok(!('instagram' in body), 'não mexe em instagram');
});

test('enrich:wa lead sem nada: PATCH só de tracking (attempts avança, cooldown anda)', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = stubFetch([{ id: 'b2', website: 'https://outro.com' }]);
  await main();
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 1, 'PATCH incondicional de tracking');
  assert.ok(patches[0].url.includes('leads?id=eq.b2'));
  const body = JSON.parse(patches[0].opts.body);
  assert.strictEqual(body.wa_attempts, 1);
  assert.ok(typeof body.wa_last_try === 'string');
  assert.ok(!('whatsapp' in body), 'não grava zap');
  assert.ok(!('whatsapp_hint' in body), 'sem hint');
  assert.ok(!('wa_status' in body) && !('wa_source' in body), 'nada de marcação wa_*');
});

test('enrich:wa zap de página interna: PATCH único com evidence da interna', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'i9', website: 'https://interna.com', wa_attempts: 2 }]) };
    }
    if (String(url).includes('contato')) return { url, ok: true, status: 200, text: async () => '</html><body><a href="https://wa.me/5561999888000">Zap</a></body></html>' };
    return { url, ok: true, status: 200, text: async () => '<html><body><a href="/contato">Contato</a></body></html>' };
  };
  await main();
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 1, 'UM patch por lead');
  assert.ok(patches[0].url.includes('leads?id=eq.i9'));
  const body = JSON.parse(patches[0].opts.body);
  assert.strictEqual(body.whatsapp, '5561999888000');
  assert.strictEqual(body.wa_evidence, 'https://interna.com/contato', 'evidence = wa_evidence_url da página interna onde o zap foi achado');
  assert.strictEqual(body.wa_source, 'site');
  assert.strictEqual(body.wa_attempts, 3, 'r.wa_attempts 2 + 1');
  assert.ok(typeof body.wa_last_try === 'string');
});

test('enrich:wa texto corrido com wa (sem link declarado): PATCH hint-only', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'h1', website: 'https://hint.com' }]) };
    }
    return { url, ok: true, status: 200, text: async () => '<html><body><p>manda mensagem no wa.me/5561999990000</p></body></html>' };
  };
  await main();
  const body = JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body);
  assert.deepStrictEqual({ ...body, wa_last_try: 'x' }, { whatsapp_hint: true, wa_attempts: 1, wa_last_try: 'x' }, 'PATCH exato: tracking + hint, SEM whatsapp');
});

test('enrich:wa wa declarado inválido (invalid_ddd): patch só tracking, SEM hint', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'v1', website: 'https://inv.com' }]) };
    }
    return { url, ok: true, status: 200, text: async () => '<html><body><a href="https://wa.me/5508999990000">Zap</a></body></html>' };
  };
  await main();
  const body = JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body);
  assert.strictEqual(body.wa_attempts, 1);
  assert.ok(typeof body.wa_last_try === 'string');
  assert.ok(!('whatsapp' in body), 'número lixo não grava');
  assert.ok(!('whatsapp_hint' in body), 'SEM hint (decisão G)');
  assert.ok(!('wa_status' in body) && !('wa_source' in body));
});

test('enrich:wa degrada: GET 400 wa_attempts ausente => instrucao 0011 + erro', async () => {
  const { main } = require('../../scripts/enrich-wa');
  global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_attempts' column of 'leads' in the schema cache" }) });
  await assert.rejects(main, /wa_attempts|0011/);
});

test('enrich:wa degrada: PATCH 400 wa_last_try ausente => instrucao 0011 + erro', async () => {
  const { main } = require('../../scripts/enrich-wa');
  global.fetch = async (url, opts = {}) => {
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_last_try' column of 'leads' in the schema cache" }) };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'a1', website: 'souzadv.com.br' }]) };
    }
    return { ok: true, status: 200, text: async () => HTML };
  };
  await assert.rejects(main, /wa_last_try|0011/);
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
