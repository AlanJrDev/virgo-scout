// Testes do batch de enriquecimento (loop com fetch stubado — sem banco real)
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');

const nativeFetch = global.fetch;
const nativeArgv2 = process.argv[2];

const HTML = `<html><head><title>Souza Advocacia Trabalhista — Brasília</title></head>
  <body><a href="mailto:contato@souzadv.com.br">contato</a>
  <a href="https://instagram.com/souzadv">IG</a>
  <a href="https://wa.me/5561999990000">Zap</a>
  <footer>© 2013 Souza Advocacia. Todos os direitos reservados.</footer></body></html>`;
const ROWS = [
  { id: 'a1', website: 'souzadv.com.br' },
  { id: 'b2', website: 'https://outro.com' },
];

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  global.fetch = nativeFetch;
  process.argv[2] = nativeArgv2;
});

test('enrichLeads consulta leads sem enriched_at e PATCHa sinais de cada um', async () => {
  const { main } = require('../../scripts/enrich-leads');
  process.argv[2] = '2';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify(ROWS) };
    }
    return { ok: true, status: 200, text: async () => HTML };
  };
  await main();
  const getCalls = calls.filter((c) => c.url.includes('/rest/v1/leads') && (!c.opts.method || c.opts.method === 'GET'));
  assert.strictEqual(getCalls.length, 1);
  assert.ok(getCalls[0].url.includes('website=not.is.null'), 'filtra leads sem site');
  assert.ok(getCalls[0].url.includes('enriched_at=is.null'), 'é resumível: pula leads já enriquecidos');
  assert.ok(getCalls[0].url.includes('limit=2'), 'limite vem do argv');
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 2);
  assert.ok(patches[0].url.includes('leads?id=eq.a1'));
  assert.ok(patches[1].url.includes('leads?id=eq.b2'));
  const p1 = JSON.parse(patches[0].opts.body);
  assert.strictEqual(p1.email, 'contato@souzadv.com.br');
  assert.strictEqual(p1.instagram, 'souzadv');
  assert.strictEqual(p1.whatsapp_hint, true);
  assert.strictEqual(p1.since_year, 2013);
  assert.ok(p1.site_title.includes('Trabalhista'));
  assert.ok(typeof p1.enriched_at === 'string');
  assert.ok(patches[1].url.includes('id=eq.b2'));
});

test('enrichLeads sem SUPABASE_URL → fail-closed claro', async () => {
  delete process.env.SUPABASE_URL;
  const { main } = require('../../scripts/enrich-leads');
  await assert.rejects(main, /supabase_not_configured/);
});
