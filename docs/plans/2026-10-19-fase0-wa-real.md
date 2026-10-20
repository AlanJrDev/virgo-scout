# Fase 0 — WhatsApp real: SPEC DE IMPLEMENTAÇÃO

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (ou superpowers:executing-plans) para implementar task por task. Passos usam checkbox (`- [ ]`). Executor não decide NADA fora desta spec.

**Goal:** WhatsApp gravado na base `leads` sai confiável — fonte marcada (`wa_source`), status de qualidade persistido (`wa_status`) com evidência (`wa_evidence`), e a fila de enrich para de travar leads cujo site está morto.

**Architecture:** PostgREST puro via `sbFetch` (sem SDK), JS comum de script (require + dotenv). Validação centralizada em `wa-audit.js` (já existe e é pura). Uma única migration (0010) via SQL Editor. Degradação graciosa: PATCH de coluna nova ausente → instrução de migration, sem travar o resto (padrão 0008).

**Tech Stack:** Node 22 (node:test), fetch global, Supabase PostgREST, Playwright (local-only, ig-login).

**Spec:** `docs/plans/2026-10-19-fase0-wa-real.md` (este arquivo — autocontido).

---

## Contexto verificado no código (leitura de 2026-10-19)

- `scripts/enrich-leads.js:15` — `patch = { enriched_at: ... }` é montado e PATCHado SEMPRE, mesmo quando `analyzeSite` devolve `ok:false`. Como a fila (linha 10) filtra `enriched_at=is.null`, lead com site morto fica travado para sempre. **BUG P0.**
- `scripts/enrich-leads.js:19` e `scripts/enrich-wa.js:17` — `whatsapp` do site gravado sem NENHUMA validação. O regex `wa\.me\/(\+?\d{6,15})` de `src/enrich/site-analyzer.js:17` aceita 6 dígitos, número de outro estado, fixo ou número de terceiro citado no HTML.
- `src/utils/wa-audit.js` — `classifyWaNumber({whatsapp, phone, address})` existe, é pura e devolve `{ status: 'invalid' | 'suspect' | 'declared', digits, ddd, mobile, reasons }`. Hoje só o relatório `scripts/audit-wa.js` a usa, e ele NUNCA grava nada no Supabase.
- `scripts/audit-wa.js` — probe online fraco (`wa.me` reachable/unknown/unreachable), gera `data/wa-audit-<data>.json` + `.csv`; não faz PATCH.
- `scripts/sync-supabase.js:96` — `toRow()` grava `whatsapp` vindo do JSON do Maps (página do place); é a origem mais confiável e não é marcada.
- `scripts/enrich-ig-wa.js` — grava whatsapp da bio do IG com resume por `igw_checked_at` (migration 0008) e degrada com instrução "aplique no SQL Editor" (linhas 60–62). **Padrão de degradação do repo.**
- Migrations NUNCA rodam via PostgREST: o usuário aplica no SQL Editor (`supabase/migrations/`, há até 0009 hoje).

## Decisões (com traço de raciocínio — não mudar sem nova rodada)

**A — enriched_at só com site vivo.** `ok:false` = fetch que falhou/404/403 não é "enriquecido". Patchar enriched_at num lead não analisado mintifica a fila (lead permanentemente inelegível). Correção: `ok:false` → zero PATCH (lead continua elegível). Sinal nenhum de site morto é gravado — não existe coluna para isso e inventar uma está fora de escopo.

**B — Validação na escrita, centralizada.** Nova `waWriteFields(...)` em `src/utils/wa-audit.js` (mesmo arquivo do classificador puro, exportada ao lado dele — evita editar `package.json`, cujo `npm test` lista arquivos de teste explicitamente). Regras:
- `classifyWaNumber` → `status:'invalid'` (unparseable) ou motivo `invalid_ddd` (DDD fora da tabela Anatel = lixo de scrape, nunca um celular BR real de nenhum estado) → **o whatsapp NÃO entra na base** (sem `whatsapp`, sem `whatsapp_hint`, sem colunas wa_*). NOTA IMPORTANTE: no classificador isolado, `invalid_ddd` produz `status:'suspect'` (cf. `audit-wa.test.js:20`); a regra de ESCRITA é mais apertada e rejeita esse caso — refletido na condição do Task 2 e no case (2) do escopo.
- `status:'suspect'` produzido por `too_short` ou `ddd_off_region` → **grava**, com `wa_status:'suspect'` (o terceiro decide se chuta; o CSV do audit detalha o motivo).
- `status:'declared'` → grava com `wa_status:'declared'`. `differs_phone` NÃO suspect (decisão existente do classificador, testada em `audit-wa.test.js:33`) — o resumo do usuário listava o `differs_phone` como suspect; está correto assim: número comercial diferente do fixo é comum.
- Número gravado = `c.digits` (forma normalizada com 55 — `waLink`/`hasWa`/`audit:wa` aceitam ambas, mas normalizar já nasce consistente e é idempotente).
- Para o classificador ver DDD/região, as filas dos scripts passam a trazer `phone` e `address` no `select`.

