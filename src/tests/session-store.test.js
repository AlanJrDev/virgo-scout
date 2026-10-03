// Testes do session-store (memória local + Supabase via fetch stubado)
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createSession, getSession, destroySession } = require('../../src/utils/session-store');

const nativeFetch = global.fetch;
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  global.fetch = nativeFetch;
});
after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  global.fetch = nativeFetch;
});

/* ---- modo memória (sem env) ---- */
test('roundtrip em memória: create → get → destroy', async () => {
  const token = await createSession({ email: 'a@b.c', role: 'founder', ttlMs: 60000 });
  assert.ok(token.length >= 32);
  assert.deepStrictEqual(await getSession(token), { email: 'a@b.c', role: 'founder' });
  await destroySession(token);
  assert.strictEqual(await getSession(token), null);
});

test('sessão expirada retorna null', async () => {
  const token = await createSession({ email: 'a@b.c', role: 'founder', ttlMs: -1 });
  assert.strictEqual(await getSession(token), null);
});

test('token desconhecido e token vazio → null', async () => {
  assert.strictEqual(await getSession('nao-existe'), null);
  assert.strictEqual(await getSession(''), null);
  assert.strictEqual(await getSession(undefined), null);
});

/* ---- modo supabase ---- */
test('modo supabase: grava sha256(token) e lê de volta por hash', async () => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (opts.method === 'POST') return { ok: true, status: 201, text: async () => '[]' };
    if (opts.method === 'DELETE') return { ok: true, status: 204, text: async () => '' };
    const hash = new URL(url).searchParams.get('token_hash').replace('eq.', '');
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify([{ token_hash: hash, email: 'a@b.c', role: 'cofounder', exp: new Date(Date.now() + 60000).toISOString() }]),
    };
  };
  try {
    const token = await createSession({ email: 'a@b.c', role: 'cofounder', ttlMs: 60000 });
    const post = calls.find((c) => c.opts.method === 'POST');
    assert.ok(post.url.includes('/rest/v1/sessions'));
    const rows = JSON.parse(post.opts.body);
    const esperado = crypto.createHash('sha256').update(token).digest('hex');
    assert.strictEqual(rows[0].token_hash, esperado);
    assert.ok(!post.opts.body.includes(token), 'token cru não pode ir para o banco');
    const s = await getSession(token);
    assert.deepStrictEqual(s, { email: 'a@b.c', role: 'cofounder' });
    await destroySession(token);
    const del = calls.filter((c) => c.opts.method === 'DELETE').find((c) => c.url.includes('token_hash=eq.'));
    assert.ok(del, 'destroySession deve fazer DELETE por token_hash');
    assert.ok(del.url.includes(`token_hash=eq.${esperado}`));
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
  }
});

test('modo supabase fora do ar → getSession lança SbError 503 (fail-closed)', async () => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await assert.rejects(getSession('abc'), (e) => e.name === 'SbError' && e.status === 503);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
  }
});
