# Supabase + Vercel — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usuários, sessões, leads e histórico de capturas passam a viver no Supabase (fonte única local+nuvem) e o painel sobe funcionando na Vercel.

**Architecture:** Camada única — `user-store`/`session-store` ganham backend Supabase (PostgREST via `fetch`, chave secret) atrás das mesmas interfaces, com dispatcher condicional (sem env ⇒ modo local síncrono, como hoje). O servidor local e as funções `api/*.js` da Vercel compartilham `scripts/serve-web-auth.js` + `src/utils/*`. Captura segue local e faz sync automático para o banco.

**Tech Stack:** Node 24 (CJS, `fetch` global, zero dependências novas), PostgREST do Supabase, Vercel Serverless (Node), `node:test`, Playwright (local).

**Spec:** `docs/superpowers/specs/2026-10-02-supabase-vercel-design.md` — este plano argumenta a partir dele; leia ambos.

## Global Constraints

- **Zero dependências novas**: nenhum `npm install` em todo o plano.
- **CJS obrigatório** (`package.json` tem `"type": "commonjs"`); `fetch` global (Node ≥ 18, local é v24).
- **Mensagens** de UI e de erro de API em **pt-BR** (códigos de erro em `snake_case` inglês como hoje: `supabase_down`, `setup_required`).
- **Commits pré-aprovados**, formato `virgo-scout: <msg>`; push autorizado. Nunca commitar `.env`, `auth/`, `.vercel/`.
- **Segredos nunca no git nem no plano**: `sb_secret_*`, `gsk_*` só em `.env`/env da Vercel. O valor da secret key do Supabase foi fornecido na sessão — escreva-o apenas em `.env` local.
- **`npm test` 100% verde antes de CADA commit.**
- **Fail-closed**: com `SUPABASE_URL` configurado, indisponibilidade ⇒ `503` (nunca fallback silencioso para JSON local).
- **Dispatcher síncrono/condicional**: sem env, funções do store retornam valor cru (síncrono); com env, retornam Promise. **Todo chamador de produção deve usar `await`** — isso mantém os testes locais existentes válidos.
- PowerShell 5.1: sem `&&`; HTTP via `curl.exe` com corpo em aspas simples (`'{"a":1}'`); entrepasos com `; if ($?) { ... }`.
- id de lead: `sha1(norm(name) + '|' + norm(address))`; upsert em **batches de 500**.
- Impercetible: após editar `web/app.js`, `impeccable detect` precisa acusar **0 erros**.

---

### Task 1: Migration SQL + cliente `sb.js`

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `src/utils/sb.js`
- Test: `src/tests/sb.test.js`
- Modify: `package.json:7` (lista do `npm test`)

**Interfaces:**
- Produces: `sbEnabled() → bool`, `sbFetch(path, { method?, body?, headers? }) → Promise<any>`, `SbError extends Error` com `status: number` e `code: string`. Usadas por todas as tasks seguintes.

- [ ] **Step 1: Escrever a migration SQL**

`supabase/migrations/0001_init.sql` (conteúdo exato, tirado do spec):

```sql
-- Virgo Scout: schema inicial (usuários, sessões, leads, capturas)
-- RLS habilitado SEM policies = nega tudo para clientes; só o servidor acessa com a secret key.
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('founder','cofounder')),
  algo text not null default 'scrypt',
  salt text not null,
  hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  email text not null,
  role text not null,
  exp timestamptz not null
);
create index if not exists sessions_exp on sessions (exp);

create table if not exists leads (
  id text primary key,
  name text,
  rating numeric,
  reviews int,
  address text,
  phone text,
  website text,
  source text,
  area text,
  area_conf numeric,
  captured_at timestamptz
);
create index if not exists leads_captured on leads (captured_at desc);

create table if not exists captures (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null check (status in ('running','done','failed')),
  queries int,
  leads_count int
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table leads enable row level security;
alter table captures enable row level security;
```

- [ ] **Step 2: Escrever o teste falhando**

`src/tests/sb.test.js`:

```js
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
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `node --test src/tests/sb.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/sb'`

- [ ] **Step 4: Implementar `src/utils/sb.js`**

```js
/* Cliente PostgREST mínimo do Supabase — só servidor, chave secret (sb_secret_).
   sbEnabled/sbFetch lêem process.env a cada chamada (testes setam depois do require). */
function sbEnabled() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

class SbError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SbError';
    this.status = status;
    this.code = status >= 500 ? 'supabase_down' : message;
  }
}

async function sbFetch(path, { method = 'GET', body, headers = {} } = {}) {
  if (!sbEnabled()) throw new SbError('supabase_not_configured', 503);
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  let res;
  try {
    res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(body !== undefined ? { Prefer: 'return=representation' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SbError('supabase_down', 503);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new SbError(res.status >= 500 ? 'supabase_down' : `sb_${res.status}`, res.status >= 500 ? 503 : res.status);
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new SbError('sb_bad_json', 502); }
}

module.exports = { sbEnabled, sbFetch, SbError };
```

- [ ] **Step 5: Rodar para ver passar**

Run: `node --test src/tests/sb.test.js`
Expected: PASS (7 testes)

- [ ] **Step 6: Registrar no `npm test` e rodar suíte completa**

`package.json` linha 7 — adicionar `src/tests/sb.test.js` ao final:

```json
"test": "node --test src/tests/backend.test.js src/tests/classify.test.js src/tests/wa.test.js src/tests/user-store.test.js src/tests/login.test.js src/tests/groq.test.js src/tests/sb.test.js"
```

Run: `npm test`
Expected: todos verdes

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0001_init.sql src/utils/sb.js src/tests/sb.test.js package.json
git commit -m "virgo-scout: schema supabase (migration sql) e cliente postgrest sb.js"
```

---

### Task 2: `session-store` (banco ou memória)

**Files:**
- Create: `src/utils/session-store.js`
- Test: `src/tests/session-store.test.js`
- Modify: `package.json:7`

**Interfaces:**
- Consumes: `sbEnabled`, `sbFetch`, `SbError` (Task 1).
- Produces: `createSession({ email, role, ttlMs, token? }) → token (string|Promise<string>)`, `getSession(token) → {email, role} | null (Promise)`, `destroySession(token) → void (Promise|void)`. Token nunca é gravado cru: no banco vai `sha256(token)` como `token_hash`.

- [ ] **Step 1: Escrever o teste falhando**

`src/tests/session-store.test.js`:

```js
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
    const del = calls.find((c) => c.opts.method === 'DELETE');
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
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/session-store.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/session-store'`

- [ ] **Step 3: Implementar `src/utils/session-store.js`**

```js
/* Sessões: Supabase (sessions table, hash sha256) quando configurado; Map em memória caso contrário */
const crypto = require('node:crypto');
const { sbEnabled, sbFetch } = require('./sb');

const mem = new Map(); // token -> { exp, email, role }

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createSession({ email, role, ttlMs, token = crypto.randomBytes(32).toString('hex') }) {
  const exp = Date.now() + ttlMs;
  if (sbEnabled()) {
    await sbFetch('sessions', {
      method: 'POST',
      body: [{ token_hash: hashToken(token), email, role, exp: new Date(exp).toISOString() }],
    });
    // limpeza oportunista das expiradas
    await sbFetch(`sessions?exp=lt.${new Date().toISOString()}`, { method: 'DELETE' });
  } else {
    mem.set(token, { exp, email, role });
  }
  return token;
}

async function getSession(token) {
  if (!token) return null;
  if (sbEnabled()) {
    const rows = await sbFetch(`sessions?token_hash=eq.${hashToken(token)}&select=*`);
    const s = rows && rows[0];
    if (!s) return null;
    if (Date.now() > new Date(s.exp).getTime()) {
      await destroySession(token);
      return null;
    }
    return { email: s.email, role: s.role };
  }
  const s = mem.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { mem.delete(token); return null; }
  return { email: s.email, role: s.role };
}

async function destroySession(token) {
  if (!token) return;
  if (sbEnabled()) await sbFetch(`sessions?token_hash=eq.${hashToken(token)}`, { method: 'DELETE' });
  else mem.delete(token);
}

module.exports = { createSession, getSession, destroySession };
```