**C — Migration 0010.** Colunas `wa_source text` (maps|site|instagram), `wa_status text` (declared|suspect|invalid), `wa_evidence text` (URL onde o link foi achado), `wa_checked_at timestamptz` (última checagem do audit:wa). Índice parcial em `wa_status`. Sem check constraint em `wa_source`/`wa_status`: são text de telemetria; restringir via constraint agrava futuras migrações de valor e nenhum leitor depende de enum no banco.

**D — Evidência/origem.**
- `sync-supabase.js` marca `wa_source:'maps'` apenas quando o JSON do Maps trouxe whatsapp (não marca lead sem wa; patch sem campos wa_ não sobrescreve origem anterior → re-captura sem wa preserva `wa_source:'site'`, padrão patch-não-degradante do repo).
- `enrich-leads.js` / `enrich-wa.js` marcam `wa_source:'site'` + `wa_evidence` = URL final analisada (`site-analyzer` passa a devolver `final_url` = `res.url` com fallback para a URL normalizada pedida).
- `enrich-ig-wa.js` marca `wa_source:'instagram'` + `wa_evidence` = URL do perfil visitado.
- TODA escrita dessas colunas degrada: `sb_400` cuja mensagem casa `/wa_(source|status|evidence|checked_at)/` → loga "aplique supabase/migrations/0010 no SQL Editor".

**E — audit:wa vira escritor (delimitado).** Depois de classificar + probe, PATCH por id: `wa_status`, `wa_checked_at` — e NADA mais. Decisões:
- `< :'invalid'` → **NÃO limpa `whatsapp` existente** (um terceiro decide; o audit só marca o veredito — limpar seria destruição de dado com classificador v1 de regex).
- Probe `unreachable` **NÃO baixa** `declared` para `suspect`: o próprio histórico do arquivo adverte que a página do wa.me é genérica; `unreachable` inclui throttling/rede e não prova inexistência. Um sinal fraco não pode rebaixar número declarado pelo dono do site. Probe continua indo só ao relatório JSON/CSV.
- `wa_checked_at` é o backfill "natural" do status: uma rodada de `npm run audit:wa` marca todos os leads com whatsapp.

**F — Backfill de origem retroativa.** Leads já com `whatsapp` e `wa_source IS NULL` ficam **NULL = origem desconhecida** (capturados antes da marcação existir). NÃO inventamos `'legacy'`: (1) `wa_source` tem domínio fechado (maps|site|instagram) e NULL já significa "desconhecido" universalmente; (2) nenhum script today sabe a origem real desses leads — gravar algo seria mentir no dado; (3) zero código e zero risco. Quem precisa reclassificar status usa `npm run audit:wa` (escreve `wa_status`/`wa_checked_at` inclusive para esses).

---

## Global Constraints

- JS estilo do repo: `require`, CommonJS, dotenv, sem SDK de Supabase (`src/utils/sb.js` → `sbFetch`).
- Comentários PT-BR curtos, no estilo dos arquivos existentes (uma linha no topo do arquivo/hook, sem verbosidade).
- Nenhuma dependência nova. Nenhum comando npm novo.
- Playwright local-only (`enrich:ig-wa`), não mockado em teste novo.
- Migrations aplicadas pelo usuário no SQL Editor — o código nunca assume que existem.
- `npm run test` = lista explícita de arquivos em `package.json:7`; NÃO criar arquivo de teste novo (aproveitar os existentes).

---

## Task 1 — Migration 0010 (`wa_source` / `wa_status` / `wa_evidence` / `wa_checked_at`)

**Files:**
- Create: `supabase/migrations/0010_wa_evidence.sql`

**Conteúdo exato do arquivo:**

```sql
-- 0010: evidência/origem do WhatsApp declarado (Fase 0 — WhatsApp real)
alter table if exists leads
  add column if not exists wa_source text;      -- maps|site|instagram; null = desconhecido (pré-0010)
alter table if exists leads
  add column if not exists wa_status text;      -- declared|suspect|invalid (classificador wa-audit)
alter table if exists leads
  add column if not exists wa_evidence text;    -- URL da página onde o link foi achado
alter table if exists leads
  add column if not exists wa_checked_at timestamptz; -- última checagem (audit:wa)
create index if not exists leads_wa_status_idx on leads (wa_status) where wa_status is not null;
```

- [ ] Criar o arquivo **exatamente** com o conteúdo acima (estilo de `0008_igw_checked.sql`).
- [ ] Commit: `git add supabase/migrations/0010_wa_evidence.sql && git commit -m "feat(db): 0010 - evidência/origem do whatsapp (wa_source/status/evidence)"`. **Não aplicar** — aplicação é manual pelo usuário no SQL Editor (verificação final).

---

## Task 2 — `waWriteFields` em `src/utils/wa-audit.js` (validação centralizada)

