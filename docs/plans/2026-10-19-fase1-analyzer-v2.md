# Fase 1 — descoberta profunda de WhatsApp: SPEC DE IMPLEMENTAÇÃO

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (ou superpowers:executing-plans) para implementar task por task. Passos usam checkbox (`- [ ]`). Executor não decide NADA fora desta spec.

**Goal:** chegou a zap declarado mesmo quando ele só existe em página interna de contato (home sem nada), sem aceitar número solto em texto corrido como WhatsApp — e o `enrich:wa` vira fila de recuperação com rastreio de tentativas (para de re-buscar os mesmos leads toda rodada).

**Architecture:** `site-analyzer` v2 mantém `extractSignals` por página e ganha camada de descoberta: candidatos de contato por regex no HTML da homepage, visita cap 2 páginas com budget por domínio (12s) e extração de WhatsApp só de LINK DECLARADO (atributo `href`). Retorno soma `wa_evidence_url`, `pages_visited`, `whatsapp_hint` e preserva o contrato da Fase 0 (`ok`, `final_url`, campos de sinal). `enrich-wa` recebe migration 0011 (`wa_attempts`/`wa_last_try`), filtra por cooldown e faz UM PATCH por lead com rastreio.

**Tech Stack:** Node 22 (node:test), fetch global, Supabase PostgREST (`src/utils/sb.js` → `sbFetch`), zero dependências novas.

**Spec:** `docs/plans/2026-10-19-fase1-analyzer-v2.md` (este arquivo — autocontido; modelo de formato: `docs/plans/2026-10-19-fase0-wa-real.md`).

---

## Contexto verificado no código (leitura de 2026-10-19)

- `src/enrich/site-analyzer.js:17-18` — whatsapp vem de regex no TEXTO INTEIRO (`text.match(/wa\.me\/(\+?\d{6,15})/)`): número citado em texto corrido/JSON/script conta como zap. É a imprecisão central desta fase.
- `src/enrich/site-analyzer.js:26-38` — `analyzeSite` busca só a homepage; existe `final_url` (Fase 0) e `timeoutMs` default 6000; sem noção de páginas extras/budget.
- `scripts/enrich-wa.js:11` — fila flat `whatsapp=is.null` SEM cooldown: re-processa TODO lead sem zap TODA rodada (re-fetch da homepage). Com multi-página v2 esse loop fica caro demais sem rastreio.
- `src/utils/wa-audit.js:56-64` — `waWriteFields` já valida na escrita (invalid/invalid_ddd → null; suspect gravado marcado) e é o único ponto de entrada de wa_* dos scripts — `enrich-wa` usa (linha 16), `enrich-leads.js:28` também (fica INTACTO nesta fase).
- `src/tests/site-analyzer.test.js` — fixture `<a href="https://wa.me/5561999990000">` é link DECLARADO em atributo: o novo regime de extração não pode fazê-lo regredir (case 1 continua passando).
- `src/tests/enrich-wa.test.js:19-30` — stub padrão da suíte: `global.fetch` + `calls`, novos cases vão NESTE arquivo (package.json lista arquivos de teste explicitamente — NÃO criar arquivo de teste novo).
- Migrations 0001–0010 aplicadas via SQL Editor manual; degradação de coluna nova obrigatória (padrão PostgREST `PGRST204`: mensagem "Could not find the 'X' column").
- Base real: 129 leads, 31 com site, 13 zap declarado (7 únicos pós-dedupe), 98 sem site. Fila do enrich:wa hoje ≈ todos os com site sem zap (queima de fetch a cada run) — corrigida pelo cooldown 7d + cap 6 tentativas.

## Decisões (com traço de raciocínio — não mudar sem nova rodada)

**A — Extração de WhatsApp = LINK DECLARADO, só de atributo `href`.** Todo `whatsapp` gravável sai de `<a href>` literal contendo `wa.me/<digits>` ou `api.whatsapp.com/send?...phone=<digits>` (qualquer tag com `href=`: `<a>`, `<area>`, `<link>` — pragmático: o padrão `href=` de attr cobre os três). Número solto em texto corrido ("fale no 61 99999-0000", `wa.me` dentro de JSON/script inline, `data-zap="..."`): vira **`whatsapp_hint: true` apenas, NUNCA `whatsapp`** — hint booleana sem valor (coluna `whatsapp_hint boolean` já existe, 0004:14). Regressão zero: o fixture atual é `<a href>` declarado e continua achado; o que TROCA de régua é o match no texto cru da Fase 0 (lá, texto corrido com `wa.me/...` contava como zap; agora conta como hint). Trade-off aceito: sites que emitem o link só via JS inline (`onclick="open('https://wa.me/...')"`) perdem zap ganho pela régua antiga e passam a hint-only — recall menor, precisão maior; o botão do painel usa `waLink` só com número gravado (wa.js:34-38), então nunca gravar número não-declarado é a direção certa.

**B — Regexes exatas do link declarado (executor copia).** Extração em DUAS passadas (aspas duplas e simples — sites usam as duas):
- coleta de valores: `/href\s*=\s*"([^"]*)"/gi` e `/href\s*=\s*'([^']*)'/gi`;
- cada valor passa por `replace(/&amp;/gi, '&')` antes do match (**decode da entidade HTML** — sem decode, `api.whatsapp.com/send?text=oi&amp;phone=X` nunca casa `[?&]phone=` porque o `&` está codificado);
- match declarado: `/wa\.me\/\+?(\d{6,15})/` (o `+?` opcional é capturado FORA do grupo — número sai sem `+`) **ou** `/api\.whatsapp\.com[^"'\s]*[?&]phone=(\d{6,15})/i`;
- primeiro match vence (ordem do documento).
- hint: mesma sonda SEM o prefixo de atributo, no texto cru (`/wa\.me\/\+?\d{6,15}/` ou `/api\.whatsapp\.com[^"'\s]*[?&]phone=\d{6,15}/`) → booleano.

