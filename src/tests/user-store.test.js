// Testes do user-store (auth/users.json + scrypt)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-users-'));
process.env.USERS_FILE = path.join(TMP, 'users.json');

const store = require('../../src/utils/user-store');

before(() => {
  store.addUser('landevbrasil.ia@gmail.com', 'founder', 'iloveTI@26');
  store.addUser('contatodylanjunio@gmail.com', 'cofounder', 'cofounder@26');
});
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('addUser + findUser roundtrip com e-mail normalizado', () => {
  const u = store.findUser('  LandevBrasil.IA@Gmail.COM ');
  assert.ok(u);
  assert.strictEqual(u.role, 'founder');
  assert.strictEqual(store.findUser('ninguem@x.com'), null);
  assert.deepStrictEqual(
    store.listUsers().map((x) => x.role).sort(),
    ['cofounder', 'founder']
  );
  assert.strictEqual(store.listUsers()[0].hash, undefined);
});

test('verifyPassword aceita a senha certa e rejeita a errada', () => {
  const u = store.findUser('landevbrasil.ia@gmail.com');
  assert.strictEqual(store.verifyPassword(u, 'iloveTI@26'), true);
  assert.strictEqual(store.verifyPassword(u, 'errada'), false);
  assert.strictEqual(store.verifyPassword(null, 'iloveTI@26'), false);
  assert.strictEqual(store.verifyPassword(u, ''), false);
});

test('senha nunca fica em claro no arquivo', () => {
  const raw = fs.readFileSync(process.env.USERS_FILE, 'utf8');
  assert.ok(!raw.includes('iloveTI@26'));
  assert.ok(!raw.includes('cofounder@26'));
  assert.ok(raw.includes('"scrypt"'));
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.version, 1);
  assert.strictEqual(parsed.users.length, 2);
});

test('addUser valida entrada e duplicidade', () => {
  assert.throws(() => store.addUser('x', 'founder', 'senha12345'), /e-mail/);
  assert.throws(() => store.addUser('a@b.com', 'root', 'senha12345'), /papel/);
  assert.throws(() => store.addUser('a@b.com', 'founder', 'curta'), /senha/);
  assert.throws(
    () => store.addUser('landevbrasil.ia@gmail.com', 'founder', 'outrasenha1'),
    /já existe/
  );
  const u = store.addUser('landevbrasil.ia@gmail.com', 'cofounder', 'outrasenha1', { force: true });
  assert.strictEqual(u.role, 'cofounder');
  assert.strictEqual(store.findUser('landevbrasil.ia@gmail.com').role, 'cofounder');
});

test('readStore é null para arquivo ausente ou inválido', () => {
  const f = process.env.USERS_FILE;
  fs.rmSync(f);
  assert.strictEqual(store.readStore(), null);
  fs.writeFileSync(f, '{quebrado');
  assert.strictEqual(store.readStore(), null);
  fs.writeFileSync(f, JSON.stringify({ version: 99, users: [] }));
  assert.strictEqual(store.readStore(), null);
  fs.writeFileSync(f, JSON.stringify({ version: 1, users: [] }));
  assert.deepStrictEqual(store.readStore(), { version: 1, users: [] });
});

test('papel desconhecido é ignorado pelo findUser', () => {
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify({
    version: 1,
    users: [{ email: 'ghost@x.com', role: 'superadmin', algo: 'scrypt', salt: 'aGk=', hash: 'aGk=' }],
  }));
  assert.strictEqual(store.findUser('ghost@x.com'), null);
  assert.deepStrictEqual(store.listUsers(), []);
});
