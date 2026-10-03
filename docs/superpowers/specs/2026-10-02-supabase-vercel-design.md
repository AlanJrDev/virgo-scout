# Spec: Supabase como backend + deploy na Vercel

- **Data:** 2026-10-02
- **Status:** aprovado em design (Abordagem A — "camada única Supabase"); aguarda revisão do usuário
- **Classificação:** arquitetural

## Contexto

O painel (dashboard dark + login por e-mail/papéis) roda num servidor Node local (`scripts/serve-web.js`, porta 8901). A captura Playwright roda local. O login usa `user-store` (JSON + scrypt) e sessões em memória — nada disso sobrevive à Vercel (serverless efêmero). Já existe spec de auth multiusuário (`docs/superpowers/specs/2026-10-02-auth-multiuser-design.md`) que previu uma futura implementação Supabase atrás da mesma interface.

**Objetivo:** Supabase vira o backend de dados e auth (tudo no banco: usuários, sessões, leads, histórico de capturas) e o painel sobe funcionando na Vercel. A captura continua local (Vercel não roda navegador) e alimenta o banco via sync.

**Credenciais do projeto Supabase (fornecidas pelo usuário):**
- `SUPABASE_URL=https://mndsqufddfckikkprxpj.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=sb_publishable_…` (não usada nesta fase — o frontend não fala com Supabase direto)
- `SUPABASE_SECRET_KEY=sb_secret_…` (só servidor)
- `.env` local ganha os dois primeiros; Vercel ganha via `vercel env add`.

## Não-objetivos (YAGNI)

- Supabase Auth oficial (JWT deles, magic link, OAuth) — mantemos scrypt + papéis próprios.
- RLS com policies por papel — RLS fica negado por completo; acesso só pelo servidor com a secret key.
- Tempo real (subscriptions) do Supabase — o painel consulta `/api/leads` sob demanda.
- Captura na nuvem — impossível na Vercel; fica local para sempre nesta fase.
- `SESSION_SECRET` — desnecessário: o token de sessão é aleatório (32 bytes) e só o hash vai pro banco; não há assinatura a validar.

## 1. Schema Supabase

Migration versionada em `supabase/migrations/0001_init.sql`:

```sql
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
  token_hash text primary key,          -- sha256(hex) do token, nunca o token cru
  email text not null,
  role text not null,
  exp timestamptz not null
);
create index if not exists sessions_exp on sessions (exp);

create table if not exists leads (
  id text primary key,                  -- sha1(norm(name)|norm(address)), dedupe no upsert
  name text, rating numeric, reviews int, address text,
  phone text, website text, source text, area text, area_conf numeric,
  captured_at timestamptz
);
create index if not exists leads_captured on leads (captured_at desc);

create table if not exists captures (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null check (status in ('running','done','failed')),
  queries int, leads_count int
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table leads enable row level security;
alter table captures enable row level security;
-- sem policies = nega tudo para clientes anon/auth; só a service (secret key) acessa
```

**Normalização do id de lead:** `trim + lowercase + colapsar espaços duplos` sobre `name|address` (acentos preservados; os nomes vêm como já estão no JSON).

**Aplicação do SQL:** o arquivo fica no repo; nesta fase é aplicado pelo usuário colando no SQL Editor do Supabase (não temos personal access token do CLI nem connection string). A verificação E2E confirma as tabelas antes do seed. Se depois o usuário fornecer connection string, automatiza-se.

**Seed:**
- Usuários: `init-users` com `SUPABASE_URL` setado grava na tabela (mesmo formato salt/hash scrypt — senhas continuam as atuais, hashes são regenerados com salt novo, resultado idêntico em comportamento).
- Leads: primeiro `npm run sync` sobe os 1346 do `data/advogados-df-max.v2.json`.

## 2. Camada de acesso (zero dependências novas)

### `src/utils/sb.js` — cliente PostgREST mínimo
- `sbEnabled()` → bool (`SUPABASE_URL` + `SUPABASE_SECRET_KEY` presentes).
- `sbFetch(path, { method, body })` → `fetch` para `${SUPABASE_URL}/rest/v1/${path}` com headers `apikey`, `Authorization: Bearer <secret>`, `Content-Type`, `Prefer: return=representation` quando body. Lança `SbError` com `status` em falha de rede (→ 503) ou HTTP (→ propaga status).
- `sbRpc(name, args)` para funções SQL se necessário (não previsto no MVP).