- [ ] **Step 4: Rodar para ver passar**

Run: `node --test src/tests/session-store.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Registrar no `npm test` e rodar suíte**

`package.json` — adicionar `src/tests/session-store.test.js` após `sb.test.js` na lista.
Run: `npm test`
Expected: todos verdes

- [ ] **Step 6: Commit**

```bash
git add src/utils/session-store.js src/tests/session-store.test.js package.json
git commit -m "virgo-scout: session-store com backend supabase (hash) e memoria local"
```

---

### Task 3: Dispatcher do `user-store` + `attemptLogin` + wiring do servidor local

Atômico: o store vira consumível com `await`, a autenticação migra para `attemptLogin`/`sessionUser` e `serve-web.js` usa `session-store`. **Toda a mudança de contrato de um commit só**, para a suíte nunca ficar vermelha entre tasks.

**Files:**
- Modify: `src/utils/user-store.js` (dispatcher condicional)
- Create: `src/utils/cookies.js`, `src/utils/http-json.js`
- Rewrite: `scripts/serve-web-auth.js`
- Modify: `scripts/serve-web.js`
- Modify: `src/tests/login.test.js`, `src/tests/user-store.test.js`

**Interfaces:**
- Consumes: `createSession/getSession/destroySession` (Task 2), `sbEnabled/sbFetch/SbError` (Task 1).
- Produces (fixos para as tasks seguintes):
  - `store.findUser(email) → usuario | null | Promise<...>` (com env ⇒ Promise; sem env ⇒ cru)
  - `store.listUsers/addUser/readStore` — mesma régua
  - `attemptLogin({ email, pass, keep?, ip? }) → Promise<{ status, body, token?, ttlMs?, keep? }>`
  - `sessionUser(token) → Promise<{email, role} | null>` (nunca lança)
  - `parseCookies(header)`, `authCookie(token, { maxAge })`, `clearAuthCookie()`
  - `json(res, code, obj)`

- [ ] **Step 1: Reescrever `src/tests/login.test.js` (falha: `attemptLogin` não existe)**

Substituir o arquivo inteiro por:

```js
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
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/login.test.js`
Expected: FAIL — `attemptLogin is not a function` / `authenticate is not a function`

- [ ] **Step 3: Adicionar guardas de env em `src/tests/user-store.test.js`**

Após os requires do topo (linha 11), inserir:

```js
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
```

E acrescentar ao final do arquivo o teste de dispatcher:

```js
test('dispatcher: com SUPABASE configurado, findUser consulta o PostgREST', async () => {
  const nativeFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify([{ email: 'remoto@x.com', role: 'founder', salt: 'aGk=', hash: 'aGk=' }]) };
  };
  try {
    const u = await store.findUser('remoto@x.com');
    assert.strictEqual(u.role, 'founder');
    assert.ok(urls[0].includes('/rest/v1/users?email=eq.remoto%40x.com'));
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    global.fetch = nativeFetch;
  }
});
```

Run: `node --test src/tests/user-store.test.js`
Expected: FAIL no teste novo (`urls[0]` undefined — store ainda é só local) e nos demais ainda PASSA (modo local segue síncrono).

- [ ] **Step 4: Implementar o dispatcher em `src/utils/user-store.js`**

Reescrever o arquivo mantendo `hashPassword`, `verifyPassword`, `normEmail`, `ROLES`, `usersFile` intactos e renomeando as funções locais com prefixo `local`; adicionar o dispatcher e as versões Supabase:

```js
/* Store de usuários — dispatcher: SUPABASE_URL/SECRET setados ⇒ PostgREST;
   sem env ⇒ auth/users.json local (síncrono, como sempre).
   Regra: TODOS os chamadores de produção devem consumir com await —
   com env as funções retornam Promise, sem env retornam valor cru. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sbEnabled, sbFetch } = require('./sb');

const ROLES = new Set(['founder', 'cofounder']);
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, keylen: 64 };

function usersFile() {
  return process.env.USERS_FILE || path.join(__dirname, '..', '..', 'auth', 'users.json');
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

/* ---------- local (JSON) ---------- */
function localReadStore() {
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

function storeUnavailable() {
  const e = new Error('users.json ausente ou inválido');
  e.code = 'store_unavailable';
  return e;
}

function localFindUser(email) {
  const store = localReadStore();
  if (!store) throw storeUnavailable();
  const e = normEmail(email);
  return store.users.find((u) => normEmail(u.email) === e && ROLES.has(u.role)) || null;
}

function localListUsers() {
  const store = localReadStore();
  if (!store) return [];
  return store.users
    .filter((u) => ROLES.has(u.role))
    .map((u) => ({ email: u.email, role: u.role }));
}

function validateNewUser(email, role, pass) {
  const e = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error(`e-mail inválido: ${email}`);
  if (!ROLES.has(role)) throw new Error(`papel desconhecido: ${role} (válidos: founder, cofounder)`);
  if (typeof pass !== 'string' || pass.length < 8) throw new Error(`senha muito curta (mín. 8): ${e}`);
  return e;
}

function localAddUser(email, role, pass, opts) {
  const e = validateNewUser(email, role, pass);
  const store = localReadStore() || { version: 1, users: [] };
  if (store.users.some((u) => normEmail(u.email) === e)) {
    if (!(opts && opts.force)) throw new Error(`usuário já existe (use --force): ${e}`);
    store.users = store.users.filter((u) => normEmail(u.email) !== e);
  }
  const salt = crypto.randomBytes(16).toString('base64');
  store.users.push({
    email: e, role, algo: 'scrypt', salt,
    hash: hashPassword(pass, salt),
    created_at: new Date().toISOString(),
  });
  writeStore(store);
  return { email: e, role };
}

/* ---------- supabase (PostgREST) ---------- */
async function supabaseReadStore() {
  const users = await sbFetch('users?select=email,role,salt,hash,algo,created_at');
  return { version: 1, users: users || [] };
}

async function supabaseFindUser(email) {
  const e = normEmail(email);
  const rows = await sbFetch(`users?email=eq.${encodeURIComponent(e)}&select=*`);
  const u = rows && rows[0];
  if (!u || !ROLES.has(u.role)) return null;
  return u;
}

async function supabaseListUsers() {
  const rows = await sbFetch('users?select=email,role');
  return (rows || []).filter((u) => ROLES.has(u.role)).map((u) => ({ email: u.email, role: u.role }));
}

async function supabaseAddUser(email, role, pass, opts) {
  const e = validateNewUser(email, role, pass);
  const existente = await supabaseFindUser(e);
  if (existente && !(opts && opts.force)) throw new Error(`usuário já existe (use --force): ${e}`);
  const salt = crypto.randomBytes(16).toString('base64');
  const row = { email: e, role, algo: 'scrypt', salt, hash: hashPassword(pass, salt), created_at: new Date().toISOString() };
  if (existente) {
    await sbFetch('users?on_conflict=email', { method: 'POST', body: [row], headers: { Prefer: 'resolution=merge-duplicates' } });
  } else {
    await sbFetch('users', { method: 'POST', body: [row] });
  }
  return { email: e, role };
}

/* ---------- dispatcher ---------- */
function readStore() { return sbEnabled() ? supabaseReadStore() : localReadStore(); }
function findUser(email) { return sbEnabled() ? supabaseFindUser(email) : localFindUser(email); }
function listUsers() { return sbEnabled() ? supabaseListUsers() : localListUsers(); }
function addUser(email, role, pass, opts) { return sbEnabled() ? supabaseAddUser(email, role, pass, opts) : localAddUser(email, role, pass, opts); }

module.exports = { ROLES, usersFile, normEmail, readStore, writeStore, hashPassword, verifyPassword, findUser, listUsers, addUser };
```

Diferenças do original que sustentam o contrato: `localFindUser` agora lança `store_unavailable` quando o arquivo não existe (é o que `authenticate` checava antes ⇒ 503 preservado) e a validação foi extraída para `validateNewUser` (mensagem idêntica ⇒ testes de `assert.throws`/`assert.rejects` continuam válidos — no modo local `addUser` lança **sincrono**, então os `assert.throws` existentes seguem passando sem mudança).

- [ ] **Step 5: Criar `src/utils/cookies.js` e `src/utils/http-json.js`**

`src/utils/cookies.js`:

```js
/* Cookies de sessão — compartilhados por serve-web local e funções da Vercel */
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function authCookie(token, { maxAge = 0 } = {}) {
  return `vs_auth=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ''}`;
}

function clearAuthCookie() {
  return 'vs_auth=; Path=/; HttpOnly; Max-Age=0';
}

module.exports = { parseCookies, authCookie, clearAuthCookie };
```

`src/utils/http-json.js`:

```js
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

module.exports = { json };
```

- [ ] **Step 6: Reescrever `scripts/serve-web-auth.js`**

```js
/* Autenticação comum local + Vercel: tentativa de login e leitura de sessão */
const crypto = require('node:crypto');
const store = require('../src/utils/user-store');
const { createSession, getSession } = require('../src/utils/session-store');
const { SbError } = require('../src/utils/sb');

const DAY = 24 * 60 * 60 * 1000;

// valida credenciais, cria sessão (banco ou memória) e devolve token pronto p/ cookie
async function attemptLogin({ email, pass, keep = false, ip = '?' }) {
  if (!loginAllowed(ip)) return { status: 429, body: { error: 'locked' } };
  try {
    const user = await store.findUser(email);
    if (!user || !store.verifyPassword(user, pass)) {
      const locked = registerFail(ip);
      return { status: locked ? 429 : 401, body: { error: locked ? 'locked' : 'invalid' } };
    }
    clearFails(ip);
    const ttlMs = keep ? 7 * DAY : DAY;
    const token = await createSession({ email: user.email, role: user.role, ttlMs });
    return { status: 200, token, ttlMs, keep, body: { ok: true, user: user.email, role: user.role } };
  } catch (e) {
    if (e instanceof SbError || (e && e.code === 'store_unavailable')) {
      return { status: 503, body: { error: 'setup_required' } };
    }
    throw e;
  }
}

// sessão → usuário; ausência/expiração/falha de store → null (fail-closed, nunca lança)
async function sessionUser(token) {
  try { return await getSession(token); } catch { return null; }
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

module.exports = { attemptLogin, sessionUser, newSessionToken, loginAllowed, registerFail, clearFails };
```

(`authenticate` sai do exports — todos os chamadores migram neste mesmo commit.)

- [ ] **Step 7: Rodar testes de auth**

Run: `node --test src/tests/login.test.js src/tests/user-store.test.js`
Expected: PASS nos dois arquivos

- [ ] **Step 8: Wiring em `scripts/serve-web.js`**

Edições (mesmo arquivo, faça todas de uma vez):

1. Linha 7 — trocar import de auth:
```js
const { attemptLogin, sessionUser } = require('./serve-web-auth');
const { destroySession } = require('../src/utils/session-store');
const { parseCookies, authCookie, clearAuthCookie } = require('../src/utils/cookies');
const { json } = require('../src/utils/http-json');
```
2. Remover as definições locais de `sessions` Map (linha 18), `sessionValid` (20–26), `parseCookies` (27–34) e `json` (38–41).
3. Trocar o handler por wrapper assíncrono com catch (evita crash por unhandled rejection):
```js
async function handler(req, res) {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const cookies = parseCookies(req.headers.cookie);
  const sess = await sessionUser(cookies.vs_auth);
  const authed = !!sess;
  const ip = req.socket.remoteAddress || '?';
  /* ...todo o corpo atual do handler, com as trocas dos próximos itens... */
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((e) => {
    console.error('[serve-web]', e);
    try { json(res, 500, { error: 'internal' }); } catch {}
  });
});
```
4. Bloco `/api/login` (163–185) vira:
```js
if (url === '/api/login' && req.method === 'POST') {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
  req.on('end', async () => {
    let u = '', p = '', keep = false;
    try { const j = JSON.parse(body || '{}'); u = j.user; p = j.pass; keep = !!j.keep; } catch {}
    try {
      const r = await attemptLogin({ email: u, pass: p, keep, ip });
      if (r.token) res.setHeader('Set-Cookie', authCookie(r.token, { maxAge: r.keep ? Math.floor(r.ttlMs / 1000) : 0 }));
      json(res, r.status, r.body);
    } catch (e) {
      console.error('[serve-web] login', e);
      json(res, 500, { error: 'internal' });
    }
  });
  return;
}
```
5. Bloco `/api/logout` (186–191):
```js
if (url === '/api/logout' && req.method === 'POST') {
  if (cookies.vs_auth) await destroySession(cookies.vs_auth);
  res.setHeader('Set-Cookie', clearAuthCookie());
  json(res, 200, { ok: true });
  return;
}
```
6. Remover a constante `DAY` (linha 19) se ficar sem uso.

- [ ] **Step 9: Corrigir `scripts/init-users.js` para o dispatcher (com env, `addUser` vira Promise)**

Substituir o corpo (linhas 20–27) por um `main` assíncrono — o restante do parse de args permanece:

```js
(async () => {
  for (const pair of pairs) {
    const m = pair.match(/^([^:\s]+@[^:\s]+):([^:\s]+):([a-z]+)$/);
    if (!m) { console.error('Formato inválido (email:senha:role): entrada sem senha exibida'); process.exit(1); }
    const [, email, pass, role] = m;
    try {
      const u = await store.addUser(email, role, pass, { force });
      console.log(`ok: ${u.email} (${u.role}) — hash scrypt gravado em ${require('../src/utils/sb').sbEnabled() ? 'Supabase' : usersFile()}`);
    } catch (e) {
      console.error('erro:', e.message);
      process.exitCode = 1;
    }
  }
  console.log(require('../src/utils/sb').sbEnabled() ? 'Pronto: Supabase' : `Pronto: ${usersFile()}`);
})();
```

(Trocar `require('../src/utils/sb')` repetido por um `const { sbEnabled } = require('../src/utils/sb');` no topo do arquivo — mantendo o import de `addUser, usersFile` existente.)

Verificação (usando arquivo temporário — não polua o `auth/users.json` real):

```powershell
$env:USERS_FILE = "$env:TEMP\vs-init-test.json"
node scripts/init-users.js --user teste@x.com:senha12345:founder
Remove-Item Env:USERS_FILE; Remove-Item "$env:TEMP\vs-init-test.json" -ErrorAction SilentlyContinue
```
Expected: `ok: teste@x.com (founder) — hash scrypt gravado em ...vs-init-test.json` + `Pronto: ...`, sem senha na saída.

- [ ] **Step 10: Rodar suíte completa**

Run: `npm test`
Expected: todos verdes (arquivos explícitos da linha 7)

- [ ] **Step 11: E2E local manual (login real via servidor)**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*serve-web*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process node -ArgumentList 'scripts/serve-web.js' -WindowStyle Hidden
Start-Sleep -Seconds 2
curl.exe -s -X POST http://localhost:8901/api/login -H 'Content-Type: application/json' -d '{"user":"landevbrasil.ia@gmail.com","pass":"iloveTI@26"}' -c "$env:TEMP\vs-cookie.txt"
curl.exe -s http://localhost:8901/api/me -b "$env:TEMP\vs-cookie.txt"
curl.exe -s -X POST http://localhost:8901/api/logout -b "$env:TEMP\vs-cookie.txt" -c "$env:TEMP\vs-cookie.txt"
curl.exe -s http://localhost:8901/api/me -b "$env:TEMP\vs-cookie.txt"
```
Expected: login `{"ok":true,...}` → me `{"user":...}` → logout `{"ok":true}` → me `401 unauthorized`. Este passo roda no modo **local** (o `.env` ainda não tem Supabase).

- [ ] **Step 12: Commit**

```bash
git add src/utils/user-store.js src/utils/cookies.js src/utils/http-json.js scripts/serve-web-auth.js scripts/serve-web.js scripts/init-users.js src/tests/login.test.js src/tests/user-store.test.js
git commit -m "virgo-scout: store com dispatcher supabase, attemptLogin e sessoes fora da memoria"
```

---

### Task 4: `sync-supabase` + extração de `leads-io`

**Files:**
- Create: `src/utils/leads-io.js`, `scripts/sync-supabase.js`
- Test: `src/tests/sync.test.js`
- Modify: `scripts/serve-web.js` (usar `leads-io`), `package.json` (script `sync` + lista de testes)

**Interfaces:**
- Consumes: `sbEnabled/sbFetch` (Task 1).
- Produces: `newestLeadsFile(dataDir) → string | null`; `leadId(lead) → string` (sha1 hex); `syncLeads({ dataDir?, runBuild? }) → Promise<{ file, synced }>`; CLI `npm run sync`.

- [ ] **Step 1: Extrair `newestLeadsFile` para `src/utils/leads-io.js`**

Criar `src/utils/leads-io.js` (corpo copiado de `serve-web.js:43-55`, com `dataDir` parametrizado):

```js
/* Localização do JSON de leads mais recente — usada por serve-web e sync */
const fs = require('node:fs');
const path = require('node:path');

function newestLeadsFile(dataDir) {
  const preferred = [process.env.BASENAME ? `${process.env.BASENAME}.v2.json` : null, 'advogados-df-max.v2.json', 'advogados-df-max.json'].filter(Boolean);
  for (const f of preferred) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) return p;
  }
  const any = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && !f.includes('validacao') && !f.includes('job'))
    .map((f) => ({ f, m: fs.statSync(path.join(dataDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return any.length ? path.join(dataDir, any[0].f) : null;
}

module.exports = { newestLeadsFile };
```

Em `scripts/serve-web.js`: remover a função local `newestLeadsFile` (43–55), adicionar `const { newestLeadsFile } = require('../src/utils/leads-io');` e trocar a chamada em `readLeads` para `newestLeadsFile(DATA)`.

- [ ] **Step 2: Escrever o teste falhando**

`src/tests/sync.test.js`:

```js
// Testes do sync de leads → Supabase (fetch stubado)
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-sync-'));
fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify([
  { name: '  Advogado  Teste ', address: 'Rua A, 1 — Brasília', rating: 4.5, reviews: 10, phone: '619999', website: null, source: 'q', area: 'Civil', area_conf: 0.8, captured_at: '2026-10-01T00:00:00.000Z' },
  { name: 'Outro Escritório', address: 'Quadra B', rating: null, reviews: null, phone: null, website: 'https://x.com', source: 'q', area: 'Família', area_conf: 0.7, captured_at: '2026-10-01T00:00:00.000Z' },
]));

const nativeFetch = global.fetch;
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
});
after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  global.fetch = nativeFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('leadId é estável e normaliza espaços/caixa', () => {
  const { leadId, norm } = require('../../scripts/sync-supabase');
  assert.strictEqual(norm('  Advogado  Teste '), 'advogado teste');
  const a = leadId({ name: '  Advogado  Teste ', address: 'Rua A' });
  const b = leadId({ name: 'advogado teste', address: 'rua a' });
  assert.strictEqual(a, b);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test('syncLeads faz upsert em batch e registra captures', async () => {
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 201, text: async () => '' };
  };
  const r = await syncLeads({ dataDir: TMP, runBuild: false });
  assert.strictEqual(r.synced, 2);
  const leadsCall = calls.find((c) => c.url.includes('/rest/v1/leads'));
  assert.ok(leadsCall.url.includes('on_conflict=id'));
  assert.strictEqual(leadsCall.opts.method, 'POST');
  assert.strictEqual(leadsCall.opts.headers.Prefer, 'resolution=merge-duplicates');
  const rows = JSON.parse(leadsCall.opts.body);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, '  Advogado  Teste ');
  assert.match(rows[0].id, /^[0-9a-f]{40}$/);
  assert.strictEqual(rows[0].rating, 4.5);
  assert.strictEqual(rows[1].rating, null);
  const capCall = calls.find((c) => c.url.includes('/rest/v1/captures'));
  const cap = JSON.parse(capCall.opts.body);
  assert.strictEqual(cap[0].status, 'done');
  assert.strictEqual(cap[0].leads_count, 2);
});

test('syncLeads sem env configurado → erro claro', async () => {
  delete process.env.SUPABASE_URL;
  const { syncLeads } = require('../../scripts/sync-supabase');
  await assert.rejects(syncLeads({ dataDir: TMP, runBuild: false }), /SUPABASE_URL/);
});

test('batching: 1346 leads → 3 requisições (500+500+346)', async () => {
  const big = Array.from({ length: 1346 }, (_, i) => ({ name: `Lead ${i}`, address: `End ${i}` }));
  fs.writeFileSync(path.join(TMP, 'leads-teste.v2.json'), JSON.stringify(big));
  const { syncLeads } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  const r = await syncLeads({ dataDir: TMP, runBuild: false });
  assert.strictEqual(r.synced, 1346);
  const leadCalls = calls.filter((c) => c.url.includes('/rest/v1/leads'));
  assert.strictEqual(leadCalls.length, 3);
  assert.strictEqual(JSON.parse(leadCalls[0].opts.body).length, 500);
  assert.strictEqual(JSON.parse(leadCalls[2].opts.body).length, 346);
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `node --test src/tests/sync.test.js`
Expected: FAIL — `Cannot find module '../../scripts/sync-supabase'`

- [ ] **Step 4: Implementar `scripts/sync-supabase.js`**

```js
/* Sobe o JSON de leads local para o Supabase (upsert) e registra o job em captures.
   npm run sync  |  automático ao fim da captura (se sbEnabled) */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sbEnabled, sbFetch } = require('../src/utils/sb');