**Files:**
- Modify: `src/utils/wa-audit.js` (adicionar export)
- Test: `src/tests/audit-wa.test.js` (arquivo já está na suíte — adicionar cases)

**Interfaces:**
- Produces (Tasks 4, 5, 7): `waWriteFields({ whatsapp, phone, address, hint, source, evidence })` →
  - `null` quando `whatsapp` vazio **ou** `classifyWaNumber` => `status:'invalid'` **ou** reasons contém `invalid_ddd` (nada de wa_* é escrito);
  - senão objeto `{ whatsapp: <digits>, wa_status: 'declared'|'suspect', wa_source: source, wa_evidence?, whatsapp_hint? }`.
- Consumes: `classifyWaNumber` (já exportada), `waDigits` indireto.

- [ ] **Step 1: escrever os testes que falham** (adicionar ao final de `src/tests/audit-wa.test.js`):

```js
const { waWriteFields } = require('../utils/wa-audit');

test('waWriteFields rejeita whatsapp invalid (sem forma utilizavel)', () => {
  assert.strictEqual(waWriteFields({ whatsapp: '123', source: 'site' }), null);
});

test('waWriteFields rejeita invalid_ddd na escrita', () => {
  assert.strictEqual(waWriteFields({ whatsapp: '5508999990000', source: 'site' }), null);
});

test('waWriteFields grava suspect com marcacao (ddd_off_region)', () => {
  const out = waWriteFields({ whatsapp: '5555999793397', address: 'Águas Claras, DF', hint: true, source: 'site', evidence: 'https://x.com' });
  assert.strictEqual(out.wa_status, 'suspect');
  assert.strictEqual(out.whatsapp, '5555999793397');
  assert.strictEqual(out.whatsapp_hint, true);
  assert.strictEqual(out.wa_source, 'site');
  assert.strictEqual(out.wa_evidence, 'https://x.com');
});

test('waWriteFields declared: differs_phone nao é motivo de exclusão', () => {
  const out = waWriteFields({ whatsapp: '5561982638116', phone: '6132724904', address: 'Brasília DF', source: 'site' });
  assert.strictEqual(out.wa_status, 'declared');
});

test('waWriteFields sem whatsapp => null (não marca nada de wa_*)', () => {
  assert.strictEqual(waWriteFields({}), null);
  assert.strictEqual(waWriteFields({ whatsapp: '', source: 'site' }), null);
});
```

- [ ] **Step 2: rodar** `node --test src/tests/audit-wa.test.js` — os novos cases devem FALLAR (export não existe).
- [ ] **Step 3: implementar** — no final de `wa-audit.js`, antes do `module.exports`:

```js
// Regra central de ESCRITA do whatsapp na base leads (enrich/enrich:wa/ig-wa).
// Entra só com forma utilizável e DDD real; suspect entra marcado. Número sai normalizado (digits com 55).
function waWriteFields({ whatsapp, phone, address, hint, source, evidence } = {}) {
  if (!whatsapp) return null;
  const c = classifyWaNumber({ whatsapp, phone, address });
  if (c.status === 'invalid' || c.reasons.includes('invalid_ddd')) return null;
  const out = { whatsapp: c.digits, wa_status: c.status, wa_source: source };
  if (hint) out.whatsapp_hint = true;
  if (evidence) out.wa_evidence = evidence;
  return out;
}
```

- Exportar: linha de `module.exports` passa a ser `module.exports = { classifyWaNumber, waWriteFields, isDfRegion, splitLocal, VALID_DDD };`
- [ ] **Step 4: rodar de novo** — todos os cases PASSAM.
- [ ] **Step 5: commit** — `git add src/utils/wa-audit.js src/tests/audit-wa.test.js && git commit -m "feat(wa): regra central de escrita do whatsapp (waWriteFields)"`

Cobertura dos 4 testes exigidos no escopo: (1) = Task 4 case A; (2) = Task 2 'rejeita invalid_ddd' + Task 4 case B; (3) = Task 2 'grava suspect com marcacao' + Task 4 case C; (4) = Task 6 case 1 do persistWaStatus.

---

## Task 3 — `site-analyzer` devolve `final_url`

**Files:**
- Modify: `src/enrich/site-analyzer.js:29-37` (caminho de retorno de `analyzeSite`)
- Test: `src/tests/site-analyzer.test.js` (2 asserts novos nos cases existentes)

**Comportamento antes:** retorno do sucesso = `{ ok, status, ...extractSignals(html) }`; logo não há como o chamador saber a URL final (redirect) onde o HTML foi lido.
**Depois:** o sucesso devolve também `final_url` (= `res.url || url` — a URL normalizada pedida serve de fallback; stubs sem `url` no resposta seguem funcionando). O catch devolve `final_url: null`.

