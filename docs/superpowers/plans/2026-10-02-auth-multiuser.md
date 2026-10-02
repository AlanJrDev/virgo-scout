# Auth Multi-usuário com Níveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o par único de credenciais do `.env` por um store local de usuários com papéis (founder/cofounder), senhas hash scrypt, `/api/me` e badge de identidade no painel — fail-closed e preparado para futura troca por Supabase/Postgres.

**Architecture:** Novo módulo `src/utils/user-store.js` (leitura/escrita de `auth/users.json`, hash scrypt) atrás de uma interface pequena (`findUser`/`verifyPassword`/`listUsers`/`addUser`); `serve-web-auth.js` passa a autenticar por esse store; sessões em memória ganham `{exp, email, role}`; seed único via `scripts/init-users.js`. Cliente: campo de e-mail + badge no topbar via `/api/me`.

**Tech Stack:** Node 24 (CommonJS), `node:crypto` scrypt, `node:test`, Playwright (QA), fetch no cliente. Zero dependências novas.

**Spec:** `docs/superpowers/specs/2026-10-02-auth-multiuser-design.md` (o plano argumenta do spec; leia os dois)

## Global Constraints

- Idioma: comentários/strings em pt-BR, seguindo o padrão existente dos arquivos.
- Senha **nunca** em claro nem no git: só hash scrypt (N=16384, r=8, p=1, salt 16 bytes, comparação `timingSafeEqual`).
- Fail-closed: sem `auth/users.json` válido → login `503 {error:'setup_required'}`. Fallback `admin/virgo123` **removido** de todo o código.
- Papéis válidos: apenas `founder` e `cofounder` (constante `ROLES`); papel desconhecido → login `401`.
- Erro de login único `401 {error:'invalid'}` — não revela se o e-mail existe. Rate-limit: 5 falhas/60s → 429 por 30s (inalterado).
- Tokens: `crypto.randomBytes(32)`; cookie `vs_auth` `HttpOnly; SameSite=Lax` (inalterado).
- `npm test` deve passar (24+ testes) ao fim de cada task que mexe em código testado.
- Commits no estilo do repo: `virgo-scout: <mensagem>` — **apenas com aprovação explícita do usuário** (pedir antes do passo de commit de cada task).
- Ambiente: Windows/PowerShell (`$env:NAME=...`, `Start-Process`); servidor em `http://localhost:8901` (`node scripts/serve-web.js`).

---

### Task 1: Módulo `user-store` (JSON + scrypt)

**Files:**
- Create: `src/utils/user-store.js`
- Test: `src/tests/user-store.test.js`
- Modify: `package.json` (script `test` — adicionar o novo arquivo)

**Interfaces:**
- Consome: nada (só `node:fs`, `node:path`, `node:crypto`).
- Produz (usado pelas Tasks 2 e 3):
  - `readStore() -> {version, users} | null` — `null` se o arquivo não existe/JSON inválido/`version !== 1`.
  - `hashPassword(pass: string, saltB64: string) -> string` (base64).
  - `verifyPassword(user: object|null, pass: string) -> boolean`.
  - `findUser(email: string) -> user|null` — e-mail normalizado (trim+lowercase), retorna `null` se papel fora de `ROLES`.
  - `listUsers() -> [{email, role}]` (sem salt/hash).
  - `addUser(email, role, pass, {force=false}) -> {email, role}` — lança erro se e-mail inválido, papel desconhecido, senha <8 chars, ou duplicado sem `force`.
  - Caminho do arquivo: `process.env.USERS_FILE || <raiz>/auth/users.json`, resolvido **a cada chamada** (permite teste com arquivo temporário).

- [ ] **Step 1: Escrever o teste falhando**

Crie `src/tests/user-store.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test src/tests/user-store.test.js`
Expected: FAIL com `Cannot find module '..../src/utils/user-store'`

- [ ] **Step 3: Implementar `src/utils/user-store.js`**

