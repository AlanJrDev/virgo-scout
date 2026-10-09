// Testes de marcação de contato no pipeline (contact.js) — fetch stubado
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { markContacted } = require('../utils/contact');
const { SbError } = require('../utils/sb');

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

test('id inválido rejeita antes de tocar o banco', async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, status: 204, text: async () => '' }; };
  await assert.rejects(markContacted('../injection'), (e) => e.code === 'invalid_id');
  await assert.rejects(markContacted(''), (e) => e.code === 'invalid_id');
  await assert.rejects(markContacted(null), (e) => e.code === 'invalid_id');
  assert.strictEqual(called, false);
});

test('marca status contatado + last_contact_at via PATCH no id certo', async () => {
  let seen;
  global.fetch = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 204, text: async () => '' }; };
  await markContacted('a1b2c3d4e5f6');
  assert.strictEqual(seen.url, 'https://x.supabase.co/rest/v1/leads?id=eq.a1b2c3d4e5f6');
  assert.strictEqual(seen.opts.method, 'PATCH');
  const body = JSON.parse(seen.opts.body);
  assert.strictEqual(body.status, 'contatado');
  assert.ok(body.last_contact_at);
});

test('erro do banco propaga como SbError (UI responde sem crashar)', async () => {
  global.fetch = async () => ({ ok: false, status: 400, text: async () => 'PGRST204' });
  await assert.rejects(markContacted('a1b2c3d4e5f6'), (e) => e instanceof SbError && e.code === 'sb_400');
});