- [ ] **Step 1: asserts nos testes existentes** (não criar testes novos):
  - Em `site-analyzer.test.js` case 1 ('extrai email, instagram...'), adicionar: `assert.strictEqual(s.final_url, 'https://souzadv.com.br')` (stub não seta `res.url` → cai no fallback da URL normalizada).
  - Case 2 ('url sem esquema...ok:false'), adicionar: `assert.strictEqual(bad.final_url, null)`.
- [ ] **Step 2: rodar** `node --test src/tests/site-analyzer.test.js` — devem falhar.
- [ ] **Step 3: implementar** — em `analyzeSite`, dentro do `try`, logo após `const res = await f(url, ...)`: `const final_url = res.url || url;`; ramo `!res.ok` → `return { ok: false, status: res.status, final_url, ...empty() };`; ramo de sucesso → `return { ok: true, status: res.status, final_url, ...extractSignals(html) };`. No `catch` → `return { ok: false, status: 0, final_url: null, ...empty() }`. O `return` vazio (`url` flow vazio na linha 29) → `final_url: null` no objeto literal.
- [ ] **Step 4:** teste verde.
- [ ] **Step 5: commit** — `git add src/enrich/site-analyzer.js src/tests/site-analyzer.test.js && git commit -m "feat(enrich): site-analyzer devolve final_url (evidence de wa)"`

---

## Task 4 — Arbitrar o enrich P0: `scripts/enrich-leads.js`

**Files:**
- Modify: `scripts/enrich-leads.js` (fila + loop)
- Test: `src/tests/enrich-leads.test.js` (1 case atualizado + 4 cases novos)

**Comportamento antes:** linha 10 fila `select=id,website`; linhas 14-25 PATCH sempre (mesmo `ok:false`), e `whatsapp` cru entra sem validação → lead de site morto trava para sempre + zap sujo vira botão no painel.
**Depois:**
1. Fila: `select=id,website,phone,address` (classificador precisa de telefone e endereço).
2. `s.ok === false` → **zero PATCH**; log `[enrich] site morto ${r.id} (${r.website.slice(0, 40)}) — fica p/ próxima run`; contador próprio `off`; segue pro próximo lead (com `sleep`).
3. `s.ok === true` → `patch = { enriched_at: ... }` + sinais existentes (email/instagram/facebook/since_year/site_title) + campos wa_ só via `waWriteFields({ whatsapp: s.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: s.final_url || r.website })`. Retorno `null` (invalid/sem wa) → nenhum campo wa_* no patch.
4. Degradação: no `catch` do PATCH, se `e.message` casa `/wa_(source|status|evidence|checked_at)/` → `console.error('[enrich] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor');` e **rethrow** (o `.catch` do CLI em `main` cuida do `process.exit(1)`; rethrow é o que o `assert.rejects` do case D valida). Outros erros seguem como hoje (contam `fail` e continuam).
5. Log final: `[enrich] concluído: ${ok} ok, ${off} sem site, ${fail} falhas`.

- [ ] **Step 1: cases de teste** — em `src/tests/enrich-leads.test.js`:
  - **Case existente 1** ('consulta leads e PATCHa sinais'): atualizar as asserts do body `p1` — adicionar `assert.strictEqual(p1.wa_source, 'site')`; `assert.strictEqual(p1.wa_evidence, 'https://souzadv.com.br')` (stub do fetch do site não devolve `url` → fallback); `assert.strictEqual(p1.wa_status, 'declared')` (o `<a href="wa.me/5561999990000">` é ddd 61 válido; `r` não tem phone/address no `ROWS` → sem suspect). O `ROWS` fica sem phone/address de propósito: prova que o classificador tolera `undefined`.
  - **Novo case A** ('site morto não ganha enriched_at'):

```js
test('enrichLeads faz site ok:false => nenhum PATCH (lead fica elegível)', async () => {
  const { main } = require('../../scripts/enrich-leads');
  process.argv[2] = '1';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'c3', website: 'consul.com' }]) };
    }
    return { ok: false, status: 404, text: async () => 'not found' }; // site morto
  };
  await main();
  assert.strictEqual(calls.filter((c) => c.opts.method === 'PATCH').length, 0);
});
```

  - **Novo case B** ('invalid_ddd rejeitado na escrita'):

```js
test('enrichLeads não grava whatsapp invalid_ddd', async () => {
  const HTML_DDD_RUIM = HTML.replace('wa.me/5561999990000', 'wa.me/5508999990000');
  const { main } = require('../../scripts/enrich-leads');
  process.argv[2] = '1';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'd4', website: 'x.com' }]) };
    }
    return { ok: true, status: 200, text: async () => HTML_DDD_RUIM };
  };
  await main();
  const patch = JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body);
  assert.ok(!('whatsapp' in patch) && !('whatsapp_hint' in patch) && !('wa_source' in patch) && !('wa_status' in patch));
  assert.ok('enriched_at' in patch); // site vivo segue enriquecendo outros sinais
  assert.strictEqual(patch.email, 'contato@souzadv.com.br');
});
```

  - **Novo case C** ('suspect gravado com marcação'):

