const { test } = require('node:test');
const assert = require('node:assert');
const { markOutcome, ALLOWED } = require('../utils/outcomes');

test('outcome invalido rejeita sem tocar no banco', async () => {
  await assert.rejects(() => markOutcome('abc123', 'zebra'), (e) => e.code === 'invalid_outcome');
});

test('id invalido rejeita', async () => {
  await assert.rejects(() => markOutcome('!!', 'respondeu'), (e) => e.code === 'invalid_id');
});

test('id place_id do google e aceito', async () => {
  const nativeFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_teste';
  let seen;
  global.fetch = async (url) => {
    seen = String(url);
    return { ok: true, status: 204, text: async () => '' };
  };
  try {
    const ok = await markOutcome('0x93598041714d5f3f:0xa0fb283b3e8560b4', 'fechou');
    assert.strictEqual(ok, true);
    assert.ok(seen.includes('id=eq.0x93598041714d5f3f:0xa0fb283b3e8560b4'), seen);
  } finally {
    global.fetch = nativeFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
  }
});

test('id maligno rejeita', async () => {
  await assert.rejects(() => markOutcome('--*!/><script', 'fechou'), (e) => e.code === 'invalid_id');
  await assert.rejects(() => markOutcome('ab$cd', 'fechou'), (e) => e.code === 'invalid_id');
});

test('lista de outcomes esperada', () => {
  assert.deepStrictEqual(ALLOWED, ['novo', 'contatado', 'respondeu', 'reuniao', 'fechou', 'perdeu']);
});