**C — Candidatos de contato: href, PT/EN, com exclusões cirúrgicas.** Regex do candidato: `/contato|fale|atendimento|whatsapp|or[cç]ament|agendament|\bsac\b/i` testado sobre o VALOR DO HREF (case-insensitive inclui Contato/CONTATO; EN fica coberto por `contact`? NÃO — o escopo pedia PT/EN, mas 'contact' casaria qualquer URL que contenha 'contact' tipo `contact-us`... e é exatamente o desejado: EN entra via `contact` — padrão final: `/contato|fale|atendimento|whatsapp|contact|or[cç]ament|budget|agendament|\bsac\b/i`). Exclusões, nesta ordem: (1) resolve com `new URL(href, final_url)` — throw → descarta (isso mata `mailto:`/`tel:`/`javascript:` via protocolo); (2) `u.protocol !== 'http:'/'https:'` → fora (dupla garantia); (3) `u.hash` → âncora interna, fora; (4) dedupe por `u.href` (normalizando barras finais) e descarta igual à base; (5) keyword deve casar; (6) **href que já é link de wa (`/wa\.me|whatsapp/i`) NÃO é candidato de visita** — extração declarada já o comeu; visitar `api.whatsapp.com` é fetch inútil; (7) origem diferente da homepage → fora (não sair do domínio; `u.origin !== baseOrigin`). Cap: primeiros **2** na ordem do documento. Descoberta acontece SÓ no HTML da homepage — páginas internas não geram segundos níveis (profundidade 1; chamada recursiva seria custo exponencial em sites-link-farm por ganho marginal).

**D — Orçamento e caps de visita (valores decididos).** Budget por domínio: **12000ms** total (homepage + internas), contado do início do fetch da home; timeout por página extra: `min(4000, restante)`; **reserva de 2s** do budget (não iniciar página se `restante − 2000 < 800ms` — abaixo disso não vale iniciar). Home já achou zap declarado → **zero visitas** (economia: caso majoritário na base — 13 zaps já declarados estão na home). `ok:false` na home (404/403/timeout/network) → **termina imediatamente**: sem HTML não há candidatos; NÃO inventamos lista de URLs (`/contato`, `/fale-conosco`) — adivinhar path é fetch cego no escuro. Candidato com res `!ok` ou throw → segue pro próximo candidato. Sem `sleep` entre páginas internas (budget + timeouts amarram; sleep extra multiplicaria latência por lead sem ganho).

**E — Página interna só PREENCHE o que falta + evidência.** Merge fill-if-null de `email/instagram/facebook/since_year/title` (home mantém prioridade). `whatsapp` só entra de página interna se ELA tiver link declarado — nesse caso: `wa_evidence_url = URL absoluta do candidato visitado` (a string fetchada, antes de redirect — a `res.url` real exigiria propagação extra e redirect de página de contato quase nunca muda; determinismo > precisão de redirect). `whatsapp_hint` é OR acumulado (home OU internas). Primeira página com zap quebra o loop (sobra de cap não queima budget).

**F — API e contrato.** `analyzeSite(rawUrl, { fetchImpl, timeoutMs = 6000, budgetMs = 12000 })` — assinatura preservada (opções novas são opt-out com default). Retorno do sucesso: campos Fase 0 (`ok/status/final_url/email/instagram/facebook/whatsapp/since_year/title`) + `whatsapp_hint: boolean`, `wa_evidence_url: string|null`, `pages_visited: int` (0/1/2 — nº de páginas internas efetivamente buscadas; métrica de log). Retorno `ok:false`: campos com zeros/nulos + `whatsapp_hint: false`, `wa_evidence_url: null`, `pages_visited: 0`. Contrato intacto de chamadores: `enrich-leads.js` NÃO MUDA (usa `s.whatsapp`, `s.final_url` — evidência dele segue a homepage; imprecisão menor quando zap veio de interna, aceito pois `enrich:wa` é quem corrige/evidencia — TRADE-OFF registrado em favor de não tocar arquivo que a Fase 0 acabou de estabilizar). `enrich-wa` passa a usar `evidence: s.wa_evidence_url || s.final_url || r.website`.

**G — Hint-only habita só no `enrich:wa`.** Home sem zap declarado mas com `whatsapp_hint: true` → PATCH `{ whatsapp_hint: true }` (idempotente; sobrescrever `whatsapp_hint` já-true com true é inofensivo). `enrich-leads` não ganha esse patch (fora de escopo); leads com hint mas sem zap continuam elegíveis na fila do `enrich:wa` (recebem o hint no próximo ciclo de cooldown). Análise DECLARADA rejeitada pelo classificador (invalid/invalid_ddd) → **nada de hint** no patch (o número era tão lixo que não merece nem hint) — só tracking.

**H — Migration 0011.** `wa_attempts int not null default 0` (nº de rodadas do `enrich:wa` que analisaram o lead; default resolve rows pré-0011 sem backfill — Postgres materializa o default na leitura de colunas novas) e `wa_last_try timestamptz` (última passada). Sem índice: 129 linhas, custo de índice > valor; revisitar quando a tabela passar de dezenas de milhares. `not null` em `wa_attempts` elimina branches de null no filtro.

**I — Fila do `enrich:wa` = cooldown 7d + cap 6 tentativas.** Filtro PostgREST exato (value `toISOString()` → termina em `Z`, sem `+` de offset — não precisa URL-encode):

```
leads?select=id,website,phone,address,wa_attempts&website=not.is.null&whatsapp=is.null&wa_attempts=lt.6&or=(wa_last_try.is.null,wa_last_try.lte.<cutoff>)&order=id&limit=<n>
```

`<cutoff>` = `new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()`. Semântica verificada: `or=(...)` é parâmetro top-level que se combina por AND com os demais filtros; `wa_attempts=lt.6` usa a coluna NOT NULL. Efeito: primeira rodada pós-0011 processa os 98; rodadas seguintes dentro de 7 dias voltam vazio (cooldown); após 6 tentativas espaçadas ≥7d (~42 dias de cobertura) o lead congela fora da fila — recomeço só por PATCH manual. Cap/valores: 7d cooling evita martelar sites estáticos; 6 tentativas dão 1,5 mês de janela antes de desistir — se o site ganhar página de contato depois, `enrich` (site novo/enriched_at) não reabre, mas sync de recaptura + rodada manual cobrem.