```js
test('enrichLeads grava whatsapp suspect com wa_status suspect', async () => {
  const HTML_SUSPECT = HTML.replace('wa.me/5561999990000', 'wa.me/5555999793397');
  const { main } = require('../../scripts/enrich-leads');
  process.argv[2] = '1';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'e5', website: 'x.com', address: 'Aguas Claras, DF' }]) };
    }
    return { ok: true, status: 200, text: async () => HTML_SUSPECT };
  };
  await main();
  const patch = JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body);
  assert.strictEqual(patch.whatsapp, '5555999793397');
  assert.strictEqual(patch.wa_status, 'suspect');
  assert.strictEqual(patch.wa_source, 'site');
});
```

  (novo case D — degradação; `assert.rejects` da `main` quando PATCH devolve 400):

```js
test('enrichLeads degrada: PATCH 400 coluna wa_ ausente => erro com instrução de migration', async () => {
  const { main } = require('../../scripts/enrich-leads');
  process.argv[2] = '1';
  global.fetch = async (url, opts) => {
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_source' column of 'leads' in the schema cache" }) };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'f6', website: 'x.com' }]) };
    }
    return { ok: true, status: 200, text: async () => HTML };
  };
  await assert.rejects(main, /wa_source|0010/);
});
```

- [ ] **Step 2: rodar** `node --test src/tests/enrich-leads.test.js` — os cases novos devem falhar (comportamento ainda não implementado); case 1 existente atualizado também falha.
- [ ] **Step 3: implementar** em `scripts/enrich-leads.js` conforme comportamento 1-5 acima. Referências exatas no arquivo: fila (linha 10), bloco do loop (linhas 13-27).
- [ ] **Step 4:** `node --test src/tests/enrich-leads.test.js` verde.
- [ ] **Step 5: commit** — `git add scripts/enrich-leads.js src/tests/enrich-leads.test.js && git commit -m "fix(enrich): site morto não grava enriched_at; whatsapp validado com marcação wa_*"`

---

## Task 5 — `scripts/enrich-wa.js` (backfill) segue a mesma regra

**Files:**
- Modify: `scripts/enrich-wa.js`
- Test: `src/tests/enrich-wa.test.js` (1 case atualizado + 1 novo)

**Comportamento antes:** fila `select=id,website`; PATCH `{ whatsapp, whatsapp_hint:true }` cru.
**Depois:** fila `select=id,website,phone,address`; quando `s.whatsapp` presente, `const wa = waWriteFields({ whatsapp: s.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: s.final_url || r.website })`; se `null` → seguir sem PATCH (já é o comportamento padrão do sem-zap); senão PATCH os campos do objeto. Degradação idêntica ao Task 4 regex `/wa_(source|status|evidence|checked_at)/` → instrucao 0010 + **rethrow** (o `.catch` do CLI do script faz o `process.exit(1)`; sem resume próprio, sair é seguro).

- [ ] **Step 1: testes**:
  - Case existente 1: trocar a linha `assert.deepStrictEqual(body, { whatsapp: '5561999990000', whatsapp_hint: true })` por:

```js
assert.deepStrictEqual(body, { whatsapp: '5561999990000', whatsapp_hint: true, wa_status: 'declared', wa_source: 'site', wa_evidence: 'https://souzadv.com.br' });
```

  - Case novo (degradação):

```js
test('enrich:wa degrada: PATCH 400 colunas wa_ ausentes => instrucao 0010 + erro', async () => {
  const { main } = require('../../scripts/enrich-wa');
  global.fetch = async (url, opts = {}) => {
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_status' column of 'leads' in the schema cache" }) };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'a1', website: 'souzadv.com.br' }]) };
    }
    return { ok: true, status: 200, text: async () => HTML };
  };
  await assert.rejects(main, /wa_status|0010/);
});
```

- [ ] **Step 2: rodar** `node --test src/tests/enrich-wa.test.js` — atualizado falha, novo falha.
- [ ] **Step 3: implementar** — analisando `scripts/enrich-wa.js:10-25` com o comportamento descrito.
- [ ] **Step 4:** verde.
- [ ] **Step 5: commit** — `git add scripts/enrich-wa.js src/tests/enrich-wa.test.js && git commit -m "feat(enrich:wa): whatsapp do backfill validado + wa_source site evidence"`

---

## Task 6 — `scripts/audit-wa.js` vira escritor de `wa_status`

**Files:**
- Modify: `scripts/audit-wa.js` (nova função `persistWaStatus` + 1 chamada no `main`)
- Test: `src/tests/audit-wa.test.js` (2 cases novos)

**Comportamento antes:** `audit()` gera rows em memória; `main()` escreve JSON/CSV em `data/wa-audit-<data>.*`; nada vai ao banco.
**Depois:** em `main()`, após `const rows = await audit(...)`: 1) `const writes = await persistWaStatus(rows);` 2) arquivos JSON/CSV (inalterados, sempre gerados); 3) resumo no console recebe a linha `[audit:wa] ${writes} status gravado(s) na base`.