const { newestLeadsFile } = require('../src/utils/leads-io');

const CHUNK = 500;

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function leadId(lead) {
  return crypto.createHash('sha1').update(`${norm(lead.name)}|${norm(lead.address)}`).digest('hex');
}

function toRow(l) {
  return {
    id: leadId(l),
    name: l.name || null,
    rating: l.rating ?? null,
    reviews: l.reviews ?? null,
    address: l.address || null,
    phone: l.phone || null,
    website: l.website || null,
    source: l.source || null,
    area: l.area || null,
    area_conf: l.area_conf ?? null,
    captured_at: l.captured_at || null,
  };
}

async function syncLeads({ dataDir, runBuild = true } = {}) {
  if (!sbEnabled()) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY não configurados');
  const dir = dataDir || path.join(__dirname, '..', 'data');
  const file = newestLeadsFile(dir);
  if (!file) throw new Error(`nenhum JSON de leads em ${dir}`);
  const leads = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = leads.map(toRow);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sbFetch('leads?on_conflict=id', {
      method: 'POST',
      body: rows.slice(i, i + CHUNK),
      headers: { Prefer: 'resolution=merge-duplicates' },
    });
  }
  await sbFetch('captures', {
    method: 'POST',
    body: [{ status: 'done', finished_at: new Date().toISOString(), leads_count: rows.length }],
  });
  if (runBuild) execFileSync(process.execPath, [path.join(__dirname, 'build-web-data.js')], { stdio: 'inherit' });
  return { file: path.basename(file), synced: rows.length };
}