Por que fetch puro: `@supabase/server` é orientado a Edge Functions/Hono (Deno); nosso stack é Node http comum — um cliente de ~60 linhas evita dependência nova e mantém CJS simples.

### `src/utils/user-store.js` — dispatcher
- Mantém **toda a API atual** (`readStore, writeStore, hashPassword, verifyPassword, findUser, listUsers, addUser, normEmail, ROLES, usersFile`).
- `sbEnabled()` → implementação Supabase; senão → JSON local atual (testes e dev offline continuam iguais).
- Implementação Supabase: `findUser` (`/users?email=eq.…`), `listUsers`, `addUser` (validações iguais, `INSERT`; `--force` = upsert), `readStore` → snapshot `{version:1, users:[…]}` ou `null` (indisponível ⇒ 503 fail-closed, mesma semântica de hoje).
- `verifyPassword` **não muda** — opera sobre `{salt, hash}` que a tabela também tem.
- **Sem fallback silencioso:** com `SUPABASE_URL` setado e Supabase fora → 503 (nunca cai pro JSON local, para não criar duas verdades).

### `src/utils/session-store.js` — novo
- API: `createSession({ email, role, ttlMs }) → token`, `getSession(token) → {email, role} | null`, `destroySession(token)`.
- Supabase: grava `sha256(token)` como `token_hash`; lookup por hash; expiração checada no select; limpeza oportunista (`delete where exp < now()`) a cada create.
- Memória (sem Supabase): o `Map` atual sai do `serve-web.js` pra cá.
- TTLs inalterados: 1 dia, 7 dias com "manter conectado".

### `scripts/serve-web-auth.js` — comum local + Vercel
- Ganha `attemptLogin({ email, pass, keep, ip }) → { status, body, token? }` e `sessionUser(token)` — pura, sem req/res; rate-limit mantido.
- O `serve-web.js` e as funções `api/*.js` são cascas finas sobre isso (parse de body/cookie e resposta são por adaptador).

## 3. Captura → banco

### `scripts/sync-supabase.js` (`npm run sync`)
1. Lê o `newestLeadsFile()` atual.
2. Upsert em `leads`: `POST /leads?on_conflict=id` + `Prefer: resolution=merge-duplicates` (reprocessar atualiza, nunca duplica).
3. Registra/atualiza a linha em `captures` (status `done`, `leads_count`, timestamps).
4. Roda `build:web` no final (mantém o artefato estático fresco como fallback).

### Gatilhos
- **Automático:** ao fim do `capture-advogados-df.js`, se `sbEnabled()` — chama sync; erro loga e não falha a captura.
- **Manual:** `npm run sync`.

### `/api/leads` por ambiente
- **Local:** continua lendo JSON local (funciona offline, é a fonte da captura).
- **Vercel:** lê `leads` do Supabase (sempre atualizado — sem redeploy a cada captura).

### Payload de métricas
- `buildPayload(leads, { dataDir, fallbackTs })` funciona sem `dataDir` válido (delta/recent viram `null` — já são tolerantes a erro). Na Vercel: `buildPayload(leads, { dataDir: '/tmp' })` ⇒ `delta_pct` e `recent` nulos; o frontend já trata ausência disso (stado vazio de captura). Isso é aceito: captura é local-only.
- `livePayload()` local permanece como está.

## 4. Deploy Vercel