**Contratos de `persistWaStatus(rows)` (exportada ao lado de `audit`/`probe`):**
- Para cada row com `r.id != null` e `r.status` em `('declared','suspect','invalid')` → PATCH `leads?id=eq.<id>`, body `{ wa_status: r.status, wa_checked_at: new Date().toISOString() }`, `Prefer: return=minimal`. Row sem `id` (modo `--local`) → pula sem erro.
- **NUNCA** envia `whatsapp`, `phone`, `wa_source`, `wa_evidence` — não limpa zap nem muda origem (decisões D/E).
- Probe não altera o status (decisão E) — `persistWaStatus` usa só `r.status` do classificador.
- Degradação: `catch` em PATCH cuja mensagem casa `/wa_(status|checked_at)/` → loga UMA vez `[audit:wa] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor` e **retorna as escritas feitas até ali** (aborta o resto, sem `process.exit` — o relatório JSON/CSV ainda é gerado pelo `main`). Erros de outra natureza por-row: logam e continuam.

- [ ] **Step 1: os 2 cases novos em `src/tests/audit-wa.test.js`** (stub global.fetch no estilo dos cases do enrich — Task 4 é a referência de stub):

```js
// Case 1: persist PATCHa por id e ignora rows sem id; corpo mínimo (nunca mexe em whatsapp)
test('audit:wa persistWaStatus grava wa_status/wa_checked_at por id', async () => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  const { persistWaStatus } = require('../../scripts/audit-wa');
  const rows = [
    { id: 'a1', status: 'suspect' },
    { id: null, status: 'invalid' }, // local sem id: pula
    { id: 'b2', status: 'declared' },
  ];
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return { ok: true, status: 204, text: async () => '' };
  };
  const writes = await persistWaStatus(rows);
  assert.strictEqual(writes, 2);
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 2);
  assert.ok(patches[0].url.includes('leads?id=eq.a1'));
  const body = JSON.parse(patches[0].opts.body);
  assert.deepStrictEqual(Object.keys(body).sort(), ['wa_checked_at', 'wa_status']);
  assert.ok(typeof body.wa_checked_at === 'string');
});
```

*Setup do arquivo de teste (padrão já usado na suíte, cf. `src/tests/enrich-leads.test.js:23-28`): declarar `const nativeFetch = global.fetch;` no topo e `after(() => { global.fetch = nativeFetch; })` — os envs `SUPABASE_URL`/`SECRET_KEY` são setados de novo em cada um dos 2 cases novos (o arquivo atual não usa env porque só testa funções puras). A linha de restauração NÃO fica dentro do case.*

```js
// Case 2: degrade — colunas ausentes não derrubam o script nem dão throw
test('audit:wa persistWaStatus degrada em 400 de coluna wa_ ausente', async () => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  const { persistWaStatus } = require('../../scripts/audit-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return { ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_status' column of 'leads' in the schema cache" }) };
  };
  const writes = await persistWaStatus([{ id: 'a1', status: 'suspect' }, { id: 'b2', status: 'declared' }]);
  assert.strictEqual(writes, 0);
  assert.strictEqual(calls.length, 1, 'primeiro 400 aborta o resto');
});
```

- [ ] **Step 2: rodar** `node --test src/tests/audit-wa.test.js` — os 2 cases falham.
- [ ] **Step 3: implementar** — ao final de `scripts/audit-wa.js`, acima do `module.exports`:

```js
/* Grava o veredito do classificador na base: só marca wa_status/wa_checked_at.
   Nunca limpa whatsapp (invalid) nem muda origem — terceiro decide. */
async function persistWaStatus(rows) {
  let writes = 0;
  for (const r of rows) {
    if (!r.id || !['declared', 'suspect', 'invalid'].includes(r.status)) continue;
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { wa_status: r.status, wa_checked_at: new Date().toISOString() },
      });
      writes++;
    } catch (e) {
      if (/wa_(status|checked_at)/.test(e.message)) {
        console.error('[audit:wa] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor');
        return writes; // aborta o resto; relatório de arquivos segue no main
      }
      console.warn(`[audit:wa] persist ${r.id} falhou: ${e.message}`);
    }
  }
  return writes;
}
```

- `module.exports` passa a incluir `persistWaStatus`. Em `main()`, ligar a chamada na ordem do topo da task + linha de log das escritas.
- [ ] **Step 4:** verde.
- [ ] **Step 5: commit** — `git add scripts/audit-wa.js src/tests/audit-wa.test.js && git commit -m "feat(audit:wa): persiste wa_status/wa_checked_at na base (degrada se 0010 ausente)"`

---

## Task 7 — `scripts/enrich-ig-wa.js` marca origem instagram

**Files:**
- Modify: `scripts/enrich-ig-wa.js` (sem testes novos — Playwright local-only, padrão do repo: este script nunca esteve na suíte)