```js
/* Store de usuários locais — auth/users.json + scrypt (fonte p/ login e futuro Supabase) */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROLES = new Set(['founder', 'cofounder']);
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, keylen: 64 };

function usersFile() {
  return process.env.USERS_FILE || path.join(__dirname, '..', '..', 'auth', 'users.json');
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(usersFile(), 'utf8'));
    if (!raw || raw.version !== 1 || !Array.isArray(raw.users)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeStore(store) {
  const file = usersFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, file);
}

function hashPassword(pass, saltB64) {
  const { N, r, p, keylen } = SCRYPT_OPTS;
  return crypto.scryptSync(String(pass), saltB64, keylen, { N, r, p }).toString('base64');
}

function verifyPassword(user, pass) {
  if (!user || !user.salt || !user.hash || typeof pass !== 'string' || !pass) return false;
  let a, b;
  try {
    a = Buffer.from(hashPassword(pass, user.salt), 'base64');
    b = Buffer.from(user.hash, 'base64');
  } catch {
    return false;
  }
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function findUser(email) {
  const store = readStore();
  if (!store) return null;
  const e = normEmail(email);
  return store.users.find((u) => normEmail(u.email) === e && ROLES.has(u.role)) || null;
}

function listUsers() {
  const store = readStore();
  if (!store) return [];
  return store.users
    .filter((u) => ROLES.has(u.role))
    .map((u) => ({ email: u.email, role: u.role }));
}

function addUser(email, role, pass, opts) {
  const e = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error(`e-mail inválido: ${email}`);
  if (!ROLES.has(role)) throw new Error(`papel desconhecido: ${role} (válidos: founder, cofounder)`);
  if (typeof pass !== 'string' || pass.length < 8) throw new Error(`senha muito curta (mín. 8): ${e}`);
  const store = readStore() || { version: 1, users: [] };
  if (store.users.some((u) => normEmail(u.email) === e)) {
    if (!(opts && opts.force)) throw new Error(`usuário já existe (use --force): ${e}`);
    store.users = store.users.filter((u) => normEmail(u.email) !== e);
  }
  const salt = crypto.randomBytes(16).toString('base64');
  store.users.push({
    email: e,
    role,
    algo: 'scrypt',
    salt,
    hash: hashPassword(pass, salt),
    created_at: new Date().toISOString(),
  });
  writeStore(store);
  return { email: e, role };
}

module.exports = { ROLES, usersFile, normEmail, readStore, writeStore, hashPassword, verifyPassword, findUser, listUsers, addUser };
```

- [ ] **Step 4: Rodar e confirmar passagem**

Run: `node --test src/tests/user-store.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Registrar no script de testes**

Em `package.json`, no valor de `scripts.test`, acrescente ` src/tests/user-store.test.js` antes de `src/tests/login.test.js`.

Run: `npm test`
Expected: todos PASS (24 antigos + 6 novos = 30)

- [ ] **Step 6: Commit (pedir aprovação ao usuário)**

```bash
git add src/utils/user-store.js src/tests/user-store.test.js package.json
git commit -m "virgo-scout: user-store local com hash scrypt e papéis"
```

---

### Task 2: Script de seed `init-users.js`

**Files:**
- Create: `scripts/init-users.js`

**Interfaces:**
- Consome: `addUser` da Task 1.
- Produz: `auth/users.json` real com os 2 usuários (arquivo ficará no `.gitignore` na Task 5); CLI aceita `--user email:senha:role` (repetível) ou posicional `email:senha:role`, e `SEED_USERS="email:senha:role|email:senha:role"`.

- [ ] **Step 1: Implementar `scripts/init-users.js`**

```js
/* Seed de auth/users.json — recebe trios email:senha:role; nunca imprime senhas */
require('dotenv').config();
const { addUser, usersFile } = require('../src/utils/user-store');

const args = process.argv.slice(2);
const force = args.includes('--force');
const pairs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--force') continue;
  if (args[i] === '--user' && args[i + 1]) { pairs.push(args[++i]); continue; }
  if (!args[i].startsWith('-')) pairs.push(args[i]);
}
for (const p of (process.env.SEED_USERS || '').split('|').filter(Boolean)) pairs.push(p);

