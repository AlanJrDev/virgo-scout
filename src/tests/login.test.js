// Testes do login (attemptLogin por user-store + session-store)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-auth-'));
process.env.USERS_FILE = path.join(TMP, 'users.json');

const { addUser } = require('../../src/utils/user-store');
const { attemptLogin, sessionUser, newSessionToken, loginAllowed, registerFail, clearFails } = require('../../scripts/serve-web-auth');

before(() => {
  addUser('landevbrasil.ia@gmail.com', 'founder', 'iloveTI@26');
  addUser('contatodylanjunio@gmail.com', 'cofounder', 'cofounder@26');
});
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('credenciais válidas autenticam com papel correto e criam sessão', async () => {
  const r = await attemptLogin({ email: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26', ip: 't1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user, 'landevbrasil.ia@gmail.com');
  assert.strictEqual(r.body.role, 'founder');
  assert.ok(r.token.length >= 32);
  assert.deepStrictEqual(await sessionUser(r.token), { email: 'landevbrasil.ia@gmail.com', role: 'founder' });
  const r2 = await attemptLogin({ email: 'CONTATODYLANJUNIO@gmail.com', pass: 'cofounder@26', ip: 't2' });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.body.role, 'cofounder');
  // TTL: padrão 1 dia, keep = 7 dias
  assert.strictEqual(r.ttlMs, 24 * 60 * 60 * 1000);
  const r3 = await attemptLogin({ email: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26', keep: true, ip: 't2b' });
  assert.strictEqual(r3.ttlMs, 7 * 24 * 60 * 60 * 1000);
});

test('senha errada ou e-mail desconhecido → 401 (sem revelar qual)', async () => {
  assert.strictEqual((await attemptLogin({ email: 'landevbrasil.ia@gmail.com', pass: 'errada', ip: 't3' })).status, 401);
  assert.strictEqual((await attemptLogin({ email: 'ninguem@x.com', pass: 'iloveTI@26', ip: 't4' })).status, 401);
  assert.strictEqual((await attemptLogin({ email: '', pass: '', ip: 't5' })).status, 401);
  assert.strictEqual((await attemptLogin({ email: 'landevbrasil.ia@gmail.com', pass: '', ip: 't6' })).status, 401);
});

test('fail-closed: sem users.json → 503 setup_required', async () => {
  const f = process.env.USERS_FILE;
  fs.renameSync(f, f + '.bak');
  try {
    const r = await attemptLogin({ email: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26', ip: 't7' });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.body.error, 'setup_required');
  } finally {
    fs.renameSync(f + '.bak', f);
  }
});

test('papel desconhecido no arquivo → 401 no login', async () => {
  const parsed = JSON.parse(fs.readFileSync(process.env.USERS_FILE, 'utf8'));
  parsed.users.push({ email: 'ghost@x.com', role: 'root', algo: 'scrypt', salt: 'aGk=', hash: 'aGk=' });
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify(parsed));
  assert.strictEqual((await attemptLogin({ email: 'ghost@x.com', pass: 'qualquer123', ip: 't8' })).status, 401);
});

test('sessionUser devolve null para token inválido/expirado', async () => {
  assert.strictEqual(await sessionUser('token-inexistente'), null);
  assert.strictEqual(await sessionUser(''), null);
  assert.strictEqual(await sessionUser(undefined), null);
});

test('rate-limit: 5 falhas bloqueiam e clearFails libera', () => {
  clearFails('1.2.3.4');
  assert.strictEqual(loginAllowed('1.2.3.4'), true);
  for (let i = 0; i < 5; i++) registerFail('1.2.3.4');
  assert.strictEqual(loginAllowed('1.2.3.4'), false);
  clearFails('1.2.3.4');
  assert.strictEqual(loginAllowed('1.2.3.4'), true);
});

test('tokens de sessão são únicos e não vazios', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.ok(a.length >= 32);
  assert.notStrictEqual(a, b);
});