**J — Fluxo do PATCH (UM PATCH por lead, SEMPRE).** Toda passada de cada lead patcha `{ wa_attempts: (r.wa_attempts || 0) + 1, wa_last_try: new Date().toISOString() }` **mais**, quando houver: campos de `waWriteFields` (zap achado e válido) — ou `{ whatsapp_hint: true }` (hint-only). Lead com site morto/sem nada → patch só de tracking (a tentativa aconteceu e precisa contar). `attempts` NUNCA reseta: encontrado zap → lead sai da fila pelo `whatsapp=is.null` (attempts fica congelado, irrelevante). Sem o PATCH de tracking o cooldown nunca avançaria — por isso é incondicional.

**K — Degradação 0011 + 0010 (padrão do repo).** GET da fila com `wa_attempts` no select: 400 `Could not find the 'wa_attempts'...` → catch do GET loga `[enrich:wa] colunas de retry ausentes — aplique supabase/migrations/0011 no SQL Editor` e **rethrow** (o `.catch` do CLI encerra; sem 0011 não há cooldown — rodar bare é o erro que geraria loop infinito de attempts=1 sem memória). PATCH: erro casa `/wa_(attempts|last_try)/` → instrução 0011 + rethrow; casa `/wa_(source|status|evidence|checked_at)/` → instrução 0010 (mensagem da Fase 0, INALTERADA para o teste existente continuar passando) + rethrow; outros erros: contam `fail` e continuam.

**L — Métricas de log (por run).** Contadores: `analisados` (rows processados), `com zap novo` (waWriteFields ≠ null), `descartados` (analyzer achou wa declarado mas classificador rejeitou), `só hint` (patch hint-only), `páginas extras` (Σ `pages_visited`), `falhas`. Linha final: `[enrich:wa] concluído: X analisados, Y com zap novo, Z descartados, W só hint, P páginas extras, F falhas`. Log por-lead de zap mantém o formato da Fase 0 (`[enrich:wa] ok <site> -> <digits>`).

---

## Global Constraints

- JS estilo do repo: `require`, CommonJS, dotenv, sem SDK de Supabase (`sbFetch` em `src/utils/sb.js`).
- Comentários PT-BR curtos, estilo dos arquivos existentes (uma linha no topo do arquivo, sem verbosidade).
- Nenhuma dependência nova. Nenhum comando npm novo. Nenhum arquivo de teste novo (suíte = lista explícita em `package.json:7`).
- `scripts/enrich-leads.js` e `src/tests/enrich-leads.test.js` NÃO mudam nesta fase.
- Migrations aplicadas pelo usuário no SQL Editor — o código nunca assume que existem (degrada com instrução).
- Testes com stub de `global.fetch` no padrão da suíte (`src/tests/enrich-wa.test.js:19-30` é a referência).
- Assinatura `analyzeSite(url, { fetchImpl, ... })` preservada; só novas opções com default.

---

## Task 1 — Migration 0011 (`wa_attempts` / `wa_last_try`)

**Files:**
- Create: `supabase/migrations/0011_wa_retry.sql`

**Conteúdo exato do arquivo:**

```sql
-- 0011: rastreio de retry do backfill de whatsapp (Fase 1 — descoberta profunda)
alter table if exists leads
  add column if not exists wa_attempts int not null default 0; -- rodadas do enrich:wa que já analisaram o lead
alter table if exists leads
  add column if not exists wa_last_try timestamptz;            -- última passada (cooldown 7 dias na fila)
-- sem índice: 129 linhas hoje; custo de manutenção > ganho (decisão H)
```

- [ ] Criar o arquivo **exatamente** com o conteúdo acima (estilo de `0010_wa_evidence.sql`).
- [ ] Commit: `git add supabase/migrations/0011_wa_retry.sql && git commit -m "feat(db): 0011 - rastreio de retry do enrich:wa (wa_attempts/wa_last_try)"`. **Não aplicar** — aplicação é manual pelo usuário no SQL Editor (verificação final).

---

## Task 2 — `site-analyzer` v2: extração declarada + hint (helpers)

**Files:**
- Modify: `src/enrich/site-analyzer.js` (helpers novas + troca da linha 17-18 em `extractSignals`)
- Test: `src/tests/site-analyzer.test.js` (2 cases novos + 1 assert no case 1 existente)

**Interfaces:**
- Produces (Tasks 3, 4): `findWaLink(html)` → `<digits>|null`; `waHint(html)` → `boolean`; `extractSignals(html)` passa a devolver `whatsapp_hint` ao lado de `whatsapp`. `CONTACT_RE`/`contactCandidates` ficam para o Task 3.

- [ ] **Step 1: cases de teste** (adicionar ao final de `src/tests/site-analyzer.test.js`; case 1 existente recebe 1 assert extra):

```js
// Case 1 existente ('extrai email, instagram, whatsapp...') — ADD ao fim do test:
  assert.strictEqual(s.whatsapp_hint, true); // link declarado também é presença de padrão

test('wa declarado: atributo href wa.me e api.whatsapp com & e aspas simples', () => {
  const dupla = `<a href="https://wa.me/5561999990000">z</a>`;
  const api = `<a href="https://api.whatsapp.com/send?phone=5561987654321&text=oi">z</a>`;
  const simples = `<a href='https://wa.me/61999990000'>z</a>`;
  const r1 = extractSignals(dupla);
  assert.strictEqual(r1.whatsapp, '5561999990000');
  const r2 = extractSignals(api);
  assert.strictEqual(r2.whatsapp, '5561987654321');
  const r3 = extractSignals(simples);
  assert.strictEqual(r3.whatsapp, '61999990000');
  assert.strictEqual(r1.whatsapp_hint, true);
});

test('texto corrido com wa.me vira whatsapp_hint, NUNCA whatsapp', () => {
  const s = extractSignals('<p>Fale com a gente no wa.me/5561999990000 ou ligue 61 3272-4904</p>');
  assert.strictEqual(s.whatsapp, null);
  assert.strictEqual(s.whatsapp_hint, true);
});
```