if (!pairs.length) {
  console.error('Uso: node scripts/init-users.js --user email:senha:role [--force]');
  console.error('     SEED_USERS="email:senha:role|..." node scripts/init-users.js');
  process.exit(1);
}
for (const pair of pairs) {
  const m = pair.match(/^([^:\s]+@[^:\s]+):([^:\s]+):([a-z]+)$/);
  if (!m) { console.error(`Formato inválido (email:senha:role): entrada sem senha exibida`); process.exit(1); }
  const [, email, pass, role] = m;
  const u = addUser(email, role, pass, { force });
  console.log(`ok: ${u.email} (${u.role}) — hash scrypt gravado`);
}
console.log('Pronto:', usersFile());
```

- [ ] **Step 2: Smoke test sem credenciais reais**

Run: `node scripts/init-users.js`
Expected: sai com código 1 e mostra a Uso (não grava nada).

Run: `node scripts/init-users.js "teste@x.com:senha12345:founder"` com `$env:USERS_FILE="$env:TEMP\vs-seed-test.json"` e em seguida verificar que o arquivo contém `"algo": "scrypt"` e **não** contém `senha12345`; depois apagar o arquivo temporário.

Expected: `ok: teste@x.com (founder)`; ausência da senha no arquivo.

- [ ] **Step 3: Commit (pedir aprovação ao usuário)**

```bash
git add scripts/init-users.js
git commit -m "virgo-scout: script de seed de usuarios (init-users)"
```

*(O seed real com as credenciais do usuário roda na Task 5.)*

---

### Task 3: Servidor autentica pelo store (fail-closed + papéis + `/api/me`)

**Files:**
- Modify: `scripts/serve-web-auth.js` (todo o arquivo)
- Modify: `scripts/serve-web.js:7` (import), `:17-25` (sessões), `:161-181` (`/api/login`), `:189-193` (bloco de APIs autenticadas — inserir `/api/me`)
- Test: `src/tests/login.test.js` (reescrito)

**Interfaces:**
- Consome: `readStore`, `findUser`, `verifyPassword` da Task 1.
- Produz:
  - `authenticate(email, pass) -> {status: 200, user:{email, role}} | {status: 401} | {status: 503}`.
  - Sessão em memória: `Map<token, {exp: number, email: string, role: string}>`.
  - `GET /api/me -> {user, role}` (sessão exigida).
  - `POST /api/login -> 200 {ok, user, role}` | `401 {error:'invalid'}` | `429 {error:'locked'}` | `503 {error:'setup_required'}`.

- [ ] **Step 1: Reescrever o teste falhando**

Substitua todo o conteúdo de `src/tests/login.test.js` por:

```js
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test src/tests/login.test.js`
Expected: FAIL — `authenticate` não existe no export atual.

- [ ] **Step 3: Reescrever `scripts/serve-web-auth.js`**

Substitua o arquivo inteiro por:

```js
const crypto = require('node:crypto');
const store = require('../src/utils/user-store');

// autentica no user-store local; 503 = sem users.json (fail-closed), 401 = inválido
function authenticate(email, pass) {
  if (!store.readStore()) return { status: 503 };
  const user = store.findUser(email);
  if (!user || !store.verifyPassword(user, pass)) return { status: 401 };
  return { status: 200, user: { email: user.email, role: user.role } };
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// controle de tentativas: 5 falhas em 60s → 30s de bloqueio por IP
const attempts = new Map();
function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a) return true;
  if (Date.now() > a.resetAt) { attempts.delete(ip); return true; }
  return a.fails < 5;
}
function registerFail(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { fails: 0, resetAt: now + 60000 };
  if (now > a.resetAt) { a.fails = 0; a.resetAt = now + 60000; }
  a.fails++;
  attempts.set(ip, a);
  return a.fails >= 5;
}
function clearFails(ip) { attempts.delete(ip); }

module.exports = { authenticate, newSessionToken, loginAllowed, registerFail, clearFails };
```

- [ ] **Step 4: Rodar e confirmar passagem**

Run: `node --test src/tests/login.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Ligar o servidor — import e sessões com papel**

Em `scripts/serve-web.js`:

1. Linha 7, troque o import:
```js
const { authenticate, newSessionToken, loginAllowed, registerFail, clearFails } = require('./serve-web-auth');
```

