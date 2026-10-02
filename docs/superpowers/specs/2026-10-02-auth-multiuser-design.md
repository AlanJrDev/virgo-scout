# Spec — Auth multi-usuário com níveis (Virgo Scout)

Data: 2026-10-02 · Status: aprovado em chat, aguardando revisão do usuário · Sub-projeto A (o sub-projeto B, criptografia de dados sensíveis, terá spec próprio)

## Contexto

Hoje o painel tem um único par de credenciais (`LOGIN_USER`/`LOGIN_PASS` no `.env`, fallback fraco `admin/virgo123` hardcoded) e a sessão é booleana (`authed`). O objetivo é suportar **vários usuários com níveis** (papéis), começando por dois: founder e cofounder, com a possibilidade de adicionar mais níveis e, no futuro, trocar a fonte de dados por um banco Supabase/Postgres — sem refazer o servidor.

## Usuários iniciais

| E-mail | Papel |
|---|---|
| landevbrasil.ia@gmail.com | `founder` |
| contatodylanjunio@gmail.com | `cofounder` |

Nesta fase **ambos têm o mesmo acesso** (ler painel/leads, disparar captura, queries). O papel é registrado na sessão; restrições por nível entram em trabalho futuro quando definidas.

## Decisões de segurança

1. **Senha nunca é criptografada nem guardada em claro — é hasheada** com `crypto.scryptSync` (N=16384, r=8, p=1), salt aleatório de 16 bytes por usuário, verificação com `crypto.timingSafeEqual`.
2. **`auth/users.json` é gerado localmente e vai para o `.gitignore`** — hash de senha fraca é quebrável offline; nada de credenciais no repositório.
3. **Fail-closed**: se `auth/users.json` não existir (ou estiver malformado), o login responde `503 {error: 'setup_required'}`. Sem fallback de credenciais em código.
4. `LOGIN_USER`/`LOGIN_PASS` são **removidos** do `.env` e de todo o código (inclui defaults em `scripts/shot-ui.js` — passa a ler o e-mail/senha de variáveis novas `QA_USER`/`QA_PASS` no `.env`, usadas só pelos scripts de QA).
5. Sessão continua em memória com token `crypto.randomBytes(32)` e cookie `vs_auth` `HttpOnly; SameSite=Lax`; rate-limit 5 falhas/60s → 429 por 30s permanece.
6. Resposta de login/genérica não revela se o e-mail existe (erro `invalid` único).

## Modelo de dados — `auth/users.json`

```json
{
  "version": 1,
  "users": [
    {
      "email": "landevbrasil.ia@gmail.com",
      "role": "founder",
      "algo": "scrypt",
      "salt": "<16 bytes, base64>",
      "hash": "<scrypt, base64>",
      "created_at": "2026-10-02T00:00:00.000Z"
    }
  ]
}
```

- `role`: string enum por enquanto (`founder` | `cofounder`); valores futuros entram como novas strings, validadas no login (papel desconhecido → recusa).
- E-mail é a identidade (normalizado: trim + lowercase na comparação).

## Camada de acesso (preparada para Supabase)

Novo módulo `src/utils/user-store.js`:

```js
// interface (implementação local hoje)
findUser(email)        -> user | null   (lê auth/users.json a cada chamada — arquivo minúsculo, login é raro; sem cache)
verifyPassword(user, pass) -> boolean   (scrypt + timingSafeEqual)
listUsers()            -> [{email, role}]  (sem campos de hash — para /api/me e UI)
```

No futuro, `user-store-supabase.js` implementa a mesma interface consultando Postgres; `serve-web.js` apenas passa a importar outra implementação. Nada além do módulo muda.

## Seed — `scripts/init-users.js`

- Gera/substitui `auth/users.json` a partir de trios `email:senha:role` recebidos por argumentos (`--user email:senha:role`, repetível, ou posicional) ou env (`SEED_USERS="email:senha:role|email:senha:role"`); trios sem exatamente 3 campos recusam o script.
- Nunca imprime senha na saída; cria o diretório `auth/` com permissões normais e falha se o arquivo já existir sem `--force`.
- Rodado uma única vez nesta implementação com as credenciais fornecidas pelo usuário (fora do git, fora do histórico).

## Mudanças no servidor (`scripts/serve-web.js`, `scripts/serve-web-auth.js`)

- Sessão: `Map<token, {exp, email, role}>`; `sessionValid` passa a devolver a entrada da sessão.
- `POST /api/login`: `findUser` → `verifyPassword` → cria sessão → `200 {ok, user: email, role}`. Usuário inexistente e senha errada respondem igual (`401 invalid`) e contam no rate-limit.
- Novo `GET /api/me` (requer sessão): `200 {user, role}`; sem sessão → 401 como as demais APIs.
- Toda a autorização atual continua exigindo sessão; não há restrição por papel nesta fase.

## Mudanças no cliente

- `web/login.html`: placeholder do campo vira "seu e-mail"; `type="email"` com `autocomplete="username"`.
- `web/login.js`: envia `{user, pass, keep}` como hoje; trata `503 setup_required` com mensagem própria ("Painel não configurado — rode scripts/init-users.js").
- `web/app.js`: consumo opcional de `/api/me` para exibir e-mail+nível no cabeçalho (badge discreto) — incluído no escopo, mínimo: texto do e-mail + papel.

## Testes (`src/tests/login.test.js` reescrito + unitários do store)

1. Hash roundtrip: `init` → `verifyPassword` verdadeiro para a senha certa, falso para errada.
2. E-mail inexistente → falso; normalização de caixa/espaços.
3. Fail-closed: sem arquivo (ou JSON inválido) → login `503 setup_required`.
4. Papel desconhecido no arquivo → recusa no login.
5. `/api/me` devolve `{user, role}`; sem sessão → 401.
6. Rate-limit e unicidade de tokens (já existentes, mantidos).
7. `npm test` verde ao final.

## Arquivos tocados

- Novos: `src/utils/user-store.js`, `scripts/init-users.js`, `auth/users.json` (gerado, ignorado), este spec.
- Modificados: `scripts/serve-web.js`, `scripts/serve-web-auth.js`, `scripts/shot-ui.js`, `web/login.html`, `web/login.js`, `web/app.js` (badge), `src/tests/login.test.js`, `.env` (remove LOGIN_*, adiciona QA_USER/QA_PASS), `.gitignore` (`auth/`).

## Fora de escopo (YAGNI)

- Cadastro/reset de senha pela UI; níveis intermediários; permissões distintas por papel; sincronização Supabase (só a interface fica pronta); 2FA; cookie `Secure` (localhost http).

## Fluxo futuro (sub-projeto B, separado)

Criptografia AES-256-GCM de dados sensíveis em repouso, com chave fora do repositório — spec próprio, ainda não iniciado.