### Estrutura
- `vercel.json`: `{ "outputDirectory": "web" }` — o site é o `web/` estático já existente; `api/*.js` viram funções automaticamente (detecção independente do outputDirectory).
- Frontend **não muda no fluxo de dados**: já chama `/api/*` relativo (mesma origem). Único ajuste previsto: `app.js` distinguir `error === 'local-only'` no POST de captura para mostrar "Capture na máquina local" em vez do genérico "Erro ao iniciar" (1 linha no branch de erro já existente).
- Funções (Node, CJS — `package.json` tem `"type": "commonjs"` ✓), todas importam de `../src/utils/*` e `../scripts/*` (bundle nft resolve):
  - `api/login.js` (POST) — `attemptLogin`, cookie `vs_auth`
  - `api/logout.js` (POST) — `destroySession`, limpa cookie
  - `api/me.js` (GET) — `sessionUser`
  - `api/leads.js` (GET) — Supabase → `buildPayload`
  - `api/insight.js` (POST) — sessão exigida → `askGroq` + contexto do payload Supabase (mesma fallback 503)
  - `api/capture.js` (GET status do banco `captures`; POST → `503 local-only`)
  - `api/queries.js` (GET) — mesmas queries locais (constante importada)
- `readBody` nas funções: Vercel já popula `req.body` (JSON) — casca fina.

### Env vars (Vercel)
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GROQ_API_KEY`. Local `.env` ganha `SUPABASE_URL`/`SUPABASE_SECRET_KEY` (publishable key fica registrada mas não usada).

### Fluxo de deploy
1. Captura/sync local (se houve novidade).
2. `vercel deploy --prod --token=<token de %TEMP%\vercel-token.txt>` (CLI já logada como `alandevbrasilia-5433`).
3. Smoke test na URL: login → `/api/leads` → `/api/insight`.

## 5. Segurança e erros

| Situação | Resposta |
|---|---|
| Supabase configurado mas inacessível (login/leads/insight) | `503 supabase_down` (fail-closed) |
| Sem `SUPABASE_URL` (dev/teste) | comportamento atual (JSON/memória) |
| Groq fora | `503` (já existe) |
| Credenciais erradas | `401` + rate-limit (5 falhas/60s → bloqueio 30s por IP) |
| Sessão expirada/apagada | `401` (igual hoje) |
| Cookie | `vs_auth` — **já confirmado** HttpOnly + SameSite=Lax (`serve-web.js:180`); manter idêntico na Vercel |

- Secret key nunca no browser nem no repo (env only).
- Rate-limit é por instância (na Vercel multi-instância fica menos efetivo) — aceito e documentado.
- `.gitignore` continua cobrindo `.env`, `auth/`; migration SQL não contém segredos.

## 6. Testes e verificação

- **Unit (mock de `fetch`):** `sb.js` (headers, path, erros de rede/HTTP), dispatcher do `user-store` (Supabase vs local), `session-store` (create/get/destroy/expiração/limpeza), `attemptLogin` com store remoto.
- **E2E local real:** contra o Supabase do usuário — tables existem (pré-condição), seed de usuários, login via `POST /api/login`, sync dos 1346 leads (contagem conferida), `/api/leads` local inalterado.
- **Deploy preview:** primeiro `vercel deploy` (URL de preview) com smoke test via `curl`; só após passar, `vercel deploy --prod`.
- **Suíte atual:** 37 testes continuam verdes (`npm test`); testes novos entram na lista explícita do script `test`.
- **Impeccable detect** em arquivos `web/` alterados (nesta fase: nenhum previsto além de possível ajuste mínimo de cookie — se houver, detect 0 erros).

## Critérios de aceite

1. `npm test` verde com testes novos (unit de sb/session-store/dispatcher/login).
2. Com `SUPABASE_URL` no `.env`: login local autentica contra o Supabase; sem env, continua no JSON.
3. `npm run sync` cria/atualiza as 1346 linhas de `leads` e uma linha `captures`.
4. Painel na Vercel: login com founder → `/api/leads` retorna métricas → `/api/insight` responde via Groq.
5. Captura local continua funcionando e sincroniza sozinha ao fim.
6. Nenhum segredo no git (`git log -p` sem sb_secret/gsk); skill `supabase-server` commitada.

## Riscos abertos

- **Aplicação do SQL** depende de ação manual do usuário (SQL Editor) — bloqueia seed/sync.
- Vercel sem `dataDir` ⇒ `delta_pct`/`recent` nulos no cloud (aceito; verificar estado vazio do frontend).
- Dados ficam temporariamente "velhos" na Vercel entre a captura e o sync (mitigado pelo sync automático).