2. Linhas 17-25, a sessão guarda papel:
```js
/* ---------- sessões locais (em memória; reinício do servidor desloga) ---------- */
const sessions = new Map(); // token -> { exp, email, role }
const DAY = 24 * 60 * 60 * 1000;
function sessionValid(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { sessions.delete(token); return null; }
  return s;
}
```

3. Linha ~148-150, derive a sessão:
```js
  const cookies = parseCookies(req.headers.cookie);
  const sess = sessionValid(cookies.vs_auth);
  const authed = !!sess;
```

- [ ] **Step 6: Login e `/api/me`**

1. Substitua o bloco `POST /api/login` (linhas 161-181) por:

```js
  if (url === '/api/login' && req.method === 'POST') {
    if (!loginAllowed(ip)) { json(res, 429, { error: 'locked' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let u = '', p = '', keep = false;
      try { const j = JSON.parse(body || '{}'); u = j.user; p = j.pass; keep = !!j.keep; } catch {}
      const r = authenticate(u, p);
      if (r.status === 503) { json(res, 503, { error: 'setup_required' }); return; }
      if (r.status !== 200) {
        const locked = registerFail(ip);
        json(res, locked ? 429 : 401, { error: locked ? 'locked' : 'invalid' });
        return;
      }
      clearFails(ip);
      const token = newSessionToken();
      sessions.set(token, { exp: Date.now() + (keep ? 7 * DAY : DAY), email: r.user.email, role: r.user.role });
      const cookie = `vs_auth=${token}; Path=/; HttpOnly; SameSite=Lax${keep ? `; Max-Age=${7 * 86400}` : ''}`;
      res.setHeader('Set-Cookie', cookie);
      json(res, 200, { ok: true, user: r.user.email, role: r.user.role });
    });
    return;
  }
```

2. Dentro do bloco `if (url.startsWith('/api'))`, logo após o `if (!authed) ...`, insira:

```js
    if (url === '/api/me') { json(res, 200, { user: sess.email, role: sess.role }); return; }
```

- [ ] **Step 7: Suite completa**

Run: `npm test`
Expected: todos PASS (32 testes: 30 + 6 do login reescrito, pois os 4 antigos saem)

- [ ] **Step 8: Commit (pedir aprovação ao usuário)**

```bash
git add scripts/serve-web-auth.js scripts/serve-web.js src/tests/login.test.js
git commit -m "virgo-scout: login por user-store com papeis, /api/me e fail-closed"
```

---

### Task 4: Cliente — e-mail no login e badge de identidade

**Files:**
- Modify: `web/login.html:43-48`, `web/login.js:45-47`, `web/login.js:67`, `web/login.js:76-79`
- Modify: `web/index.html:42-47` (topbar `.top-user`)
- Modify: `web/app.js:615-632` (perto do `boot`)
- Modify: `web/styles.css:66` (ellipsis no e-mail)

**Interfaces:**
- Consome: `GET /api/me -> {user, role}` (Task 3); ids existentes `#loginUser`, `#loginPass`.
- Produz: ids `#uName`, `#uRole`, `#uAvatar` preenchidos no boot.

- [ ] **Step 1: `web/login.html` — campo de e-mail**

Na `label` do usuário (linhas 43-48), troque:

```html
      <label class="field" for="loginUser">
        <span>E-mail</span>
        <div class="input-wrap">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          <input id="loginUser" name="user" type="email" autocomplete="username" placeholder="seu@email.com" required>
        </div>
      </label>
```

- [ ] **Step 2: `web/login.js` — mensagens**

1. Linha 45-47 (toast "Esqueci a senha"):
```js
  $('#forgot').addEventListener('click', function () {
    toast('Contate o administrador do painel para redefinir sua senha', 'ok');
  });
```
2. Linha 67 (validação): `showError('Preencha e-mail e senha para continuar.');`
3. Linha 76-79 (mapeamento de erro), troque o `showError(...)` por:
```js
        var e = res.b && res.b.error;
        showError(
          e === 'locked' ? 'Muitas tentativas — aguarde 30s.' :
          e === 'setup_required' ? 'Painel não configurado — rode scripts/init-users.js' :
          'E-mail ou senha inválidos — tente novamente.'
        );
```