- [ ] **Step 2: rodar** `node --test src/tests/site-analyzer.test.js` — os 2 cases novos devem FALLAR (`whatsapp` errado no texto corrido hoje; régua atual não distingue attr/texto).
- [ ] **Step 3: implementar** — em `site-analyzer.js`:

  (a) Logo após a linha do `BAD_EMAIL` (linha 2), adicionar:

```js
// Link DECLARADO de WhatsApp: só o que está em atributo href (não vale texto corrido — vira hint).
function findWaLink(html) {
  const text = String(html || '').slice(0, 400000);
  const hrefs = [];
  for (const m of text.matchAll(/href\s*=\s*"([^"]*)"/gi)) hrefs.push(m[1]);
  for (const m of text.matchAll(/href\s*=\s*'([^']*)'/gi)) hrefs.push(m[1]);
  for (const raw of hrefs) {
    const v = raw.replace(/&amp;/gi, '&'); // decode da entidade HTML (&amp;phone=X sem decode jamais casa [?&]phone=)
    const m = v.match(/wa\.me\/\+?(\d{6,15})/) || v.match(/api\.whatsapp\.com[^"'\s]*[?&]phone=(\d{6,15})/);
    if (m) return m[1];
  }
  return null;
}
// Presença de padrão wa em qualquer texto da página (sem exigir atributo) — sinal fraco, só hint.
function waHint(html) {
  const text = String(html || '').slice(0, 400000);
  return /wa\.me\/\+?\d{6,15}/.test(text) || /api\.whatsapp\.com[^"'\s]*[?&]phone=\d{6,15}/.test(text);
}
```

  (b) Em `extractSignals`: trocar as linhas 17-18 (`const wa = text.match(...)...whatsapp = wa[1]...`) por:

```js
  const whatsapp = findWaLink(html);
  const whatsapp_hint = waHint(html);
```

  e o `return` (linha 23) passa a ser `return { email, instagram, facebook, whatsapp, whatsapp_hint, since_year, title };`. A declaração `let instagram = null, facebook = null, whatsapp = null;` (linha 10) vira `let instagram = null, facebook = null;`.
- [ ] **Step 4:** `node --test src/tests/site-analyzer.test.js` — verde (case 1 existente segue passando: link declarado no fixture).
- [ ] **Step 5: commit** — `git add src/enrich/site-analyzer.js src/tests/site-analyzer.test.js && git commit -m "feat(enrich): wa só de link declarado; texto corrido vira whatsapp_hint"`

---

## Task 3 — `analyzeSite` v2: multi-página com orçamento (candidatos de contato)

**Files:**
- Modify: `src/enrich/site-analyzer.js` (CONTACT_RE + `contactCandidates` + `analyzeSite` reescrito; helpers do Task 2 intactos; `empty()` intacto)
- Test: `src/tests/site-analyzer.test.js` (5 cases novos)

**Comportamento antes:** `analyzeSite` busca só a homepage e devolve só os sinais dela — zap que só existe na página de contato não é encontrado.
**Depois:** home sem zap declarado → candidatos (`contatoCandidates` decidão C, cap 2, profundidade 1) visitados sob budget (decisão D); interna concede `whatsapp` com `wa_evidence_url` (decisão E); retorno soma `whatsapp_hint`/`wa_evidence_url`/`pages_visited` (decisão F).

**Interfaces:**
- Produces (Task 4): `analyzeSite(rawUrl, { fetchImpl, timeoutMs = 6000, budgetMs = 12000 })` → campos Fase 0 + `whatsapp_hint: boolean`, `wa_evidence_url: string|null`, `pages_visited: 0|1|2`.
- `CONTACT_RE`/`contactCandidates(html, base)` ficam INTERNOS ao módulo (sem export — testes cobrem via `analyzeSite`).
- `pages_visited` conta só página cujo HTML foi lido (res `ok`); candidato `!ok`/throw não conta (segue pro próximo).

- [ ] **Step 1: os 5 cases novos** (adicionar ao final de `src/tests/site-analyzer.test.js`):

