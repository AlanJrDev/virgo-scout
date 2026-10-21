/* Testes de addUserWithHash e renameEmail (local + dispatcher PostgREST) */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-users-signup-'));
const FILE = path.join(TMP, 'users.json');
process.env.USERS_FILE = FILE;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

const store = require('../../src/utils/user-store');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('addUserWithHash cria usuário local com credencial existente', () => {
  const r = store.addUserWithHash('novo@x.com', 'cofounder', { salt: 'aGVsbG8=', hash: 'aGVsbG8=' });
  assert.deepStrictEqual(r, { email: 'novo@x.com', role: 'cofounder' });
  const u = store.findUser('novo@x.com');
  assert.strictEqual(u.role, 'cofounder');
  assert.strictEqual(u.salt, 'aGVsbG8=');
  assert.strictEqual(u.hash, 'aGVsbG8=');
  assert.strictEqual(u.algo, 'scrypt');
});

test('addUserWithHash valida entrada, duplicidade e credencial ausente', () => {
  assert.throws(() => store.addUserWithHash('ruim', 'founder', { salt: 'x', hash: 'y' }), (e) => e.code === 'invalid_email');
  assert.throws(() => store.addUserWithHash('a@b.com', 'root', { salt: 'x', hash: 'y' }), (e) => e.code === 'invalid_role');
  assert.throws(() => store.addUserWithHash('a@b.com', 'founder'), (e) => e.code === 'invalid_credentials');
  store.addUserWithHash('dup@x.com', 'cofounder', { salt: 'xM=', hash: 'eD0=' });
  assert.throws(() => store.addUserWithHash('dup@x.com', 'founder', { salt: 'xM=', hash: 'eD0=' }), (e) => e.code === 'user_exists');
  const r = store.addUserWithHash('dup@x.com', 'founder', { salt: 'eDE9', hash: 'eDI9' }, { force: true });
  assert.strictEqual(store.findUser('dup@x.com').role, 'founder');
  assert.ok(r.role === 'founder');
});

test('renameEmail local: renomeia, mantém credenciais e respeita colisões', () => {
  store.addUser('orig@x.com', 'founder', 'senha12345');
  const before = store.findUser('orig@x.com');
  const r = store.renameEmail('orig@x.com', 'renomeado@x.com');
  assert.deepStrictEqual(r, { from: 'orig@x.com', to: 'renomeado@x.com', changed: true });
  assert.strictEqual(store.findUser('orig@x.com'), null);
  const after = store.findUser('renomeado@x.com');
  assert.strictEqual(after.role, 'founder');
  assert.strictEqual(after.salt, before.salt);
  assert.strictEqual(store.verifyPassword(after, 'senha12345'), true);
  const r2 = store.renameEmail('inexist@x.com', 'renomeado@x.com');
  assert.strictEqual(r2.changed, false);
  assert.strictEqual(r2.already, true);
});

test('renameEmail local: destino ocupado → email_taken; já aplicado → already', () => {
  store.addUser('a@x.com', 'founder', 'senhaforte1');
  store.addUser('b@x.com', 'cofounder', 'senhaforte2');
  assert.throws(() => store.renameEmail('a@x.com', 'b@x.com'), (e) => e.code === 'email_taken');
  fs.writeFileSync(FILE, JSON.stringify({
    version: 1,
    users: [{ email: 'velho@x.com', role: 'founder', algo: 'scrypt', salt: 'wM=', hash: 'dw==' }],
  }));
  const r = store.renameEmail('apagado@x.com', 'velho@x.com');
  assert.deepStrictEqual(r, { from: 'apagado@x.com', to: 'velho@x.com', changed: false, already: true });
});

test('dispatcher: com SUPABASE, addUserWithHash/renameEmail vão ao PostgREST', async () => {
  const nativeFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  const reqs = [];
  let created = false;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    reqs.push({ method: init.method || 'GET', url: u, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST') created = true;
    const rows = u.includes('eq.remoto%40x.com') && created ? [{ email: 'remoto@x.com', role: 'cofounder' }] : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
  };
  try {
    await store.addUserWithHash('remoto@x.com', 'cofounder', { salt: 'c2FsdA==', hash: 'aGFzaA==' });
    const post = reqs.find((r) => r.method === 'POST');
    assert.ok(post && post.url.includes('/rest/v1/users'));
    assert.strictEqual(post.body[0].email, 'remoto@x.com');
    assert.strictEqual(post.body[0].salt, 'c2FsdA==');
    const r = await store.renameEmail('remoto@x.com', 'renomeado@x.com');
    assert.strictEqual(r.changed, true);
    const patch = reqs.find((req) => req.method === 'PATCH');
    assert.ok(patch && patch.url.includes('/rest/v1/users?email=eq.remoto%40x.com'));
    assert.strictEqual(patch.body.email, 'renomeado@x.com');
    const del = reqs.find((req) => req.method === 'DELETE' && req.url.includes('/rest/v1/sessions?email=eq.remoto%40x.com'));
    assert.ok(del, 'rename invalida sessões do e-mail antigo');
    assert.strictEqual(r.sessions_cleared, true);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    global.fetch = nativeFetch;
  }
});