- [ ] **Step 3: `web/index.html` — topbar dinâmica**

Troque as linhas 44-46 do `.top-user`:

```html
      <div class="avatar" id="uAvatar" aria-hidden="true">VS</div>
      <div class="uinfo"><strong id="uName">—</strong><span id="uRole">…</span></div>
```

- [ ] **Step 4: `web/app.js` — carregar `/api/me` no boot**

Antes da linha 615 (`/* ---------- boot ... */`), acrescente:

```js
  /* ---------- identidade da sessão (topbar) ---------- */
  function emailInitials(email) {
    var parts = String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean);
    var a = parts[0] ? parts[0][0] : '';
    var b = parts[1] ? parts[1][0] : (parts[0] && parts[0][1] ? parts[0][1] : '');
    return (a + b).toUpperCase() || 'VS';
  }
  function loadMe() {
    fetch('/api/me', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) {
        if (!me) return;
        var name = document.getElementById('uName');
        var role = document.getElementById('uRole');
        var av = document.getElementById('uAvatar');
        if (name) name.textContent = me.user;
        if (role) role.textContent = me.role === 'founder' ? 'Fundador' : 'Cofounder';
        if (av) av.textContent = emailInitials(me.user);
      })
      .catch(function () {});
  }
```

E dentro de `boot(payload)` (linha 617), após `render(currentPayload);` acrescente `loadMe();`.

- [ ] **Step 5: `web/styles.css` — e-mail comprido não quebra o topbar**

Na linha 66, troque `.uinfo strong{font-size:13px}` por:

```css
.uinfo strong{font-size:13px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
```

- [ ] **Step 6: Verificação visual (servidor reiniciado com a Task 3)**

1. Reinicie o servidor (mate processos com `CommandLine -like '*serve-web*'` e rode `Start-Process node scripts/serve-web.js -WindowStyle Hidden`).
2. Sem seed (Task 5 ainda não rodou), abra `http://localhost:8901/login` e confirme: campo "E-mail" e, ao tentar logar, a mensagem **"Painel não configurado — rode scripts/init-users.js"** (fail-closed 503 exibido — valida o caminho novo de erro; "E-mail ou senha inválidos" será validado no E2E da Task 5, quando o seed existir).
3. `impeccable detect --json web/login.html web/app.js web/index.html web/styles.css`
Expected: **0 erros** (warnings já existentes do brief são aceitos).

- [ ] **Step 7: Commit (pedir aprovação ao usuário)**

```bash
git add web/login.html web/login.js web/index.html web/app.js web/styles.css
git commit -m "virgo-scout: login por e-mail e badge de identidade na topbar"
```

---

### Task 5: Seed real, `.env`/`.gitignore`, QA e verificação final

**Files:**
- Modify: `.gitignore` (adicionar `auth/`)
- Modify: `.env` (remover `LOGIN_USER`/`LOGIN_PASS`; adicionar `QA_USER`/`QA_PASS`)
- Modify: `scripts/shot-ui.js:4-5` (QA_USER/QA_PASS sem fallback)
- Create: `auth/users.json` (gerado, **não commitado**)

**Interfaces:**
- Consome: Tasks 1-4.
- Produz: sistema logando com `landevbrasil.ia@gmail.com`/`iloveTI@26` (founder) e `contatodylanjunio@gmail.com`/`cofounder@26` (cofounder).

- [ ] **Step 1: `.gitignore`**

Acrescente a linha `auth/` (junto aos ignores existentes).

- [ ] **Step 2: `.env`**

1. Remova as linhas `LOGIN_USER=...` e `LOGIN_PASS=...` (e o comentário delas, se houver).
2. Acrescente:
```
# Credenciais usadas apenas pelos scripts de QA (shot-ui.js)
QA_USER=landevbrasil.ia@gmail.com
QA_PASS=iloveTI@26
```

- [ ] **Step 3: `scripts/shot-ui.js`**

Troque as linhas 4-5 por:

```js
const QA_USER = process.env.QA_USER;
const QA_PASS = process.env.QA_PASS;
if (!QA_USER || !QA_PASS) { console.error('QA_USER/QA_PASS não definidos no .env'); process.exit(1); }
```