if (require.main === module) {
  syncLeads()
    .then((r) => console.log(`[sync] ${r.synced} leads → Supabase (${r.file})`))
    .catch((e) => { console.error('[sync]', e.message); process.exit(1); });
}

module.exports = { norm, leadId, syncLeads };
```

- [ ] **Step 5: Rodar para ver passar + npm scripts**

Run: `node --test src/tests/sync.test.js` → PASS (4 testes)

`package.json`:
- adicionar ao objeto `scripts`: `"sync": "node scripts/sync-supabase.js"`
- acrescentar `src/tests/sync.test.js` na lista do `test`

Run: `npm test` → todos verdes

- [ ] **Step 6: Commit**

```bash
git add src/utils/leads-io.js scripts/sync-supabase.js src/tests/sync.test.js scripts/serve-web.js package.json
git commit -m "virgo-scout: sync de leads para o supabase (upsert por lote + captures)"
```

---

### Task 5: `queries.js` extraído + hook de sync na captura

**Files:**
- Create: `scripts/queries.js`
- Modify: `scripts/capture-advogados-df.js` (usa `queries` + sync ao fim), `scripts/serve-web.js` (2 require)

**Interfaces:**
- Consumes: `syncLeads`, `sbEnabled` (Task 4).
- Produces: `scripts/queries.js → { QUERIES: string[] }` (sem Playwright — obrigatório p/ `api/queries.js` na Vercel).

- [ ] **Step 1: Criar `scripts/queries.js`**

Conteúdo exato do array atual de `capture-advogados-df.js:6-33`:

```js
/* Queries de captura — módulo leve sem Playwright (compartilhado por capture, serve-web e Vercel) */
const QUERIES = [
  'advogados Distrito Federal',
  'advogado Brasília DF',
  'escritório de advocacia Brasília',
  'advocacia Asa Sul Brasília',
  'advocacia Asa Norte Brasília',
  'advogado Taguatinga DF',
  'advogado Ceilândia DF',
  'advogado Águas Claras DF',
  'advogado trabalhista Brasília',
  'advogado criminal Brasília',
  'advogado civil Brasília',
  'advogado previdenciário Brasília',
  'advogado empresarial Brasília',
  'advogado família Brasília',
  'advogado Guará DF',
  'advogado Samambaia DF',
  'advogado Sobradinho DF',
  'advogado Gama DF',
  'advogado Santa Maria DF',
  'advogado Planaltina DF',
  'advogado tributário Brasília',
  'advogado imobiliário Brasília',
  'advogado consumidor Brasília',
  'advogado trânsito Brasília',
  'advogado previdência Brasília',
  'advogado inventário Brasília',
];