```js
const HOME_SEM_ZAP = '<html><head><title>Escritorio Silva</title></head><body><a href="/contato">Fale conosco</a></body></html>';
const CONTATO_ZAP = '<html><head><title>Contato</title></head><body><a href="https://wa.me/5561999888000">Zap</a></body></html>';

// stub: home na 1ª chamada; páginas com 'contato' na URL recebem CONTATO_ZAP
function stubV2(home, contatoHtml) {
  return async (url) => ({
    url,
    ok: true,
    status: 200,
    text: async () => (String(url).includes('contato') ? (contatoHtml || CONTATO_ZAP) : home),
  });
}

test('v2: home sem zap visita /contato e traz zap com wa_evidence_url da interna', async () => {
  const s = await analyzeSite('https://silva.com', { fetchImpl: stubV2(HOME_SEM_ZAP) });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.whatsapp, '5561999888000');
  assert.strictEqual(s.wa_evidence_url, 'https://silva.com/contato');
  assert.strictEqual(s.whatsapp_hint, true);
  assert.strictEqual(s.pages_visited, 1);
});

test('v2: href relativo (contato.html) resolve contra a final_url da home', async () => {
  const urls = [];
  const s = await analyzeSite('https://silva.com/inicio', {
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { url, ok: true, status: 200, text: async () => (urls.length === 1 ? '<a href="contato.html">Contato</a>' : CONTATO_ZAP) };
    },
  });
  assert.strictEqual(urls[1], 'https://silva.com/contato.html');
  assert.strictEqual(s.whatsapp, '5561999888000');
});

test('v2: wa em texto corrido NUNCA vira whatsapp; só o declarado da interna grava', async () => {
  const s = await analyzeSite('https://serra.com', {
    fetchImpl: async (url) => (String(url).endsWith('/fale')
      ? { url, ok: true, status: 200, text: async () => CONTATO_ZAP }
      : { url, ok: true, status: 200, text: async () => '<p>Chame no wa.me/556177770000 agora mesmo</p><a href="/fale">Fale conosco</a>' }),
  });
  assert.strictEqual(s.whatsapp, '5561999888000');
  assert.strictEqual(s.wa_evidence_url, 'https://serra.com/fale');
  assert.strictEqual(s.whatsapp_hint, true);
});

test('v2: home com zap declarado não visita nada (pages_visited 0)', async () => {
  const urls = [];
  const s = await analyzeSite('https://souzadv.com.br', {
    fetchImpl: async (url) => { urls.push(String(url)); return { url, ok: true, status: 200, text: async () => HTML }; },
  });
  assert.strictEqual(s.whatsapp, '5561999990000');
  assert.strictEqual(s.pages_visited, 0);
  assert.strictEqual(s.wa_evidence_url, null);
  assert.strictEqual(urls.length, 1, 'só a homepage');
});

test('v2: budget curto com reserva de 2s reduz a zero as visitas internas', async () => {
  const urls = [];
  const s = await analyzeSite('https://silva.com', {
    budgetMs: 300,
    fetchImpl: async (url) => { urls.push(String(url)); return { url, ok: true, status: 200, text: async () => (urls.length === 1 ? HOME_SEM_ZAP : CONTATO_ZAP) }; },
  });
  assert.strictEqual(urls.length, 1);
  assert.strictEqual(s.pages_visited, 0);
  assert.strictEqual(s.whatsapp, null);
  assert.strictEqual(s.ok, true);
});
```

- [ ] **Step 2: rodar** `node --test src/tests/site-analyzer.test.js` — os 5 cases devem FALLAR (analyzeSite ainda é single-page: sem visita interna, sem campos novos pagos pela interna; case budget falha por `pages_visited` inexistente).
- [ ] **Step 3: implementar** — em `site-analyzer.js`:

  (a) Logo ANTES de `analyzeSite` (após `extractSignals`), adicionar:

```js
// Candidatos a página interna de contato a partir dos href da homepage (decisão C):
// keyword no valor do href, exclusões cirúrgicas 1-7, cap 2, profundidade 1.
const CONTACT_RE = /contato|fale|atendimento|whatsapp|contact|or[cç]ament|budget|agendament|\bsac\b/i;

function contactCandidates(html, base) {
  const out = [];
  const norm = (u) => String(u).replace(/\/+$/, '').toLowerCase();
  let baseOrigin = '';
  try { baseOrigin = new URL(base).origin; } catch { return out; }
  const seen = new Set([norm(base)]); // base já sai do pool (exclusão 4)
  const hrefs = [];
  const text = String(html || '').slice(0, 400000);
  for (const m of text.matchAll(/href\s*=\s*"([^"]*)"/gi)) hrefs.push(m[1]);
  for (const m of text.matchAll(/href\s*=\s*'([^']*)'/gi)) hrefs.push(m[1]);
  for (const raw of hrefs) {
    if (out.length >= 2) break;                                       // cap 2 (decisão C)
    const v = raw.replace(/&amp;/gi, '&');                            // mesmo decode do findWaLink
    if (/wa\.me|whatsapp/i.test(v)) continue;                         // (6) link de wa não é candidato
    let u;
    try { u = new URL(v, base); } catch { continue; }                 // (1) mailto:/tel:/javascript:
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;  // (2) dupla garantia
    if (u.hash) continue;                                             // (3) âncora interna
    if (u.origin !== baseOrigin) continue;                            // (7) fora do domínio
    if (seen.has(norm(u.href))) continue;                             // (4) dedupe/igual à base
    if (!CONTACT_RE.test(v)) continue;                                // (5) keyword no valor do href
    seen.add(norm(u.href));
    out.push(u.href);
  }
  return out;
}
```

  (b) REESCREVER `analyzeSite` inteiro (linhas 26-38) por:

```js
// v2 (Fase 1): home + visitas internas de contato (cap 2, budget por domínio).
// Zap só de href declarado; wa_evidence_url = URL da página onde o zap foi achado.
async function analyzeSite(rawUrl, { fetchImpl, timeoutMs = 6000, budgetMs = 12000 } = {}) {
  const f = fetchImpl || fetch;
  let url = String(rawUrl || '').trim();
  if (!url) return { ok: false, status: 0, final_url: null, ...sansWa() };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const t0 = Date.now();
  const cfg = { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', Accept: 'text/html' } };
  let res;
  try {
    res = await f(url, { ...cfg, signal: AbortSignal.timeout(timeoutMs) });
  } catch { return { ok: false, status: 0, final_url: null, ...sansWa() }; }
  const final_url = res.url || url;
  if (!res.ok) return { ok: false, status: res.status, final_url, ...sansWa() };
  const html = await res.text();
  const sig = extractSignals(html);
  const out = { ok: true, status: res.status, final_url, ...sig, wa_evidence_url: null, pages_visited: 0 };
  if (sig.whatsapp) return out;                              // home declarou zap → zero visitas (decisão D)
  for (const cand of contactCandidates(html, final_url)) {   // cap 2, profundidade 1 (decisão C)
    const restante = budgetMs - (Date.now() - t0);
    if (restante - 2000 < 800) break;                        // reserva 2s + mínimo útil 800ms (decisão D)
    let sub;
    try {
      const r2 = await f(cand, { ...cfg, signal: AbortSignal.timeout(Math.min(4000, restante)) });
      if (!r2.ok) continue;                                  // candidato ruim → próximo (decisão D)
      sub = await r2.text();
    } catch { continue; }
    out.pages_visited++;
    const subSig = extractSignals(sub);
    for (const k of ['email', 'instagram', 'facebook', 'since_year', 'title']) {
      if (out[k] == null && subSig[k] != null) out[k] = subSig[k]; // fill-if-null: home mantém prioridade (decisão E)
    }
    out.whatsapp_hint = !!out.whatsapp_hint || !!subSig.whatsapp_hint; // hint = OR acumulado (decisão E)
    if (subSig.whatsapp) {
      out.whatsapp = subSig.whatsapp;
      out.wa_evidence_url = cand;                            // string fetchada, antes de redirect (decisão E)
      break;                                                 // primeira página com zap encerra o loop
    }
  }
  return out;
}
```

  (c) Ao lado de `empty()` (linha 39), adicionar:

```js
// Shape ok:false com os campos novos zerados (decisão F)
function sansWa() { return { ...empty(), whatsapp_hint: false, wa_evidence_url: null, pages_visited: 0 }; }
```

  `module.exports` NÃO muda (`{ analyzeSite, extractSignals }`).
- [ ] **Step 4:** `node --test src/tests/site-analyzer.test.js` — verde (case 1 da Fase 0 segue passando: zap declarado na home → zero visitas; os 3 campos novos extra não quebram asserts existentes; case 2 mantém `final_url: null` no catch).
- [ ] **Step 5: commit** — `git add src/enrich/site-analyzer.js src/tests/site-analyzer.test.js && git commit -m "feat(enrich): analyzeSite v2 - multi-página com budget e wa_evidence_url"`

---

## Task 4 — `scripts/enrich-wa.js`: fila de recuperação + UM PATCH por lead

**Files:**
- Modify: `scripts/enrich-wa.js` (arquivo INTEIRO reescrito)
- Test: `src/tests/enrich-wa.test.js` (5 cases novos + 2 cases atualizados; case de degrade 0010 existente fica INTACTO)

**Comportamento antes:** fila flat `whatsapp=is.null` sem cooldown; PATCH só quando `waWriteFields` devolve objeto; sem tracking, sem hint-only, sem métricas.
**Depois:** fila com cooldown/cap (decisão I, URL exata); UMA passada por lead com analyzer v2; PATCH INCONDICIONAL de tracking (decisão J) somado, quando houver, a campos de `waWriteFields` — ou a `{ whatsapp_hint: true }` (hint-only, decisão G); degradação 0011 no GET e no PATCH + 0010 preservada (decisão K); métricas finais exatas (decisão L).

**Interfaces:**
- Consumes: `analyzeSite` v2 (Task 3 — `s.wa_evidence_url`, `s.pages_visited`, `s.whatsapp_hint`, `s.ok`), `waWriteFields` (Fase 0).
- Mapping do patch por lead:
  - `s.ok === false` (ou analyzer morto → `null`) → PATCH só `{ wa_attempts + 1, wa_last_try }`;
  - `s.whatsapp` + `waWriteFields(...)` ≠ null → PATCH tracking + campos do wa (o `wa` já traz `whatsapp_hint: true`);
  - `s.whatsapp` + `waWriteFields` → null (número declarado inválido) → **patch só tracking, SEM hint** (decisão G) — conta `descartados`;
  - SEM `s.whatsapp` mas `s.whatsapp_hint` → PATCH tracking + `{ whatsapp_hint: true }` — conta `só hint`;
  - `evidence` sempre `s.wa_evidence_url || s.final_url || r.website`.
- Degradações: GET → `/wa_(attempts|last_try)/` no `e.message` → `[enrich:wa] colunas de retry ausentes — aplique supabase/migrations/0011 no SQL Editor` + rethrow; PATCH → mesma régua + rethrow; PATCH casa `/wa_(source|status|evidence|checked_at)/` → `[enrich:wa] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor` (texto EXATO da Fase 0) + rethrow; outros → `fail++` e segue.

- [ ] **Step 1: os 7 cases em `src/tests/enrich-wa.test.js`** (case de degrade 0010 existente não muda):

  → **Case 1 existente ('consulta leads e grava só os campos de zap') — atualizado** (filtro da fila + novo corpo com tracking; teste do item (7) do escopo embutido aqui):

```js
test('enrich:wa consulta leads sem whatsapp (com cooldown 0011) e grava zap + tracking', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = stubFetch(ROWS);
  await main();
  const getCalls = calls.filter((c) => c.url.includes('/rest/v1/leads') && (!c.opts.method || c.opts.method === 'GET'));
  assert.strictEqual(getCalls.length, 1);
  assert.ok(getCalls[0].url.includes('website=not.is.null'), 'filtra leads sem site');
  assert.ok(getCalls[0].url.includes('whatsapp=is.null'), 'só quem ainda não tem zap gravado');
  assert.ok(getCalls[0].url.includes('wa_attempts=lt.6'), 'cap de tentativas (0011)');
  assert.ok(getCalls[0].url.includes('or=(wa_last_try.is.null,wa_last_try.lte.'), 'cooldown 7d na fila');
  assert.ok(getCalls[0].url.includes('wa_attempts'), 'select traz wa_attempts p/ tracking');
  assert.ok(getCalls[0].url.includes('limit='), 'aceita limite');
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 1, 'UM PATCH por lead com zap');
  assert.ok(patches[0].url.includes('leads?id=eq.a1'));
  const body = JSON.parse(patches[0].opts.body);
  const { wa_attempts, wa_last_try, ...lead } = body;
  assert.strictEqual(wa_attempts, 1);
  assert.ok(typeof wa_last_try === 'string' && wa_last_try.endsWith('Z'), 'tracking wa_last_try em ISO');
  assert.deepStrictEqual(lead, { whatsapp: '5561999990000', whatsapp_hint: true, wa_status: 'declared', wa_source: 'site', wa_evidence: 'https://souzadv.com.br' });
  assert.ok(!('enriched_at' in body), 'não mexe em enriched_at');
  assert.ok(!('email' in body), 'não mexe em email');
  assert.ok(!('instagram' in body), 'não mexe em instagram');
});
```

  → **Case 2 existente ('não faz PATCH para lead cujo site não tem zap') — atualizado** (decisão J: agora há PATCH de tracking):