**Comportamento antes:** fila `select=id,name,instagram`; PATCH `{ igw_checked_at, whatsapp: got.digits }` cru (sem validação), degradação casa só `/igw_checked_at/`.
**Depois:**
1. Fila: `select=id,name,instagram,phone` (classificador usa `phone` quando existir; `address` não é necessário aqui e não é carregado).
2. Quando `waFromBio` acha WA: `const wa = waWriteFields({ whatsapp: got.digits, phone: r.phone, hint: true, source: 'instagram', evidence: 'https://www.instagram.com/' + handle + '/' });` — `wa` aparece no patch (`Object.assign(patch, wa)`) e o log mantém `(via ${got.via}, @${handle})`; `wa === null` → log `[enrich:ig-wa] ${r.name} — WA ${got.digits} descartado (invalid pelo classificador)` e patch segue só com `igw_checked_at` (resume pra frente, sem re-loop).
3. Degradação da linha 60: regex passa a `/igw_checked_at|wa_(source|status|evidence)/` e a instrução menciona as duas: `[enrich:ig-wa] colunas ausentes — aplique supabase/migrations/0008 + 0010 no SQL Editor`.
- [ ] Implementar os 3 pontos acima (linhas 17, 28-55, 60-62 do arquivo atual).
- [ ] Commit: `git add scripts/enrich-ig-wa.js && git commit -m "feat(enrich:ig-wa): wa da bio validado + wa_source instagram e evidence"`.

---

## Task 8 — `scripts/sync-supabase.js` marca origem maps com degrade para 0010 pendente

**Files:**
- Modify: `scripts/sync-supabase.js` (`toRow`, loop de patches, `upsertRows`) + nova helper `patchLead` exportada
- Test: `src/tests/sync.test.js` (2 cases novos)

**Comportamento antes:** `toRow():96` grava `whatsapp` do Maps sem marcação; re-captura sem wa NÃO sobrescreve (patch pula nulos) mas também não informa de onde veio o que já está lá.
**Depois:**

1. **`toRow`** — logo após a linha do `whatsapp`:

```js
if (row.whatsapp) row.wa_source = 'maps'; // origem do zap: página do place no Maps
```

   Executor: monta o objeto do `return { ... }` como hoje e, logo antes do `return`, acrescenta `if (row.whatsapp) row.wa_source = 'maps';` (transformando o literal atual em `const row = { ... }` + `if` + `return row` — UMA das formas, sem retrabalho).
   **Cuidado:** rows de sync NÃO setam `wa_status`/`wa_evidence`/`wa_checked_at` — isso é papel do classificador/report, não do Maps.

2. **Patch de update (`planUpsert` → loop `for (const p of plan.patches)`)** — trocar pelo helper:

```js
// PATCH de lead com degrade de schema: colunas de wa_* ausentes (0010 pendente)
// => tira as colunas wa_* e tenta de novo sem elas (não perde a captura).
async function patchLead(id, set) {
  try {
    await sbFetch(`leads?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: set, headers: { Prefer: 'return=minimal' } });
  } catch (e) {
    if (!/wa_(source|status|evidence|checked_at)/.test(String(e.message || ''))) throw e;
    const slim = Object.fromEntries(Object.entries(set).filter(([k]) => !k.startsWith('wa_')));
    if (Object.keys(slim).length === Object.keys(set).length) throw e; // 400 sem relação com wa_*: cabe ao chamador
    console.warn('[sync] colunas wa_* ausentes — aplique supabase/migrations/0010 no SQL Editor (salvando sem elas)');
    await sbFetch(`leads?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: slim, headers: { Prefer: 'return=minimal' } });
  }
}
```

   O loop de patches vira `await patchLead(p.id, p.set);`. Nota: com 0010 aplicada, a maioria dos leads de sync não tem nenhum `wa_*` no patch (só quem trouxe whatsapp), então o degrade é raro por design.
   Exportar `patchLead` no `module.exports` (para teste).

3. **`upsertRows` (POST batches)** — mesmo degrade: envolver cada `sbFetch` do chunk em try/catch idêntico; em caso de 400 casa `/wa_/`: filtrar `wa_*` de cada row do chunk e re-POST (mesma mensagem de warning, uma vez por run basta — usar flag `let waWarned`).

- [ ] **Step 1: cases novos em `src/tests/sync.test.js`:**

```js
test('toRow marca wa_source maps só quando tem whatsapp', () => {
  const { toRow } = require('../../scripts/sync-supabase');
  const comWa = toRow({ name: 'A', whatsapp: '61999990000', address: 'B' });
  assert.strictEqual(comWa.wa_source, 'maps');
  assert.strictEqual(comWa.whatsapp, '61999990000');
  const semWa = toRow({ name: 'B', address: 'B' });
  assert.strictEqual('wa_source' in semWa, false);
});

test('patchLead degrada: 400 de coluna wa_ ausente => repete sem as colunas wa_*', async () => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  const { patchLead } = require('../../scripts/sync-supabase');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (calls.length === 1) return { ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_source' column of 'leads' in the schema cache" }) };
    return { ok: true, status: 204, text: async () => '' };
  };
  await patchLead('x1', { whatsapp: '61999990000', wa_source: 'maps' });
  assert.strictEqual(calls.length, 2);
  const b2 = JSON.parse(calls[1].opts.body);
  assert.strictEqual('wa_source' in b2, false);
  assert.strictEqual(b2.whatsapp, '61999990000');
});
```

   *Setup: o arquivo já tem `nativeFetch` + `after()` restaurando (linhas 14 e 22); setar os envs dentro do segundo case e limpar via o `after` existente (o `after` só apaga `SUPABASE_URL`/`SECRET_KEY` — conferir: sim, `sync.test.js:16-17`).*

- [ ] **Step 2: rodar** `node --test src/tests/sync.test.js` — falham.
- [ ] **Step 3: implementar** itens 1-3.
- [ ] **Step 4:** verde.
- [ ] **Step 5: commit** — `git add scripts/sync-supabase.js src/tests/sync.test.js && git commit -m "feat(sync): wa_source maps + degrade de colunas wa_ ausentes"`

---

## Plano de verificação final (o executor NÃO cria PR nem deploya)

1. **Suíte:** `npm run test` — verde, **239 cases pré-existentes + 14 novos cases** = falha zero. Rodar DUAS vezes seguidas se algum stub de `global.fetch` vazar estado (suíte é sequencial no node:test).
2. **Smoke unitário sem banco:** os cases novos cobrem classificador, escrita, audit persist e sync degrade — nada precisa de Supabase real para o gate de CI.
3. **Sequência manual do usuário (Supabase real):**
   - Aplicar `supabase/migrations/0010_wa_evidence.sql` no **SQL Editor** (como 0006/0008/0009).
   - `npm run audit:wa` → deve logar `[audit:wa] N status gravado(s) na base` e gerar `data/wa-audit-<hoje>.json/.csv` (CSV = lista limpa de hoje: colunas id/status/probe/reasons). Conferir no painel: chips/colunas de zap continuam iguais (nenhuma mudança de UI) e `wa_status` aparece via SQL/Supabase Studio.
   - `npm run enrich 5` → leads de site morto aparecem com log `sem site` e NÃO são PATCHados; `select` da fila traz phone/address.
   - `npm run enrich:wa 5` + `npm run enrich:ig-wa 3` (este precisa `auth/ig-state.json` + `npm run ig-login` se não logado) → zap novo entra com `wa_source` site/instagram + `wa_evidence`.
   - `npm run sync advogados` → leads com wa do Maps entram com `wa_source='maps'`; deletar a coluna p/ teste de degrade é opcional (o caminho está coberto em teste).
   - **Export:** não há comando standalone de xlsx — o export de planilha sai no fluxo de captura (`saveLeads` de `src/utils/spreadsheet.js` dentro dos scripts `capture-*`, formats csv/json/xlsx) e o export da lista de qualidade do WA é o próprio `data/wa-audit-<hoje>.csv` gerado pelo `audit:wa`. Usar estes; nada novo a criar.

## Fora de escopo (Fase 0)

- `site-analyzer` v2 (multi-página), Playwright fallback no enrich.
- Baileys / sessão real de WhatsApp (verificação definitiva de existência).
- Qualquer mudança de UI/painel (`web/`, `api/*`), colunas Extras, novos scripts npm.
- Backfill retroativo de `wa_source` (decisão F: NULL = desconhecido, permanente).
- Probe online mais forte no audit:wa (mantém o atual, não rebaixa status).

## ARQUIVOS TOCADOS (lista completa)

| # | Arquivo | Ação |
| --- | --- | --- |
| 1 | `supabase/migrations/0010_wa_evidence.sql` | criar |
| 2 | `src/utils/wa-audit.js` | modificar (waWriteFields + export) |
| 3 | `src/tests/audit-wa.test.js` | modificar (5 cases do waWriteFields + 2 do persistWaStatus + setup env/after) |
| 4 | `src/enrich/site-analyzer.js` | modificar (final_url) |
| 5 | `src/tests/site-analyzer.test.js` | modificar (2 asserts novos) |
| 6 | `scripts/enrich-leads.js` | modificar (fila + ok:false + validação + degradação) |
| 7 | `src/tests/enrich-leads.test.js` | modificar (case 1 + 4 cases novos) |
| 8 | `scripts/enrich-wa.js` | modificar (fila + validação + degradação) |
| 9 | `src/tests/enrich-wa.test.js` | modificar (case 1 + 1 case novo) |
| 10 | `scripts/audit-wa.js` | modificar (persistWaStatus + main + export) |
| 11 | `scripts/enrich-ig-wa.js` | modificar (source instagram + degrade 0008+0010) |
| 12 | `scripts/sync-supabase.js` | modificar (toRow, patchLead, upsertRows, exports) |
| 13 | `src/tests/sync.test.js` | modificar (2 cases novos) |