- [ ] **Step 4: Gerar o seed real (credenciais fora do argv)**

PowerShell:

```powershell
$env:SEED_USERS = 'landevbrasil.ia@gmail.com:iloveTI@26:founder|contatodylanjunio@gmail.com:cofounder@26:cofounder'
node scripts/init-users.js
Remove-Item Env:\SEED_USERS
```

Expected: duas linhas `ok: ... (founder)` / `ok: ... (cofounder)`.

- [ ] **Step 5: Conferir que nada vazou para o arquivo/git**

```powershell
Select-String -Path auth\users.json -Pattern 'iloveTI|cofounder@26'   # esperado: NENHUM hit
git status --short                                                      # esperado: auth/ NÃO aparece
git grep -nI 'virgo123' -- .                                           # esperado: NENHUM hit
```

- [ ] **Step 6: Bateria completa de testes**

Run: `npm test`
Expected: 32/32 PASS.

- [ ] **Step 7: E2E no servidor real**

1. Reinicie o servidor (mate `*serve-web*`, inicie de novo oculto).
2. PowerShell com cookie jar (JSON em string single-quote — PowerShell não escapa `"` com `\"`):
```powershell
$b1 = '{"user":"landevbrasil.ia@gmail.com","pass":"senhaERRADA"}'
curl.exe -s -c $env:TEMP\vs.jar -X POST http://localhost:8901/api/login -H "Content-Type: application/json" -d $b1
# esperado: {"error":"invalid"} (401)
$b2 = '{"user":"landevbrasil.ia@gmail.com","pass":"iloveTI@26","keep":true}'
curl.exe -s -b $env:TEMP\vs.jar -c $env:TEMP\vs.jar -X POST http://localhost:8901/api/login -H "Content-Type: application/json" -d $b2
# esperado: {"ok":true,"user":"landevbrasil.ia@gmail.com","role":"founder"}
curl.exe -s -b $env:TEMP\vs.jar http://localhost:8901/api/me
# esperado: {"user":"landevbrasil.ia@gmail.com","role":"founder"}
```
3. Rode o QA visual: `node scripts/shot-ui.js`
Expected: loga com sucesso; `docs/qa/ui-desktop.png` mostra a topbar com o e-mail e "Fundador"; screenshots `login-desktop.png` com campo "E-mail".

- [ ] **Step 8: Verificação de segurança final**

```powershell
git grep -nI -E 'virgo123|LOGIN_USER|LOGIN_PASS|checkCredentials' -- .   # esperado: 0 hits
Select-String -Path web\login.html -Pattern '@gmail'                      # esperado: 0 hits (nenhum e-mail hardcoded na UI)
```

`impeccable detect --json web/login.html web/login.js web/app.js`
Expected: 0 erros.

- [ ] **Step 9: Commit (pedir aprovação ao usuário)**

```bash
git add .gitignore .env scripts/shot-ui.js
git commit -m "virgo-scout: credenciais reais no store local, env de QA e auth fora do git"
```

*(Nada em `auth/` entra no commit — verifique com `git status` antes.)*

---

## Self-Review (do plano vs spec)

1. **Cobertura do spec:** modelo de dados ✓ (T1); interface user-store + preparação Supabase ✓ (T1, módulo é a interface); seed CLI ✓ (T2); servidor fail-closed/login/me/sessão com papel ✓ (T3); cliente e-mail+badge ✓ (T4); `.env` QA_USER/QA_PASS + `.gitignore auth/` ✓ (T5); testes listados ✓ (T1/T3/T5); escopo fora intacto ✓.
2. **Placeholders:** nenhum TBD/TODO; todo passo de código tem o código.
3. **Consistência de nomes:** `authenticate/readStore/findUser/verifyPassword/addUser/listUsers/usersFile` + `ROLES` usados igual em T1→T3; ids `#uName/#uRole/#uAvatar` em T4; `QA_USER/QA_PASS` em T5 = T4? (shot-ui é T5) ✓; resposta `{ok,user,role}` bate com consumo em `login.js` e `shot-ui`.