```js
test('enrich:wa lead sem nada: PATCH só de tracking (attempts avança, cooldown anda)', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = stubFetch([{ id: 'b2', website: 'https://outro.com' }]);
  await main();
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 1, 'PATCH incondicional de tracking');
  assert.ok(patches[0].url.includes('leads?id=eq.b2'));
  const body = JSON.parse(patches[0].opts.body);
  assert.strictEqual(body.wa_attempts, 1);
  assert.ok(typeof body.wa_last_try === 'string');
  assert.ok(!('whatsapp' in body), 'não grava zap');
  assert.ok(!('whatsapp_hint' in body), 'sem hint');
  assert.ok(!('wa_status' in body) && !('wa_source' in body), 'nada de marcação wa_*');
});
```

  → **Case novo — zap da página interna com evidence da interna (item 1 do escopo):**

```js
test('enrich:wa zap de página interna: PATCH único com evidence da interna', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'i9', website: 'https://interna.com', wa_attempts: 2 }]) };
    }
    if (String(url).includes('contato')) return { url, ok: true, status: 200, text: async () => '</html><body><a href="https://wa.me/5561999888000">Zap</a></body></html>' };
    return { url, ok: true, status: 200, text: async () => '<html><body><a href="/contato">Contato</a></body></html>' };
  };
  await main();
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 1, 'UM patch por lead');
  assert.ok(patches[0].url.includes('leads?id=eq.i9'));
  const body = JSON.parse(patches[0].opts.body);
  assert.strictEqual(body.whatsapp, '5561999888000');
  assert.strictEqual(body.wa_evidence, 'https://interna.com/contato', 'evidence = wa_evidence_url da página interna onde o zap foi achado');
  assert.strictEqual(body.wa_source, 'site');
  assert.strictEqual(body.wa_attempts, 3, 'r.wa_attempts 2 + 1');
  assert.ok(typeof body.wa_last_try === 'string');
});
```

  → **Case novo — hint-only (item 3 do escopo):**

```js
test('enrich:wa texto corrido com wa (sem link declarado): PATCH hint-only', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'h1', website: 'https://hint.com' }]) };
    }
    return { url, ok: true, status: 200, text: async () => '<html><body><p>manda mensagem no wa.me/5561999990000</p></body></html>' };
  };
  await main();
  const body = JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body);
  assert.deepStrictEqual({ ...body, wa_last_try: 'x' }, { whatsapp_hint: true, wa_attempts: 1, wa_last_try: 'x' }, 'PATCH exato: tracking + hint, SEM whatsapp');
});
```

  → **Case novo — wa declarado inválido: SEM hint (item 4 do escopo, decisão G):**

```js
test('enrich:wa wa declarado inválido (invalid_ddd): patch só tracking, SEM hint', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'v1', website: 'https://inv.com' }]) };
    }
    return { url, ok: true, status: 200, text: async () => '<html><body><a href="https://wa.me/5508999990000">Zap</a></body></html>' };
  };
  await main();
  const body = JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body);
  assert.strictEqual(body.wa_attempts, 1);
  assert.ok(typeof body.wa_last_try === 'string');
  assert.ok(!('whatsapp' in body), 'número lixo não grava');
  assert.ok(!('whatsapp_hint' in body), 'SEM hint (decisão G)');
  assert.ok(!('wa_status' in body) && !('wa_source' in body));
});
```

  → **Case novo — degrade GET 0011 (item 5 do escopo):**

```js
test('enrich:wa degrada: GET 400 wa_attempts ausente => instrucao 0011 + erro', async () => {
  const { main } = require('../../scripts/enrich-wa');
  global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_attempts' column of 'leads' in the schema cache" }) });
  await assert.rejects(main, /wa_attempts|0011/);
});
```

  → **Case novo — degrade PATCH wa_last_try → 0011 (item 6 do escopo):**

```js
test('enrich:wa degrada: PATCH 400 wa_last_try ausente => instrucao 0011 + erro', async () => {
  const { main } = require('../../scripts/enrich-wa');
  global.fetch = async (url, opts = {}) => {
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_last_try' column of 'leads' in the schema cache" }) };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'a1', website: 'souzadv.com.br' }]) };
    }
    return { ok: true, status: 200, text: async () => HTML };
  };
  await assert.rejects(main, /wa_last_try|0011/);
});
```

- [ ] **Step 2: rodar** `node --test src/tests/enrich-wa.test.js` — os 5 cases novos e os 2 atualizados devem FALLAR (fila ainda sem cooldown; PATCH sem tracking/sem hint-only). O case de degrade 0010 existente não deve mudar de comportamento — regex do PATCH `/wa_(source|status|evidence|checked_at)/` e mensagem 0010 são PRESERVADOS, então ele continua PASSANDO.
- [ ] **Step 3: implementar** — Conteúdo exato de `scripts/enrich-wa.js` (arquivo inteiro):

