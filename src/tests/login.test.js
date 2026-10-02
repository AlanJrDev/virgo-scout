// Testes do login (autenticação por user-store + sessões)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-auth-'));
process.env.USERS_FILE = path.join(TMP, 'users.json');

const { addUser } = require('../../src/utils/user-store');
const { authenticate, newSessionToken, loginAllowed, registerFail, clearFails } = require('../../scripts/serve-web-auth');

before(() => {
  addUser('landevbrasil.ia@gmail.com', 'founder', 'iloveTI@26');
  addUser('contatodylanjunio@gmail.com', 'cofounder', 'cofounder@26');
});
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('credenciais válidas autenticam com o papel correto', () => {
  const r = authenticate('landevbrasil.ia@gmail.com', 'iloveTI@26');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.user, { email: 'landevbrasil.ia@gmail.com', role: 'founder' });
  const r2 = authenticate('CONTATODYLANJUNIO@gmail.com', 'cofounder@26');
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.user.role, 'cofounder');
});

test('senha errada ou e-mail desconhecido → 401 (sem revelar qual)', () => {
  assert.strictEqual(authenticate('landevbrasil.ia@gmail.com', 'errada').status, 401);
  assert.strictEqual(authenticate('ninguem@x.com', 'iloveTI@26').status, 401);
  assert.strictEqual(authenticate('', '').status, 401);
  assert.strictEqual(authenticate('landevbrasil.ia@gmail.com', '').status, 401);
});

test('fail-closed: sem users.json → 503 setup_required', () => {
  const f = process.env.USERS_FILE;
  fs.renameSync(f, f + '.bak');
  assert.strictEqual(authenticate('landevbrasil.ia@gmail.com', 'iloveTI@26').status, 503);
  fs.renameSync(f + '.bak', f);
});

test('papel desconhecido no arquivo → 401 no login', () => {
  const parsed = JSON.parse(fs.readFileSync(process.env.USERS_FILE, 'utf8'));
  parsed.users.push({ email: 'ghost@x.com', role: 'root', algo: 'scrypt', salt: 'aGk=', hash: 'aGk=' });
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify(parsed));
  assert.strictEqual(authenticate('ghost@x.com', 'qualquer123').status, 401);
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