module.exports = { QUERIES };
```

- [ ] **Step 2: Trocar em `capture-advogados-df.js`**

1. Após a linha 4 (requires), remover o `const QUERIES = [...]` (linhas 6–33) e colocar:
```js
const { QUERIES } = require('./queries');
const { sbEnabled } = require('../src/utils/sb');
const { syncLeads } = require('./sync-supabase');
```
2. No fim do `main()`, após `console.log(JSON.stringify(out, null, 2));`:
```js
  if (sbEnabled()) {
    try {
      const s = await syncLeads({ runBuild: true });
      console.log(`[sync] ${s.synced} leads → Supabase (${s.file})`);
    } catch (e) {
      console.error('[sync] falhou (captura salva localmente):', e.message);
    }
  }
```
3. Manter `module.exports = { QUERIES };` no final (compat).

- [ ] **Step 3: Trocar os requires de queries em `serve-web.js`**

- `startCapture` (linha ~120): `const { QUERIES } = require('./queries');` (substitui `require('./capture-advogados-df')` — passa a não carregar Playwright para listar queries).
- Rota `/api/queries` (linha ~228): idem troca.

- [ ] **Step 4: Verificar**

```powershell
node --check scripts/queries.js; node --check scripts/capture-advogados-df.js; node --check scripts/serve-web.js
node -e "const {QUERIES}=require('./scripts/queries'); console.log('queries:', QUERIES.length)"
npm test
```
Expected: sintaxe ok, `queries: 26`, suíte verde.

**Captura real (opcional, ~2–4 min, requer navegador):** peça permissão ao usuário e rode `npm run capture:quick` com o `.env` já configurado (Task 7) — confirme no log final `[sync] N leads → Supabase` e a linha nova em `captures`. Sem permissão/bloqueio, o caminho fica coberto pelos testes unitários do sync (a lógica nova é só o bloco final do `main()`).

- [ ] **Step 5: Commit**

```bash
git add scripts/queries.js scripts/capture-advogados-df.js scripts/serve-web.js
git commit -m "virgo-scout: queries em modulo leve e sync automatico ao fim da captura"
```

---

### Task 6: Funções da Vercel (`api/*`) + `vercel.json` + mensagem local-only

**Files:**
- Create: `api/login.js`, `api/logout.js`, `api/me.js`, `api/leads.js`, `api/insight.js`, `api/capture.js`, `api/queries.js`, `vercel.json`
- Modify: `web/app.js:120` (mensagem `local-only`), `package.json` (lista de testes)
- Test: `src/tests/api.test.js`

**Interfaces:**
- Consumes: `attemptLogin/sessionUser` (Task 3), `session-store` (Task 2), `sb.js` (Task 1), `cookies/http-json` (Task 3), `groq.js`, `metrics.js`, `scripts/queries.js`.
- Produces: handlers Vercel `module.exports = async (req, res) => {...}` (CJS). `req.body` já vem parseado; `res.writeHead/setHeader/end` nativos.

- [ ] **Step 1: Escrever o teste falhando**

`src/tests/api.test.js`:

```js
// Testes das funções Vercel (fake req/res, store local em TMP, sessões em memória)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-api-'));
process.env.USERS_FILE = path.join(TMP, 'users.json');

const { addUser } = require('../../src/utils/user-store');
const loginH = require('../../api/login');
const logoutH = require('../../api/logout');
const meH = require('../../api/me');
const leadsH = require('../../api/leads');
const insightH = require('../../api/insight');
const captureH = require('../../api/capture');
const queriesH = require('../../api/queries');

before(() => addUser('landevbrasil.ia@gmail.com', 'founder', 'iloveTI@26'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function fakeReq({ method = 'GET', cookie, body, ip = '10.0.0.1' } = {}) {
  return { method, headers: { ...(cookie ? { cookie } : {}), 'x-forwarded-for': ip }, body, socket: { remoteAddress: ip } };
}
function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = String(v); },
    writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, h); },
    end(b) { this.body = b ? JSON.parse(b) : null; },
  };
}
function cookieDe(res) { return (res.headers['Set-Cookie'] || '').split(';')[0]; }

test('login: 405 em GET; 401 com senha errada; 200 + cookie HttpOnly com sucesso; depois me responde', async () => {
  const r1 = fakeRes();
  await loginH(fakeReq({ method: 'GET' }), r1);
  assert.strictEqual(r1.statusCode, 405);

  const r2 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'errada' }, ip: 'api-a' }), r2);
  assert.strictEqual(r2.statusCode, 401);

  const r3 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-b' }), r3);
  assert.strictEqual(r3.statusCode, 200);
  assert.strictEqual(r3.body.role, 'founder');
  const ck = cookieDe(r3);
  assert.ok(ck.startsWith('vs_auth='));
  assert.ok(r3.headers['Set-Cookie'].includes('HttpOnly'));

  const r4 = fakeRes();
  await meH(fakeReq({ cookie: ck }), r4);
  assert.strictEqual(r4.statusCode, 200);
  assert.deepStrictEqual(r4.body, { user: 'landevbrasil.ia@gmail.com', role: 'founder' });

  const r5 = fakeRes();
  await logoutH(fakeReq({ method: 'POST', cookie: ck }), r5);
  assert.strictEqual(r5.statusCode, 200);
  assert.ok(r5.headers['Set-Cookie'].includes('Max-Age=0'));
  const r6 = fakeRes();
  await meH(fakeReq({ cookie: ck }), r6);
  assert.strictEqual(r6.statusCode, 401);
});

test('endpoints exigem sessão: me/leads/insight/capture/queries sem cookie → 401', async () => {
  for (const h of [meH, leadsH, insightH, captureH, queriesH]) {
    const r = fakeRes();
    await h(fakeReq({ method: 'POST', body: { q: 'x' } }), r);
    assert.strictEqual(r.statusCode, 401, h.name);
  }
});

test('leads sem SUPABASE configurado → 503 supabase_down (fail-closed)', async () => {
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-c' }), r0);
  const r = fakeRes();
  await leadsH(fakeReq({ cookie: cookieDe(r0) }), r);
  assert.strictEqual(r.statusCode, 503);
  assert.strictEqual(r.body.error, 'supabase_down');
});

test('capture: GET com sessão sem SUPABASE → 503; POST → 503 local-only', async () => {
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-d' }), r0);
  const ck = cookieDe(r0);
  const rGet = fakeRes();
  await captureH(fakeReq({ cookie: ck }), rGet);
  assert.strictEqual(rGet.statusCode, 503);
  const rPost = fakeRes();
  await captureH(fakeReq({ method: 'POST', cookie: ck }), rPost);
  assert.strictEqual(rPost.statusCode, 503);
  assert.strictEqual(rPost.body.error, 'local-only');
});

test('capture GET com fetch stubado devolve idle (nunca done, p/ não gerar reload em loop)', async () => {
  // 1) login PRIMEIRO em modo local (sessão em memória); 2) só então liga o Supabase p/ a chamada GET
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-e' }), r0);
  const ck = cookieDe(r0);
  const nativeFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  global.fetch = async (url) => {
    if (url.includes('/sessions?')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ token_hash: 'h', email: 'landevbrasil.ia@gmail.com', role: 'founder', exp: new Date(Date.now() + 60000).toISOString() }]) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify([{ status: 'done', finished_at: '2026-10-01T00:00:00Z', leads_count: 10, queries: 5 }]) };
  };
  try {
    const r = fakeRes();
    await captureH(fakeReq({ cookie: ck }), r);
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.body.status, 'idle');
    assert.strictEqual(r.body.last.leads_count, 10);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    global.fetch = nativeFetch;
  }
});

test('insight: 400 em q vazia; queries devolve a lista de 26', async () => {
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-f' }), r0);
  const ck = cookieDe(r0);
  const r1 = fakeRes();
  await insightH(fakeReq({ method: 'POST', cookie: ck, body: { q: '' } }), r1);
  assert.strictEqual(r1.statusCode, 400);
  const r2 = fakeRes();
  await queriesH(fakeReq({ cookie: ck }), r2);
  assert.strictEqual(r2.statusCode, 200);
  assert.strictEqual(r2.body.queries.length, 26);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/api.test.js`
Expected: FAIL — `Cannot find module '../../api/login'`

- [ ] **Step 3: Implementar as 7 funções**

`api/login.js`:
```js
const { attemptLogin } = require('../scripts/serve-web-auth');
const { authCookie } = require('../src/utils/cookies');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const ip = req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?';
  const b = req.body || {};
  try {
    const r = await attemptLogin({ email: b.user, pass: b.pass, keep: !!b.keep, ip });
    if (r.token) res.setHeader('Set-Cookie', authCookie(r.token, { maxAge: r.keep ? Math.floor(r.ttlMs / 1000) : 0 }));
    json(res, r.status, r.body);
  } catch (e) {
    console.error('[api/login]', e);
    json(res, 500, { error: 'internal' });
  }
};
```

`api/logout.js`:
```js
const { parseCookies, clearAuthCookie } = require('../src/utils/cookies');
const { destroySession } = require('../src/utils/session-store');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const token = parseCookies(req.headers.cookie).vs_auth;
  if (token) { try { await destroySession(token); } catch (e) { console.error('[api/logout]', e); } }
  res.setHeader('Set-Cookie', clearAuthCookie());
  json(res, 200, { ok: true });
};
```

`api/me.js`:
```js
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  json(res, 200, { user: sess.email, role: sess.role });
};
```

`api/leads.js`:
```js
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetch, SbError } = require('../src/utils/sb');
const { buildPayload } = require('../src/utils/metrics');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  try {
    const rows = await sbFetch('leads?select=*');
    const payload = buildPayload(rows || [], { dataDir: '/tmp' });
    payload.source = 'supabase';
    json(res, 200, payload);
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    console.error('[api/leads]', e);
    json(res, 500, { error: 'internal' });
  }
};
```

`api/insight.js`:
```js
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetch, SbError } = require('../src/utils/sb');
const { buildPayload } = require('../src/utils/metrics');
const { askGroq, formatContext } = require('../scripts/groq');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  const b = req.body || {};
  const q = String(b.q || '').slice(0, 1000);
  const history = Array.isArray(b.history) ? b.history.slice(-6) : [];
  if (!q) { json(res, 400, { error: 'empty_q' }); return; }
  try {
    const rows = await sbFetch('leads?select=*');
    const payload = buildPayload(rows || [], { dataDir: '/tmp' });
    const r = await askGroq({ question: q, context: formatContext(payload), history });
    json(res, 200, { answer: r.answer, source: 'groq' });
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    json(res, 503, { error: e.code || 'groq_down' });
  }
};
```

`api/capture.js`:
```js
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetch, SbError } = require('../src/utils/sb');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  if (req.method === 'POST') { json(res, 503, { error: 'local-only', message: 'Capture na máquina local' }); return; }
  try {
    const rows = await sbFetch('captures?select=*&order=finished_at.desc&limit=1');
    const row = rows && rows[0];
    if (row && row.status === 'running') {
      json(res, 200, { status: 'running', started_at: row.started_at, total: row.queries, done: 0, current: null });
      return;
    }
    // idle: UI trata 'done' como "concluir e recarregar" — nuvem não recarrega
    json(res, 200, { status: 'idle', last: row || null });
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    console.error('[api/capture]', e);
    json(res, 500, { error: 'internal' });
  }
};
```

`api/queries.js` (sessão ANTES do método, igual à camada de auth local):

```js
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { QUERIES } = require('../scripts/queries');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return; }
  json(res, 200, { queries: QUERIES });
};
```

`vercel.json`:
```json
{
  "outputDirectory": "web",
  "cleanUrls": true
}
```

- [ ] **Step 4: Rodar teste de API**

Run: `node --test src/tests/api.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Ajuste de 1 linha em `web/app.js` (mensagem local-only)**

Linha 120 (branch de erro do `startCapture`) — adicionar o caso `local-only`:

```js
        else { btn.disabled = false; btn.textContent = 'Tentar de novo'; $('#capSub').textContent = res.b.error === 'already_running' ? 'Já existe uma captura em andamento' : res.b.error === 'local-only' ? 'Capture na máquina local' : 'Erro ao iniciar'; }
```

(Use `grep` para pegar a linha exata antes de editar — o arquivo é UTF-8; preserve os acentos das strings existentes.)

- [ ] **Step 6: Impercetible detect**

```powershell
& C:\Users\alanj\.config\opencode\skills\impeccable\scripts\impeccable.cmd detect --json web\app.js
```
Expected: **0 erros** (warnings aceitáveis; se houver erro, corrija antes de seguir).

- [ ] **Step 7: npm scripts + suíte completa**

`package.json` — acrescentar `src/tests/api.test.js` na lista do `test`.
Run: `npm test` → todos verdes.

- [ ] **Step 8: Commit**

```bash
git add api/ vercel.json web/app.js src/tests/api.test.js package.json
git commit -m "virgo-scout: funcoes da vercel (login/me/leads/insight/capture/queries) e vercel.json"
```

---

### Task 7: E2E no Supabase real (SQL → seed → sync → login)

**Checkpoint humano aqui:** o SQL da migration precisa ser aplicado no SQL Editor — só você pode fazer isso (não tenho connection string nem PAT do CLI).

**Files:**
- Modify (apenas se E2E revelar bug): o que for preciso
- `.env` local (NÃO versionado)

**Interfaces:**
- Consome: tudo das tasks 1–6.

- [ ] **Step 1: PARADA — pedir ao usuário para aplicar a migration**

Diga ao usuário:

> Cole o conteúdo de `supabase/migrations/0001_init.sql` no SQL Editor do Supabase (https://supabase.com/dashboard → seu projeto → SQL Editor → New query → Run) e me avise quando terminar.

Aguarde a confirmação. Não siga sem ela.

- [ ] **Step 2: Configurar `.env` local (valores da sessão; arquivo gitignored)**

Acrescentar ao `.env` (nunca commitar):

```
SUPABASE_URL=https://mndsqufddfckikkprxpj.supabase.co
SUPABASE_SECRET_KEY=<sb_secret fornecido na sessão — NUNCA versionar>
```

- [ ] **Step 3: Verificar que as 4 tabelas existem**

```powershell
node -e "(async()=>{require('dotenv').config();const {sbFetch}=require('./src/utils/sb');const ts=['users','sessions','leads','captures'];for(const t of ts){await sbFetch(t+'?select=*&limit=1');console.log('ok:',t)}})().catch(e=>{console.error('FALHA (SQL não aplicado?):',e.message);process.exit(1)})"
```
Expected: `ok: users` … `ok: captures`. Se FALHAL: tabela não existe ⇒ volte ao Step 1.

- [ ] **Step 4: Seed dos usuários SEM senha em claro (copia salt/hash do JSON local)**

```powershell
node -e "(async()=>{require('dotenv').config();const fs=require('fs');const {sbFetch}=require('./src/utils/sb');const s=JSON.parse(fs.readFileSync('auth/users.json','utf8'));const rows=s.users.map(u=>({email:u.email,role:u.role,algo:u.algo,salt:u.salt,hash:u.hash,created_at:u.created_at||new Date().toISOString()}));await sbFetch('users?on_conflict=email',{method:'POST',body:rows,headers:{Prefer:'resolution=merge-duplicates,return=representation'}});console.log('seed ok:',rows.map(r=>r.email+' ('+r.role+')').join(', '))})().catch(e=>{console.error(e.message);process.exit(1)})"
```
Expected: `seed ok: landevbrasil.ia@gmail.com (founder), contatodylanjunio@gmail.com (cofounder)`

- [ ] **Step 5: Sync dos leads + conferência de contagem**

```powershell
npm run sync
node -e "(async()=>{require('dotenv').config();const {sbFetch}=require('./src/utils/sb');const l=await sbFetch('leads?select=id');console.log('leads no banco:',l.length);const c=await sbFetch('captures?select=*&order=finished_at.desc&limit=1');console.log('captures:',JSON.stringify(c[0]))})().catch(e=>{console.error(e.message);process.exit(1)})"
```
Expected: `leads no banco: 1346` (ou a contagem atual do JSON) e uma linha `captures` com `status:"done"`.

- [ ] **Step 6: Login local REAL contra o Supabase**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*serve-web*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process node -ArgumentList 'scripts/serve-web.js' -WindowStyle Hidden
Start-Sleep -Seconds 2
curl.exe -s -X POST http://localhost:8901/api/login -H 'Content-Type: application/json' -d '{"user":"landevbrasil.ia@gmail.com","pass":"iloveTI@26"}' -c "$env:TEMP\vs-cookie.txt"
curl.exe -s http://localhost:8901/api/me -b "$env:TEMP\vs-cookie.txt"
curl.exe -s http://localhost:8901/api/leads -b "$env:TEMP\vs-cookie.txt" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('source?',j.source,'stats?',!!j.stats,'total?',j.stats&&j.stats.total)})"
```
Expected: login 200 (sessão criada **na tabela `sessions`** — confirme: `node -e "require('dotenv').config();require('./src/utils/sb').sbFetch('sessions?select=email,role').then(r=>console.log(r))"` retorna 1 linha), me 200, e leads com `stats.total` = 1346 e `source` = nome do arquivo `.v2.json` (**local lê o JSON local** por design — só a Vercel lê `supabase`).

- [ ] **Step 7: Prova do fail-closed (Supabase fora → 503, sem fallback)**

```powershell
node -e "const{attemptLogin}=require('./scripts/serve-web-auth');(async()=>{process.env.SUPABASE_URL='https://url-invalida.supabase.co';process.env.SUPABASE_SECRET_KEY='x';const r=await attemptLogin({email:'a@b.c',pass:'12345678',ip:'x1'});console.log('status:',r.status,r.body.error)if(r.status!==503)process.exit(1)})()"
```
Expected: `status: 503 setup_required`

- [ ] **Step 8: Suíte completa (prova que os guards de env funcionam)**

Run: `npm test`
Expected: todos verdes mesmo com `.env` completo (os testes apagam `SUPABASE_*` no topo).

- [ ] **Step 9: Commit (se E2E gerou ajustes de código; `.env` NUNCA)**

```bash
git status --short   # só deve aparecer código/auxiliares, nunca .env
git add -A -- ':!.env'
git commit -m "virgo-scout: e2e supabase (seed, sync e login real)" || echo "sem alteracoes p/ commitar"
```

---

### Task 8: Deploy na Vercel (env → preview → smoke → prod)

**Files:**
- Modify: `.gitignore` (`.vercel/`)
- Gerado (não commitar): `.vercel/`

- [ ] **Step 1: Ignorar `.vercel/`**

`.gitignore` — acrescentar linha:
```
.vercel/
```

- [ ] **Step 2: Definir env vars do projeto**

```powershell
$t = (Get-Content "$env:TEMP\vercel-token.txt" -Raw).Trim()
$e = @{}; Get-Content .env | ForEach-Object { if ($_ -match '^([A-Za-z_]+)=(.*)$') { $e[$matches[1]] = $matches[2].Trim('"') } }
foreach ($k in 'SUPABASE_URL','SUPABASE_SECRET_KEY','GROQ_API_KEY') {
  $e[$k] | vercel env add $k production --token=$t
  if (-not $?) { Write-Host "FALHOU env $k"; break }
}
vercel env ls production --token=$t
```
Expected: 3 envs listadas (sem exibir valores).

- [ ] **Step 3: Link do projeto + deploy de preview**

```powershell
vercel link --yes --project virgo-scout --token=$t
# se "project not found": vercel project add virgo-scout --token=$t e repita o link
vercel deploy --token=$t
```
Anote a URL de preview retornada (`https://<algo>-<user>.vercel.app`). Salve-a em `$prev`.

- [ ] **Step 4: Smoke test no preview**

```powershell
$prev = 'https://URL-DO-PREVIEW'
curl.exe -s -X POST "$prev/api/login" -H 'Content-Type: application/json' -d '{"user":"landevbrasil.ia@gmail.com","pass":"iloveTI@26"}' -c "$env:TEMP\vs-prev.txt"
curl.exe -s "$prev/api/me" -b "$env:TEMP\vs-prev.txt"
curl.exe -s "$prev/api/leads" -b "$env:TEMP\vs-prev.txt" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('stats?',!!j.stats,'total?',j.stats&&j.stats.total,'source?',j.source)})"
curl.exe -s -X POST "$prev/api/insight" -H 'Content-Type: application/json' -d '{"q":"quantos leads temos e qual a area com mais empresas?"}' -b "$env:TEMP\vs-prev.txt"
```
Expected: login `{"ok":true,...}`; me com role; leads `stats true / total 1346 / source supabase`; insight com `"source":"groq"` e texto de resposta.
**Se o preview responder `401` de proteção do Vercel** (Deployment Protection do time): desative em Settings → Deployment Protection, ou siga direto para o Step 5 e teste o smoke em produção.

- [ ] **Step 5: Deploy de produção + smoke final**

```powershell
vercel deploy --prod --token=$t
$prod = 'https://virgo-scout.vercel.app'   # use a URL retornada pelo comando acima
curl.exe -s -X POST "$prod/api/login" -H 'Content-Type: application/json' -d '{"user":"landevbrasil.ia@gmail.com","pass":"iloveTI@26"}' -c "$env:TEMP\vs-prod.txt"
curl.exe -s "$prod/api/me" -b "$env:TEMP\vs-prod.txt"
curl.exe -s "$prod/api/leads" -b "$env:TEMP\vs-prod.txt" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('stats?',!!j.stats,'total?',j.stats&&j.stats.total)})"
curl.exe -s -X POST "$prod/api/insight" -H 'Content-Type: application/json' -d '{"q":"resuma o painel em uma frase"}' -b "$env:TEMP\vs-prod.txt"
```
Expected: mesma semântica do preview. Anote a URL final.

- [ ] **Step 5b: Conferir estático + estado vazio (delta/recent nulos no cloud)**

```powershell
curl.exe -s -o NUL -w "GET / -> %{http_code}`n" "$prod/"
curl.exe -s -o NUL -w "GET /login -> %{http_code}`n" "$prod/login"
curl.exe -s -o NUL -w "GET /login.html -> %{http_code}`n" "$prod/login.html"
```
Expected: 200, 200, 200 (redirect/rewrite do `cleanUrls`).
Depois, **abra `$prod` no navegador**: dashboard tem que renderizar (stats/mapa) com o card de captura mostrando estado vazio — `delta_pct`/`recent` vindo `null` não pode quebrar a UI (spec, riscos abertos). Se quebrar, corrigir o estado vazio em `web/app.js` e re-deploy.

- [ ] **Step 6: Conferir que nenhum segredo foi versionado**

```powershell
git status --short
git diff HEAD --stat
git grep -n "sb_secret" -- . ':!*.md'; git grep -n "gsk_" -- . ':!*.md'
```
Expected: `.vercel/` e `.env` fora do stage; 0 ocorrências de chaves fora do `.env`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore
git commit -m "virgo-scout: deploy vercel (outputDirectory web + api serverless)"
```

---

### Task 9: Push + atualização do brain

- [ ] **Step 1: Push do projeto**

```powershell
git log --oneline -10   # revisar sequência
git push
```

- [ ] **Step 2: Atualizar o brain (regra do cérebro: após push, atualizar nota + index + learnings)**

Em `C:\Users\alanj\vaults\brain\`:

- `projects/virgo-scout.md` — adicionar ao stack/status: Supabase (PostgREST via fetch, usuários+sessões+leads+captures), Vercel serverless (`outputDirectory: web` + `api/*`), URL de produção da Vercel; manter repositório/descrição atuais.
- `index.md` — atualizar a linha do projeto se a descrição/stack mudou.
- `learnings/virgo-scout.md` — acrescentar (formato: uma linha curta com contexto):
  - Vercel: `outputDirectory` (estático) e `api/` (funções) são detectados independentemente; funções CJS importam código relativo de `src/`/`scripts/` sem config extra.
  - Supabase sem SDK: PostgREST direto via `fetch` com `sb_secret_` + header `Prefer: resolution=merge-duplicates` para upsert — zero dependências.
  - Dispatcher condicional (sem env ⇒ síncrono, com env ⇒ Promise) evita refatorar toda a suíte ao ganhar backend remoto; regra: chamador de produção sempre `await`.
  - UI que recarrega em `status==='done'` (setCaptureUI) vira loop se a API de status devolver `done` sempre — API de nuvem deve devolver `idle`.

- [ ] **Step 3: Commit + push do brain**

```powershell
cd C:\Users\alanj\vaults\brain
git add index.md projects/virgo-scout.md learnings/virgo-scout.md
git commit -m "brain: virgo-scout com supabase + vercel"
git push
```

- [ ] **Step 4: Relatório final ao usuário**

Resumo: URL de produção, contagens (leads/usuários/sessões no banco), suíte verde, o que ficou local-only (captura) e limitação conhecida (shell estático público na Vercel; dados protegidos via API — gate de rota exige middleware, fora do escopo).