```js
/* Backfill do WhatsApp com descoberta profunda (analyzer v2) e fila de recuperação
   (cooldown 7d + cap 6 tentativas via 0011). npm run enrich:wa [limite]. */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { analyzeSite } = require('../src/enrich/site-analyzer');
const { waWriteFields } = require('../src/utils/wa-audit');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WARN_0011 = '[enrich:wa] colunas de retry ausentes — aplique supabase/migrations/0011 no SQL Editor';
const WARN_0010 = '[enrich:wa] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor';

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(); // cooldown 7d (decisão I)
  let rows;
  try {
    rows = (await sbFetch(`leads?select=id,website,phone,address,wa_attempts&website=not.is.null&whatsapp=is.null&wa_attempts=lt.6&or=(wa_last_try.is.null,wa_last_try.lte.${cutoff})&order=id&limit=${limit}`)) || [];
  } catch (e) {
    if (/wa_(attempts|last_try)/.test(e.message)) console.error(WARN_0011);
    throw e;
  }
  console.log(`[enrich:wa] ${rows.length} leads p/ backfill de whatsapp`);
  let analisados = 0, comZap = 0, descartados = 0, soHint = 0, paginas = 0, fail = 0;
  for (const r of rows) {
    analisados++;
    const s = await analyzeSite(r.website).catch(() => null);
    const patch = { wa_attempts: (r.wa_attempts || 0) + 1, wa_last_try: new Date().toISOString() }; // PATCH incondicional de tracking (decisão J)
    if (s && s.ok) {
      paginas += s.pages_visited || 0;
      if (s.whatsapp) {
        const wa = waWriteFields({ whatsapp: s.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: s.wa_evidence_url || s.final_url || r.website });
        if (wa) {
          Object.assign(patch, wa);
          comZap++;
          console.log(`[enrich:wa] ok ${r.website.slice(0, 40)} -> ${s.whatsapp}`);
        } else {
          descartados++; // declarado, mas rejeitado pelo classificador → nem hint (decisão G)
        }
      } else if (s.whatsapp_hint) {
        patch.whatsapp_hint = true; // hint-only (decisão G)
        soHint++;
      }
    }
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } });
    } catch (e) {
      if (/wa_(attempts|last_try)/.test(e.message)) { console.error(WARN_0011); throw e; }
      if (/wa_(source|status|evidence|checked_at)/.test(e.message)) { console.error(WARN_0010); throw e; }
      fail++;
      console.error(`[enrich:wa] erro ${r.id}: ${e.message}`);
    }
    await sleep(400);
  }
  console.log(`[enrich:wa] concluído: ${analisados} analisados, ${comZap} com zap novo, ${descartados} descartados, ${soHint} só hint, ${paginas} páginas extras, ${fail} falhas`);
}

if (require.main === module) {
  main().catch((e) => { console.error('[enrich:wa]', e.message); process.exit(1); });
}
module.exports = { main };
```

- [ ] **Step 4:** `node --test src/tests/enrich-wa.test.js` — verde (TODOS: 2 atualizados + 5 novos + case de degrade 0010 intacto).
- [ ] **Step 5: commit** — `git add scripts/enrich-wa.js src/tests/enrich-wa.test.js && git commit -m "feat(enrich:wa): descoberta profunda + fila com cooldown (0011) e tracking incondicional"`

---

## Plano de verificação final (o executor NÃO cria PR nem deploya)

1. **Suíte:** `npm run test` — verde, **zero falha**. Contagem de cases NOVOS desta fase: **12** (Task 2: 2 em `site-analyzer.test.js`; Task 3: 5 em `site-analyzer.test.js`; Task 4: 5 em `enrich-wa.test.js`) + 3 cases ATUALIZADOS (case 1 do site-analyzer: +1 assert; cases 1 e 2 do enrich-wa: corpo/asserts regravados). Suíte sequencial no node:test — rodar 2x seguidas se algum stub de `global.fetch` vazar estado.
2. **Migration:** aplicar `supabase/migrations/0011_wa_retry.sql` no **SQL Editor** (como 0010). Conferir no Studio: colunas `wa_attempts` (default 0 nos 129 leads) e `wa_last_try` (NULL).
3. **Run real:** `npm run enrich:wa 10` → primeira rodada pós-0011 processa até 10 leads: log por-lead `[enrich:wa] ok <site> -> <digits>` quando achar zap + linha de métricas EXATA (decisão L): `[enrich:wa] concluído: X analisados, Y com zap novo, Z descartados, W só hint, P páginas extras, F falhas`. `P páginas extras > 0` quando alguma interna de contato trouxe zap.
4. **Cooldown:** rodar `npm run enrich:wa 10` de NOVO imediatamente (mesma janela de 7d) → `[enrich:wa] 0 leads p/ backfill de whatsapp` (2ª rodada volta vazia: os processados na 3ª linha acima ficam com `wa_last_try` de hoje > cutoff −7d). Se NÃO voltar vazia, o filtro `or=(...)` da fila está errado — re-verificar a URL exata da decisão I.
5. **Degrade 0011 (caminho real):** rodar `npm run enrich:wa 10` ANTES de aplicar a migration → erro com instrução `aplique supabase/migrations/0011 no SQL Editor` no console e exit 1 (GET falha no catch da fila). O comportamento está em teste; o teste manual é opcional.

## Fora de escopo (Fase 1)

- `scripts/enrich-leads.js` e `src/tests/enrich-leads.test.js` (INTACTOS — decisão F: trade-off de evidência registrado; quem corrige/evidencia é o `enrich:wa`).
- Playwright fallback no `analyzeSite` (browser real para sites JS-only).
- `enrich-ig-wa` / verificação de WhatsApp via Instagram; Baileys / sessão real.
- Qualquer mudança de UI/painel (`web/`, `api/*`), colunas Extras, novos scripts npm.
- Backfill de `wa_attempts` de rows pré-0011 (default 0 resolve) e reset manual de attempts.

## ARQUIVOS TOCADOS (lista completa)

| # | Arquivo | Ação |
| --- | --- | --- |
| 1 | `supabase/migrations/0011_wa_retry.sql` | criar (Task 1) |
| 2 | `src/enrich/site-analyzer.js` | modificar (Task 2: `findWaLink`/`waHint`; Task 3: `CONTACT_RE`/`contactCandidates` + `analyzeSite` v2 + `sansWa`) |
| 3 | `src/tests/site-analyzer.test.js` | modificar (Task 2: 2 cases novos + assert no case 1; Task 3: 5 cases novos) |
| 4 | `scripts/enrich-wa.js` | modificar (Task 4: fila com cooldown + PATCH tracking incondicional + hint-only + degradação 0011/0010 + métricas L) |
| 5 | `src/tests/enrich-wa.test.js` | modificar (Task 4: 2 cases atualizados + 5 cases novos; case de degrade 0010 intacto) |
