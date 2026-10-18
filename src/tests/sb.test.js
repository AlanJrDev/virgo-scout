// Testes do cliente PostgREST (sb.js) — fetch stubado
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { sbEnabled, sbFetch, SbError } = require('../../src/utils/sb');

const nativeFetch = global.fetch;
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_teste';
});
after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  global.fetch = nativeFetch;
});

test('sbEnabled reflete as envs', () => {
  assert.strictEqual(sbEnabled(), true);
  delete process.env.SUPABASE_URL;
  assert.strictEqual(sbEnabled(), false);
  process.env.SUPABASE_URL = 'https://x.supabase.co';
});

test('sem env → SbError 503 supabase_not_configured', async () => {
  delete process.env.SUPABASE_URL;
  await assert.rejects(sbFetch('users'), (e) => e instanceof SbError && e.status === 503 && e.message === 'supabase_not_configured');
});

test('monta URL, headers de secret e parseia JSON', async () => {
  let seen;
  global.fetch = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, text: async () => '[{"email":"a@b.c"}]' };
  };
  const rows = await sbFetch('users?select=*');
  assert.strictEqual(seen.url, 'https://x.supabase.co/rest/v1/users?select=*');
  assert.strictEqual(seen.opts.method, 'GET');
  assert.strictEqual(seen.opts.headers.apikey, 'sb_secret_teste');
  assert.strictEqual(seen.opts.headers.Authorization, 'Bearer sb_secret_teste');
  assert.deepStrictEqual(rows, [{ email: 'a@b.c' }]);
});

test('com body: serializa e envia Prefer de representação; header do chamador ganha', async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(opts);
    return { ok: true, status: 201, text: async () => '[]' };
  };
  await sbFetch('leads?on_conflict=id', { method: 'POST', body: [{ id: '1' }] });
  assert.strictEqual(calls[0].body, '[{"id":"1"}]');
  assert.strictEqual(calls[0].headers.Prefer, 'return=representation');
  await sbFetch('leads?on_conflict=id', {
    method: 'POST', body: [{ id: '1' }],
    headers: { Prefer: 'resolution=merge-duplicates' },
  });
  assert.strictEqual(calls[1].headers.Prefer, 'resolution=merge-duplicates');
});

test('erro de rede → SbError 503 supabase_down', async () => {
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(sbFetch('users'), (e) => e instanceof SbError && e.status === 503 && e.code === 'supabase_down');
});

test('HTTP >= 500 vira 503; 4xx preserva status; 204 e corpo vazio viram null', async () => {
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(sbFetch('users'), (e) => e.status === 503 && e.code === 'supabase_down');
  global.fetch = async () => ({ ok: false, status: 404, text: async () => 'PGRST205' });
  await assert.rejects(sbFetch('users'), (e) => e.status === 404 && e.code === 'sb_404');
  global.fetch = async () => ({ ok: true, status: 204, text: async () => '' });
  assert.strictEqual(await sbFetch('users', { method: 'DELETE' }), null);
  global.fetch = async () => ({ ok: true, status: 201, text: async () => '' });
  assert.strictEqual(await sbFetch('users', { method: 'POST', body: [] }), null);
});

test('sbFetchAll pagina com limit/offset até buscar todos (teto de 1000 do PostgREST)', async () => {
  const { sbFetchAll } = require('../../src/utils/sb');
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const m = String(url).match(/offset=(\d+)/);
    const off = m ? parseInt(m[1], 10) : 0;
    const n = off === 0 ? 1000 : 40;
    return { ok: true, status: 200, text: async () => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: off + i }))) };
  };
  const all = await sbFetchAll('leads?select=*&order=id');
  assert.strictEqual(all.length, 1040);
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].includes('limit=1000') && calls[0].includes('offset=0'), calls[0]);
  assert.ok(calls[1].includes('offset=1000'), calls[1]);
});

test('SbError 4xx anexa o corpo do PostgREST (prefixo sb_<status> e code estáveis)', async () => {
  global.fetch = async () => ({
    ok: false, status: 400,
    text: async () => JSON.stringify({ message: 'column captures.category does not exist', code: '42703' }),
  });
  await assert.rejects(
    sbFetch('captures', { method: 'POST', body: [{}] }),
    (e) => e instanceof SbError
      && e.status === 400
      && e.code === 'sb_400'
      && String(e.message).startsWith('sb_400 :: column captures.category does not exist')
  );
  // corpo não-JSON: apenda cru, truncado
  global.fetch = async () => ({ ok: false, status: 400, text: async () => 'x'.repeat(2000) });
  await assert.rejects(sbFetch('users'), (e) => {
    assert.strictEqual(e.code, 'sb_400');
    assert.strictEqual(String(e.message).length, 10 + 300); // 'sb_400 :: ' (10) + 300 chars truncados
    return true;
  });
});
