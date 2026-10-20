# Fase 2 — fallback DOM no enrich + fontes/consultas + funil: SPEC DE IMPLEMENTAÇÃO

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (ou superpowers:executing-plans) para implementar task por task. Passos usam checkbox (`- [ ]`). Executor não decide NADA fora desta spec.

**Goal:** sites que só revelam o WhatsApp via JavaScript (DOM renderizado) deixam de ter o zap escondido — o `enrich:wa` ganha segunda passada com Playwright (opt-in, limitada por arg) — e a operação ganha visão de funil (`npm run funnel`) + consultas mais amplas por categoria, sem mexer nos contratos da Fase 0/1.

**Architecture:** módulo novo `src/enrich/site-renderer.js` (`renderSite`, Playwright/Chromium local-only) fica FORA da `analyzeSite` (contrato v2 estável, decisão F da Fase 1). O `enrich-wa` espera a passada estática inteira, monta uma fila própria de fallback (hint-first, cap via arg 3), injeta `renderImpl` no padrão do `capture-refill`, extrai com `extractSignals` no HTML renderizado e faz PATCH extra SEM tracking (attempts já contou na 1ª passada). Bloco B: termos novos nas 4 categorias (topografia intocada) + `funnelSummary` pura em `src/utils/funnel.js` consumida por script read-only.

**Tech Stack:** Node 22 (node:test), fetch global, Supabase PostgREST (`sbFetch`/`sbFetchAll`), Playwright (dep existente; `launchBrowser` de `mapsScraper`). Zero dependências novas. **Sem migration** — 0010/0011 já cobrem todas as colunas usadas.

**Spec:** `docs/plans/2026-10-19-fase2-fallback-fontes.md` (este arquivo — autocontido; modelo de formato: `docs/plans/2026-10-19-fase0-wa-real.md` e `2026-10-19-fase1-analyzer-v2.md`).

---

## Contexto verificado no código (leitura de 2026-10-19)

- `src/enrich/site-analyzer.js` — v2 estável: `analyzeSite(url, { fetchImpl, timeoutMs = 6000, budgetMs = 12000 })`, extração via `findWaLink`/`waHint` (internos) expostos por `extractSignals(html)`; `module.exports = { analyzeSite, extractSignals }`. `extractSignals` devolve `{ email, instagram, facebook, whatsapp, whatsapp_hint, since_year, title }` e às cegas NÃO vê conteúdo construído só por JS.
- `scripts/enrich-wa.js` — v1 da Fase 1 íntegra: fila com cooldown 7d + cap 6 (`wa_attempts=lt.6`), PATCH incondicional tracking + hint-only, degradação 0011/0010, métricas na linha final. `main()` hoje SEM opções (teste chama `main()`); `analyzeSite(r.website).catch(() => null)` → `s === null` possível.
- `src/scraper/mapsScraper.js:7-30` — `launchBrowser(opts)` existe, exportada (module.exports:363), devolve `{ browser, context, page }`; usa Chromium FULL com `--headless=new` (spawn EFTYPE do headless-shell anotado no arquivo); logs de teardown do repo fecham `browser.close()` inteiro (padrão `capture-refill.js:34`).
- `scripts/capture-refill.js:9` — padrão de injeção do repo: `main({ fetchImpl = sbFetch, enrichImpl = ..., launchImpl = launchBrowser, limit, sleep: pause = sleep } = {})`; teste stuba tudo e `{ browser: { close }, page: {} }` (cf. `src/tests/capture-refill.test.js:49`).
- `src/utils/categories.js` — `CATEGORIES.tags.terms` alimenta `termsOfCategory`, usada em: `capture-advogados-df.js:47` (só o PRIMEIRO termo monta a 1ª passada — extras só engordam a 2ª passada multi-termo, linha 107) e `capture-plan.js:48` (`collectAltQueries` multiplica termos × RAs low-yield); wrapper arquitetura/tapecaria/estofado/topografia usa QUERIES explícitas de `queries-*.js` (não mudam). `defaultBudgetMinutes(nQueries) = min(60, 6 + 1.6·n)` (`src/utils/capture-plan.js:5-8`).
- `src/tests/categories.test.js:66-68` — trava a lista EXATA de termos de `topografia`; adicionar termo lá quebraria o assert sem ganho claro.
- Base real (2026-10-19): 129 leads, 31 com site, 98 sem site; zap declarado já colhido pelo enrich estático (Fase 0/1). Cooldown 0011 aplicada.
- Pacote de testes = lista explícita em `package.json:7` (+34 arquivos); `playwright` é dep runtime (não dev). Arquivos NÃO na lista (ex.: `enrich-ig-wa`, scripts de Playwright) nunca tiveram teste na suíte.

## Decisões (com traço de raciocínio — não mudar sem nova rodada)

**A — Renderer separado da `analyzeSite` (NÃO tocado).** Fase 1 passou a Fase 0 estável dentro de `analyzeSite` (contrato documentado nas duas specs); um browser real dentro dela mudaria teste, budget, latência e assinatura de TODOS os chamadores de uma vez. Fallback é fenômeno só do `enrich:wa` (fila + cooldown + hint): aí é o lugar certo. `site-renderer.js` é módulo folha (importa só `launchBrowser`) — é o chamador que importa o que precisa do analyzer, nunca ao contrário.

**B — `renderSite(url, { timeoutMs = 15000 })`, um browser por domínio.** `launchBrowser` por chamada + `browser.close()` no `finally` (fecho inteiro: browser é o recurso caro e compartilhar entre leads reusa cookies/caches de domínios anteriores contra isolamento; o custo de ~1s de spawn por lead é aceito quando o total está capado pelo arg). `page.goto` com `waitUntil: 'domcontentloaded'` + settle de 2000ms fixo (redes de terceiros internas; `networkidle` nunca dispara em sites vivos de DF). Devolve `{ ok, status, html, links, finalUrl }`: `ok === true` ⇒ `goto` respondeu; `status = resp.status()` (GET inicial), `html = page.content()` (DOM pós-JS), `links = hrefs crus de todos os `<a>` (o chamador decide o que extrair), `finalUrl = page.url()` (redirect final). Throw do goto / goto inválido / URL vazia ⇒ `{ ok: false, status: null, html: '', links: [], finalUrl: null }`. `launchImpl` NÃO é parametrizado aqui — quem injeta é o CHAMADOR (pode passar `renderImpl` stub que nem abre browser; ver decisão C).

**C — CLI: `npm run enrich:wa [limite] [fallback]` — fallback default 0 (opt-in).** `process.argv[3] ?? 0`. Browser em run noturna de fila (98 leads) é disco/CPU e janela de detecção do Chrome; NO runs normais abrem browser. Sinalização feita manualmente pelo operador quando a fila esfria (primeira `limit` 20; segunda com `fallback 5`). Injeção `main({ renderImpl = renderSite, fallbackLimit, sleep: pause = sleep } = {})` — assinatura compatível: `main()` segue funcionando (fallbackLimit 0 ⇒ sem browser), e os casos de teste da Fase 1 continuam passando SEM stub de render (o default nunca é usado nesses casos: `fallbackLimit 0`).

**D — Fila de fallback = (1) hint-ok primeiro, (2) site morto depois, em memória, cap no arg.** Leads desta MESMA run que (a) ficaram `s.ok && whatsapp_hint && !whatsapp` (sinal fraco já visto — primeiro fruto barato: o DOM pode revelar o `<a href>` que o fetch estático não viu) OU (b) `s.ok === false` (fetch estático falhou — UA/anti-bot bloqueia o fetch e não o Chrome; 404 real falha no render também e cai no `fbNada`). Prioridade (1)-(2) na fila. `s === null` (analyzeSite THROWN) ⇒ fora — sem HTML não há candidatos e o render arcará com a mesma rede morta. `descartados` (wa declarado rejeitado pelo classificador) ⇒ fora — o DOM vai devolver o MESMO link declarado lixo; reciclar é queimar browser para rejeitar 2x. Cap: `.slice(0, fbLimit)`.

**E — Extração no DOM renderizado com REUSO total; PATCH extra SEM tracking.** `extractSignals(rend.html)` — os helpers internos `findWaLink`/`waHint` já são roteados por ela (mesma régua declarada vs. hint da Fase 1, zero duplicação). Zap declarado + classificador ok ⇒ PATCH `{ whatsapp, whatsapp_hint, wa_status, wa_source, wa_evidence: rend.finalUrl || r.website }` (`waWriteFields` como na Fase 0). **Sem `wa_attempts`/`wa_last_try` neste 2º PATCH**: attempts já somou na passada estática da MESMA run (regra J Fase 1) — somar de novo mentiria no contador (o cooldown anda de qualquer forma, que é o conceito "0011 anda mesmo quando fallback roda"). Hint-only no DOM ⇒ PATCH `{ whatsapp_hint: true }` (idempotente — hint pode já estar true). Nada achado no DOM ⇒ só contagem `fbNada`. De PUT nenhum campo de tracking no fallback: lead que ganha zap sai da fila pelo `whatsapp=is.null` de qualquer jeito.

**F — Degradação no fallback = mesmas regexes do corpo.** PATCH do fallback casa `/wa_(attempts|last_try)/` → WARN_0011 + rethrow e `/wa_(source|status|evidence|checked_at)/` → WARN_0010 + rethrow (mensagens EXATAS das Fases 0/1 — os cases de degrade existentes não regredir). Outros erros por-lead ⇒ `fbFail++` e segue. `wa_evidence` (coluna DB) recebe a URL do redirect final — mais precisa que `final_url` estático e a coluna é a mesma.

**G — Métricas: linha própria do fallback; linha final da Fase 1 INTACTA.** Se `fbFila.length > 0` (e só nesse caso): `[enrich:wa] fallback DOM concluído: N tentado(s), Z com zap novo, W ainda sem, F falhas`. A linha `concluído: X analisados, ...` da Fase 1 não ganha campos (back-compat com quem parseia log).

**H — Consultas: termos novos em 4 categorias; topografia INTACTA.** Sinônimos PT reais de busca no Maps, SEM nicho novo: `advogados` ganha especialidades (trabalhista/imobiliário/cível/previdenciário — 4ª categoria mais escassa na base); `tapecaria` ganha `tapetes/cortinas/persianas/papel de parede` (o que o nicho VENDE e o Maps categoriza naturalmente — as raízes de filtro `tapet/cortina/persiana` já cobrem); `estofado` ganha `higienização de estofados/conserto de estofados/encapamento de estofados` (raízes `estofad/tapic` cobrem); `arquitetura` ganha `arquiteta/projeto arquitetônico` (raízes `arquitet` cobrem). **Topografia nítida fora**: nicho já rico em raízes + o teste trava a lista exata (assert 66-68) — tocar lá requer editar assert SEM ganho de recall. **Impacto de budget (NOTA, sem código):** a 1ª passada usa SÓ `terms[0]` — não muda nada; a 2ª passada (multi-termo, linha 107) e os planos de alternativas (`collectAltQueries`) multiplicam termos × RAs low-yield — mais candidatos é mais tempo NO budget, mas o cap de 60min e o corte `DEADLINE_MARGIN_MS` amarram: cortam fila, não travam run. Não trocar nada de `defaultBudgetMinutes` nesta fase.

**I — Funil como função PURA (`src/utils/funnel.js`) + script read-only.** `funnelSummary(rows)` sem fetch/estado — o script `scripts/funnel.js` só aplica `select` + imprime + salva JSON. Testável sem Supabase (arquivo de teste EXISTENTE escolhido: `src/tests/metrics.test.js` — dashboards/métricas da base é o domínio do arquivo; constraint hard: NNÃO criar arquivo novo). Resumo não-PURE zero.

**J — Shape do resumo e não-computáveis.** Campos: `total`, `comSite` (website truthy), `comPhone`, `comZap` (usa `hasWa` de `wa.js` — DEFINIÇÃO CANÔNICA do repo de "zap contatável": número cru malformado NÃO conta), `zapsUnicos` (distintos via `waDigits`), `comHint` (hint true SEM zap válido), `waStatus` (declared/suspect/invalid/outro — null conta em `outro`), `waSource` (maps/site/instagram/desconhecido — null conta em `desconhecido`), `comEvidence` (zap com evidência — lê `wa_evidence_url` analítico OU coluna DB `wa_evidence`), `evidencePct` (sobre comZap, Math.round), `descobertaPct` (zap declarado ENTRE leads com site ÷ comSite, Math.round — o "wa declarado / leads com site" do escopo; zap colhido em lead SEM site não entra no numerador, senão a taxa passa de 100% e perde sentido de descoberta), `semSites` `{ total, tierA, tierB }` (ICP snapshot, sem PATCH nas colunas de qualify). **Tiers** — reconhecendo que o motor real (`src/qualify/engine.js`) qualifica pelo fit inteiro, aqui é leitura rápida: tierA = sem site, `!closed`, `claimed === true`, `rating >= 4.0` e `reviews >= 100` (perfil reclamado, volume alto — melhor ICP de serviços); tierB = sem site, `!closed`, fora do A, `(rating >= 3.5 || reviews >= 20)` (qualquer porte razoável). Fechados ficam fora dos dois (lead `closed` não é meta de outreach).

**K — Funnel READ-ONLY com degrade de select.** `sbFetchAll` com select completo; se 400 `Could not find the 'wa_source'/'wa_status'/'wa_evidence'/'wa_attempts'/'whatsapp_hint' column of 'leads'` → refetch com select reduzido (só colunas base) + instrução de migration (0010/0011) no console. Nenhum PATCH no funnel.

**L — Sem migration 0012.** Todas as colunas usadas já estão em 0010/0011/0004/0007. Se o executor achar que precisa de coluna nova, está FORA da spec — report-reject no review, não improvisa.

---

## Global Constraints

- JS estilo do repo: `require`, CommonJS, dotenv, sem SDK de Supabase (`sbFetch`/`sbFetchAll` em `src/utils/sb.js`).
- Comentários PT-BR curtos (uma linha no topo do arquivo/hook), estilo dos arquivos existentes.
- Nenhuma dependência nova. Playwright: dep existente, local-only (Chromium full + `--headless=new` já resolve o spawn do ambiente).
- Nenhum arquivo de teste NOVO (suíte = lista explícita em `package.json:7`); só ADD cases em arquivos existentes.
- `src/enrich/site-analyzer.js` INTACTO nesta fase (contrato v2 da Fase 1).
- `scripts/enrich-leads.js` e seus testes INTACTOS.
- Migrations aplicadas pelo usuário no SQL Editor — nenhum código novo assume coluna inexistente (degrada com instrução).
- Stubs de teste: `global.fetch` no padrão da suíte + injeção de impls nos `main()` no padrão `capture-refill`.
- Playwright NÃO é mockado como browser real na suíte (padrão: scripts Chromium nunca cobertos por testes) — testes cobrem o hook do enrich com `renderImpl` stub.

---

## Task 1 — `src/enrich/site-renderer.js` (renderer Playwright, folha)

**Files:**
- Create: `src/enrich/site-renderer.js`
- Test: NENHUM na suíte (browser real — padrão `enrich-ig-wa`; o hook é testado na Task 2 com stub)

**Interfaces:**
- Consumes: `launchBrowser` de `src/scraper/mapsScraper.js` (exportada em `:363`).
- Produces (Task 2): `renderSite(rawUrl, { timeoutMs = 15000 } = {})` → Promise de `{ ok, status, html, links, finalUrl }` (contrato na decisão B).

**Conteúdo exato do arquivo:**

```js
/* Renderiza uma URL em Chromium headless (Playwright, local-only) e devolve o
   DOM pós-JS. Um browser por chamada, fechado no finally — NUNCA coberto pela
   suíte (browser real): chamadores injetam renderImpl stub nos testes. */
const { launchBrowser } = require('../scraper/mapsScraper');

async function renderSite(rawUrl, { timeoutMs = 15000 } = {}) {
  const { browser, page } = await launchBrowser({ headless: true }); // launchBrowser resolve headless=interno (--headless=new)
  try {
    let url = String(rawUrl || '').trim();
    if (!url) return { ok: false, status: null, html: '', links: [], finalUrl: null };
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url; // mesma normalização do analyzer
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => null);
    if (!resp) return { ok: false, status: null, html: '', links: [], finalUrl: null };
    await page.waitForTimeout(2000); // settle de rede/DOM (networkidle nunca dispara em site vivo)
    const html = await page.content();
    const links = await page.$$eval('a[href]', (els) => els.map((e) => e.getAttribute('href'))).catch(() => []);
    return { ok: true, status: resp.status(), html, links, finalUrl: page.url() };
  } finally {
    await browser.close().catch(() => {}); // browser INTEIRO: resource é por domínio/lead
  }
}

module.exports = { renderSite };
```

- [ ] Criar o arquivo **exatamente** como acima (headless passado por semântica: `launchBrowser` já decide qual binário roda — ver nota em `mapsScraper.js:9-14`).
- [ ] **Smoke manual (opcional, sem Supabase):** `node -e "require('dotenv').config();const {renderSite}=require('./src/enrich/site-renderer');renderSite('https://outraurl').then((r)=>console.log(JSON.stringify({ok:r.ok,status:r.status,finalUrl:r.finalUrl,links:r.links.length,html:r.html.length}),null,2))"` (substituir `https://outraurl` por um site real do nicho; com `node -e`, extra args caem em `argv[1]` — não `argv[2]` — então a URL vai BAKED no comando mesmo) — deve logar `ok:true` + `finalUrl` e fechar o processo (browser fechado ⇒ sem processo Chromium pendurado, conferir com `tasklist | findstr chrome`). **Não commitar esse run.**
- [ ] Commit: `git add src/enrich/site-renderer.js && git commit -m "feat(enrich): site-renderer - DOM pós-JS via Playwright local-only"`

---

## Task 2 — `scripts/enrich-wa.js`: fallback DOM opt-in (arquivo INTEIRO reescrito)

**Files:**
- Modify: `scripts/enrich-wa.js` (arquivo inteiro; fila/estática/PATCH da Fase 1 PRESERVADOS byte a byte exceto onde notado)
- Test: `src/tests/enrich-wa.test.js` (4 cases novos; todos os cases existentes da Fase 1 INTACTOS — inclusive os de degrade)

**Comportamento antes:** só passada estática — hint-only fechado no `whatsapp_hint`, site morto (404/timeout) encerra na primeira tentativa, conteúdo JS-only nunca consegue ser lido.
**Depois:** CLI `npm run enrich:wa [limite] [fallback]`; após a fila estática, fila própria (decisão D) renderizada com `renderImpl` injetável (decisão B/C), extração via `extractSignals` (decisão E), PATCH extra sem tracking (decisão E), degradação F, métricas G.

**Interfaces:**
- Consumes (Task 1): `renderSite(url, { timeoutMs = 15000 })` → `{ ok, status, html, links, finalUrl }`.
- Consumes (Fase 1 Intactos): `analyzeSite` (sinal estático), `waWriteFields`, fila com cooldown/cap, PATCH tracking.
- `main({ renderImpl = renderSite, fallbackLimit, sleep: pause = sleep } = {})` — assinatura nova sem quebrar `main()` bare.

## Conteúdo exato de `scripts/enrich-wa.js` (arquivo inteiro):

```js
/* Backfill do WhatsApp com descoberta profunda (analyzer v2), fila de recuperação
   (cooldown 7d + cap 6 via 0011) e fallback DOM opt-in (Playwright).
   npm run enrich:wa [limite] [fallback] */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { analyzeSite, extractSignals } = require('../src/enrich/site-analyzer');
const { waWriteFields } = require('../src/utils/wa-audit');
const { renderSite } = require('../src/enrich/site-renderer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WARN_0011 = '[enrich:wa] colunas de retry ausentes — aplique supabase/migrations/0011 no SQL Editor';
const WARN_0010 = '[enrich:wa] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor';

async function main({ renderImpl = renderSite, fallbackLimit, sleep: pause = sleep } = {}) {
  const limit = parseInt(process.argv[2] || '50', 10);
  const fbLimit = fallbackLimit ?? parseInt(process.argv[3] || '0', 10); // fallback DOM é opt-in (decisão C)
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(); // cooldown 7d (decisão I F1)
  let rows;
  try {
    rows = (await sbFetch(`leads?select=id,website,phone,address,wa_attempts&website=not.is.null&whatsapp=is.null&wa_attempts=lt.6&or=(wa_last_try.is.null,wa_last_try.lte.${cutoff})&order=id&limit=${limit}`)) || [];
  } catch (e) {
    if (/wa_(attempts|last_try)/.test(e.message)) console.error(WARN_0011);
    throw e;
  }
  console.log(`[enrich:wa] ${rows.length} leads p/ backfill de whatsapp`);
  let analisados = 0, comZap = 0, descartados = 0, soHint = 0, paginas = 0, fail = 0;
  const filaHint = [], filaMorta = []; // fila de fallback: hint-ok primeiro, site morto depois (decisão D)
  for (const r of rows) {
    analisados++;
    const s = await analyzeSite(r.website).catch(() => null);
    const patch = { wa_attempts: (r.wa_attempts || 0) + 1, wa_last_try: new Date().toISOString() }; // PATCH incondicional (decisão J F1)
    if (!s) {
      console.error(`[enrich:wa] analyzer morreu em ${r.id}: seguindo`); // s===null: não entra em fila nenhuma (decisão D)
    } else if (s.ok) {
      paginas += s.pages_visited || 0;
      if (s.whatsapp) {
        const wa = waWriteFields({ whatsapp: s.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: s.wa_evidence_url || s.final_url || r.website });
        if (wa) {
          Object.assign(patch, wa);
          comZap++;
          console.log(`[enrich:wa] ok ${r.website.slice(0, 40)} -> ${s.whatsapp}`);
        } else {
          descartados++; // rejeitado pelo classificador fora da fila (decisão D)
        }
      } else if (s.whatsapp_hint) {
        patch.whatsapp_hint = true; // hint-only (decisão G F1)
        soHint++;
        filaHint.push(r);
      }
    } else {
      filaMorta.push(r); // s.ok === false: fetch estático falhou, Chrome pode conseguir (decisão D)
    }
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } });
    } catch (e) {
      if (/wa_(attempts|last_try)/.test(e.message)) { console.error(WARN_0011); throw e; }
      if (/wa_(source|status|evidence|checked_at)/.test(e.message)) { console.error(WARN_0010); throw e; }
      fail++;
      console.error(`[enrich:wa] erro ${r.id}: ${e.message}`);
    }
    await pause(400);
  }
  console.log(`[enrich:wa] concluído: ${analisados} analisados, ${comZap} com zap novo, ${descartados} descartados, ${soHint} só hint, ${paginas} páginas extras, ${fail} falhas`);
  // Fase 2: fallback DOM opt-in (decisões B/C/D/E) — PULO quando fbLimit=0
  const fbFila = filaHint.concat(filaMorta).slice(0, fbLimit); // hint-ok primeiro, morta depois, cap no arg
  if (fbFila.length) {
    console.log(`[enrich:wa] fallback DOM: ${fbFila.length} lead(s) p/ render com Chromium`);
    let fbZap = 0, fbNada = 0, fbFail = 0;
    for (const r of fbFila) {
      try {
        const rend = await renderImpl(r.website, { timeoutMs: 15000 });
        const dom = rend && rend.ok && rend.html ? extractSignals(rend.html) : null;
        if (dom && dom.whatsapp) {
          const wa = waWriteFields({ whatsapp: dom.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: rend.finalUrl || r.website });
          if (wa) {
            await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: wa, headers: { Prefer: 'return=minimal' } }); // SEM tracking: attempts já somou na estática (decisão E)
            fbZap++;
            console.log(`[enrich:wa] fallback ok ${r.website.slice(0, 40)} -> ${dom.whatsapp}`);
          } else {
            fbNada++; // zap do DOM rejeitado no judge: nenhuma escrita, nem hint
          }
        } else if (dom && dom.whatsapp_hint) {
          await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: { whatsapp_hint: true }, headers: { Prefer: 'return=minimal' } });
          fbNada++;
        } else {
          fbNada++; // render morto ou DOM sem zap: tenta próximo da fila
        }
      } catch (e) {
        if (/wa_(attempts|last_try)/.test(e.message)) { console.error(WARN_0011); throw e; }
        if (/wa_(source|status|evidence|checked_at)/.test(e.message)) { console.error(WARN_0010); throw e; }
        fbFail++;
        console.error(`[enrich:wa] fallback erro ${r.id}: ${e.message}`);
      }
      await pause(400);
    }
    console.log(`[enrich:wa] fallback DOM concluído: ${fbFila.length} tentado(s), ${fbZap} com zap novo, ${fbNada} ainda sem, ${fbFail} falhas`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('[enrich:wa]', e.message); process.exit(1); });
}
module.exports = { main };
```

**Diff único em relação à Fase 1 (referência de review):** linha 6 (`require` do renderer), assinatura de `main` + `fbLimit` (+DEFAULT 0), fila de fallback + 2 ramos do fluxo estático (`!s` loga e segue; `!s.ok ⇒ filaMorta.push(r)`), bloco pós-linha de métricas.

- [ ] **Step 1: os 4 cases novos** (ao final de `src/tests/enrich-wa.test.js`; arquivos/cases existentes da Fase 1 INTACTOS):

```js
// ---- Fase 2: fallback DOM (renderImpl stub no padrão launchImpl do capture-refill) ----

const RENDER_ZAP = { ok: true, status: 200, html: '<html><body><a href="https://wa.me/5561999977000">Fale</a></body></html>', links: ['https://wa.me/5561999977000'], finalUrl: 'https://hint.com/' };

test('enrich:wa fallback DOM: hint único na estática vira zap declarado no DOM (PATCH extra sem tracking)', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'fb1', website: 'https://hint.com', wa_attempts: 0 }]) };
    }
    return { url, ok: true, status: 200, text: async () => '<html><body><p>manda mensagem no wa.me/5561999990000</p></body></html>' }; // estática: hint-only
  };
  const renders = [];
  const renderImpl = async (u, o) => { renders.push({ u, o }); return RENDER_ZAP; };
  await main({ renderImpl, fallbackLimit: 2, sleep: async () => {} });
  assert.strictEqual(renders.length, 1, 'UM render — só o lead da fila de fallback');
  assert.strictEqual(renders[0].u, 'https://hint.com');
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 2, 'PATCH estático + PATCH de fallback');
  const b1 = JSON.parse(patches[0].opts.body);
  assert.strictEqual(b1.wa_attempts, 1, 'tracking na passada estática');
  assert.strictEqual(b1.whatsapp_hint, true);
  const b2 = JSON.parse(patches[1].opts.body);
  assert.strictEqual(b2.whatsapp, '5561999977000', 'zap do DOM renderizado');
  assert.strictEqual(b2.wa_evidence, 'https://hint.com/', 'evidence = finalUrl do render');
  assert.strictEqual(b2.wa_source, 'site');
  assert.strictEqual(b2.wa_status, 'declared');
  assert.ok(!('wa_attempts' in b2) && !('wa_last_try' in b2), 'PATCH de fallback SEM tracking (decisão E)');
});

test('enrich:wa fallback DOM: site morto na estática (ok:false) também vai à fila', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'fb2', website: 'https://dead.com' }]) };
    }
    return { url, ok: false, status: 404, text: async () => 'not found' }; // estática morta
  };
  await main({
    fallbackLimit: 2, sleep: async () => {},
    renderImpl: async () => ({ ok: true, status: 200, html: '<html><body><a href="https://wa.me/5561999966000">Zap</a></body></html>', links: [], finalUrl: 'https://dead.com/' }),
  });
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 2);
  const b1 = JSON.parse(patches[0].opts.body);
  assert.strictEqual(b1.wa_attempts, 1, 'site morto ganha tracking igual (0011 anda em tudo)');
  assert.ok(!('whatsapp' in b1), 'estática morta não grava nada de zap');
  const b2 = JSON.parse(patches[1].opts.body);
  assert.strictEqual(b2.whatsapp, '5561999966000', 'Chrome conseguiu onde o fetch não conseguiu');
  assert.strictEqual(b2.wa_evidence, 'https://dead.com/');
});

test('enrich:wa fallback: cap do arg respeitado (2 hints, fallbackLimit 1 => 1 render)', async () => {
  const { main } = require('../../scripts/enrich-wa');
  global.fetch = async (url, opts = {}) => {
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'c1', website: 'https://h1.com' }, { id: 'c2', website: 'https://h2.com' }]) };
    }
    return { url, ok: true, status: 200, text: async () => '<html><body><p>zap no texto wa.me/5561999990000</p></body></html>' };
  };
  let renders = 0;
  await main({
    fallbackLimit: 1, sleep: async () => {},
    renderImpl: async () => { renders++; return { ok: true, status: 200, html: '<a href="https://wa.me/5561999955000">z</a>', links: [], finalUrl: 'https://rendered.com/' }; },
  });
  assert.strictEqual(renders, 1, 'cap do fallback limit');
});

test('enrich:wa SEM fallback (default 0): render NUNCA é chamado — casos da Fase 1 não abrem browser', async () => {
  const { main } = require('../../scripts/enrich-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/leads')) {
      if (opts.method === 'PATCH') return { ok: true, status: 204, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'nf1', website: 'https://hint.com' }]) };
    }
    return { url, ok: true, status: 200, text: async () => '<html><body><p>hint wa.me/5561999990000</p></body></html>' };
  };
  let renders = 0;
  const renderImpl = async () => { renders++; return RENDER_ZAP; };
  await main({ renderImpl, sleep: async () => {} }); // fallbackLimit indefinido => argv[3] ?? 0 => 0
  assert.strictEqual(renders, 0, 'fallback opt-in: default não abre browser');
  const patch = JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body);
  assert.strictEqual(patch.wa_attempts, 1, 'comportamento da Fase 1 intacto');
  assert.strictEqual(patch.whatsapp_hint, true);
  assert.ok(!('whatsapp' in patch));
});
```

- [ ] **Step 2: rodar** `node --test src/tests/enrich-wa.test.js` — os 4 cases novos devem FALHAR (main ainda sem opções / sem bloco de fallback). Cases existentes da Fase 1 devem CONTINUAR PASSANDO (default fbLimit 0 não muda nada nos cases deles).
- [ ] **Step 3: implementar** reescrevendo `scripts/enrich-wa.js` com o conteúdo exato acima.
- [ ] **Step 4:** `node --test src/tests/enrich-wa.test.js` — TODOS verde (7 cases da Fase 1 + 4 novos).
- [ ] **Step 5: commit** — `git add scripts/enrich-wa.js src/tests/enrich-wa.test.js && git commit -m "feat(enrich:wa): fallback DOM opt-in (Playwright) com fila hint-first e PATCH sem tracking"`

---

## Task 3 — Consultas: termos novos nas 4 categorias (sem nicho novo)

**Files:**
- Modify: `src/utils/categories.js` (só a lista `terms` de 4 registros)
- Test: `src/tests/categories.test.js` (1 case novo; assert de `topografia` em `:66-68` INTACTO)

**Comportamento antes:** advogados tem 3 termos genéricos; tapecaria/estofado/arquitetura têm 2-3; sinônimos reais por onde o nicho aparece no Maps ficam de fora da 2ª passada multi-termo.
**Depois:** listas expandidas abaixo (decisão H). A 1ª passada usa só `terms[0]` (nada muda); a 2ª passada multi-termo e `collectAltQueries` passam a oferecer as alternativas novas aos RAs low-yield. Nenhum budget, planner ou raiz de filtro muda (NOTA de impacto em decisão H).

**Linhas exatas da lista `terms` após a edição:**

```js
  advogados: { tag: 'advogados', label: 'Advogado', script: 'capture-advogados-df.js', queriesModule: './queries', queriesExport: 'QUERIES', basename: null, terms: ['advogado', 'advocacia', 'escritório de advocacia', 'advogado trabalhista', 'advogado imobiliário', 'advogado cível', 'advogado previdenciário'] },
  arquitetura: { tag: 'arquitetura', label: 'Arquitetura', script: 'capture-arquitetura.js', queriesModule: './queries-arquitetura', queriesExport: 'QUERIES_ARQ', basename: 'arquitetura-df-max', terms: ['arquitetura', 'arquiteto', 'arquiteta', 'projeto arquitetônico'] },
  tapecaria: { tag: 'tapecaria', label: 'Tapeçaria', script: 'capture-tapecaria.js', queriesModule: './queries-tapecaria', queriesExport: 'QUERIES_TAP', basename: 'tapecaria-df-max', terms: ['tapeçaria', 'tapiçaria', 'arroz de tapete', 'tapetes', 'cortinas', 'persianas', 'papel de parede'] },
  estofado: { tag: 'estofado', label: 'Estofado', script: 'capture-estofado.js', queriesModule: './queries-estofado', queriesExport: 'QUERIES_EST', basename: 'estofado-df-max', terms: ['estofados', 'limpeza de estofados', 'tapetes', 'higienização de estofados', 'conserto de estofados', 'encapamento de estofados'] },
  topografia: { tag: 'topografia', label: 'Topografia', script: 'capture-topografia.js', queriesModule: './queries-topografia', queriesExport: 'QUERIES_TOP', basename: 'topografia-df-max', terms: ['topografia', 'topógrafo', 'levantamento topográfico', 'georreferenciamento'] },
```

(Nota: `topografia` fica IGUAL à linha atual — listado inteiro acima só para o executor conferir que NÃO editou a linha errada.)

- [ ] **Step 1: case novo** (ao final de `src/tests/categories.test.js`):

```js
test('fase 2: termos novos por categoria (sem nicho novo, topografia intocada)', () => {
  assert.ok(termsOfCategory('advogados').includes('advogado trabalhista'));
  assert.ok(termsOfCategory('tapecaria').includes('persianas'));
  assert.ok(termsOfCategory('estofado').includes('encapamento de estofados'));
  assert.ok(termsOfCategory('arquitetura').includes('projeto arquitetônico'));
  assert.deepStrictEqual(termsOfCategory('topografia'), ['topografia', 'topógrafo', 'levantamento topográfico', 'georreferenciamento'], 'nicho rico já tem raízes suficientes — não mexer');
  for (const cat of ['advogados', 'arquitetura', 'tapecaria', 'estofado']) {
    const termos = termsOfCategory(cat);
    assert.strictEqual(new Set(termos).size, termos.length, `${cat}: sem duplicados`);
  }
});
```

- [ ] **Step 2: rodar** `node --test src/tests/categories.test.js` — o case novo deve FALHAR (listas atuais não têm os termos).
- [ ] **Step 3: aplicar as listas exatas acima** em `src/utils/categories.js` (toque só no objeto `CATEGORIES`; `termsOfCategory` e o resto do arquivo intocados).
- [ ] **Step 4:** verde (inclui o assert de cima e o lá de `:66-68` intacto).
- [ ] **Step 5: commit** — `git add src/utils/categories.js src/tests/categories.test.js && git commit -m "feat(capture): consultas por categoria ampliadas (sinônimos/especialidades nos 4 nichos)"`

---

## Task 4 — `src/utils/funnel.js` (funnelSummary pura)

**Files:**
- Create: `src/utils/funnel.js`
- Test: `src/tests/metrics.test.js` (2 cases novos)

**Interfaces:**
- Consumes: `hasWa`/`waDigits` de `src/utils/wa.js` (definição canônica de "zap contatável" — decisão J).
- Produces (Task 5): `funnelSummary(rows) => { total, comSite, comPhone, comZap, zapsUnicos, comHint, comEvidence, evidencePct, descobertaPct, waStatus: {declared, suspect, invalid, outro}, waSource: {maps, site, instagram, desconhecido}, semSites: {total, tierA, tierB} }`. Zero I/O, zero `fetch`.

**Conteúdo exato do arquivo:**

```js
/* Funil da base leads — computação PURA (sem I/O). Scripts só trazem rows e
   imprimem/salvam; testes rodam em memória. "Zap" = hasWa (canônico de wa.js). */
const { hasWa, waDigits } = require('./wa');

const WA_KEYS = ['declared', 'suspect', 'invalid']; // null/lixo cai em 'outro'
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function funnelSummary(rows) {
  const rs = Array.isArray(rows) ? rows : [];
  const comSite = rs.filter((r) => r && r.website).length;
  const comPhone = rs.filter((r) => r && r.phone).length;
  const comZap = rs.filter(hasWa);
  const zapsUnicos = new Set(comZap.map((r) => waDigits(r.whatsapp))).size;
  const comHint = rs.filter((r) => r && r.whatsapp_hint && !hasWa(r)).length;
  const waStatus = { declared: 0, suspect: 0, invalid: 0, outro: 0 };
  const waSource = { maps: 0, site: 0, instagram: 0, desconhecido: 0 };
  for (const r of rs) {
    waStatus[r && WA_KEYS.includes(r.wa_status) ? r.wa_status : 'outro']++;
    waSource[r && ['maps', 'site', 'instagram'].includes(r.wa_source) ? r.wa_source : 'desconhecido']++;
  }
  const comEvidence = comZap.filter((r) => r.wa_evidence_url || r.wa_evidence).length; // coluna analítica OU DB
  const semSite = rs.filter((r) => r && !r.website && !r.closed); // ICP snapshot (decisão J)
  const isTierA = (r) => r.claimed === true && r.rating >= 4.0 && r.reviews >= 100;
  const tierA = semSite.filter(isTierA).length;
  const tierB = semSite.filter((r) => !isTierA(r) && (r.rating >= 3.5 || r.reviews >= 20)).length;
  return {
    total: rs.length, comSite, comPhone,
    comZap: comZap.length, zapsUnicos, comHint,
    comEvidence, evidencePct: pct(comEvidence, comZap.length),
    descobertaPct: pct(comZap.filter((r) => r && r.website).length, comSite), // wa declarado / leads COM site (decisão J)
    waStatus, waSource,
    semSites: { total: semSite.length, tierA, tierB },
  };
}

module.exports = { funnelSummary };
```

- [ ] **Step 1: os 2 cases novos** (ao final de `src/tests/metrics.test.js`):

```js
// ---- Fase 2: funil da base (funnelSummary pura) ----
const { funnelSummary } = require('../utils/funnel');

test('funnelSummary: contagens/únicos/evidência/tiers sobre arrays em memória', () => {
  const rows = [
    { id: 'a', website: 'https://x.com', phone: '61999990000', whatsapp: '5561999990000', wa_source: 'site', wa_status: 'declared', wa_evidence_url: 'https://x.com' },
    { id: 'b', website: null, phone: '6132224444', whatsapp: '5561999990000', wa_source: 'site', wa_status: 'declared', claimed: true, rating: 4.8, reviews: 200 }, // mesmo zap de a (lead junto) — único conta 1x
    { id: 'c', website: 'https://y.com', phone: null, whatsapp: null, whatsapp_hint: true, wa_source: 'maps', wa_status: 'suspect' },
    { id: 'd', website: null, phone: null, whatsapp: '123', wa_source: null, wa_status: null, claimed: true, rating: 4.9, reviews: 150 }, // zap cru malformado: NÃO conta (hasWa)
    { id: 'e', website: null, phone: '61988880000', whatsapp: '5561988880000', wa_source: 'instagram', wa_status: 'declared', wa_evidence: 'https://ig.com/p/x/', rating: 3.0, reviews: 5 },
    { id: 'f', website: null, phone: null, whatsapp: null, closed: true }, // fechado: fora de semSites/tiers
  ];
  const s = funnelSummary(rows);
  assert.strictEqual(s.total, 6);
  assert.strictEqual(s.comSite, 2);
  assert.strictEqual(s.comPhone, 3);
  assert.strictEqual(s.comZap, 3, 'a + b + e (d tem zap malformado e não conta)');
  assert.strictEqual(s.zapsUnicos, 2, 'a/b compartilham número; e é outro');
  assert.strictEqual(s.comHint, 1, 'hint sem zap válido: só c');
  assert.strictEqual(s.waStatus.declared, 3);
  assert.strictEqual(s.waStatus.suspect, 1);
  assert.strictEqual(s.waStatus.outro, 1, 'd com wa_status null => outro');
  assert.strictEqual(s.waStatus.invalid, 0);
  assert.strictEqual(s.waSource.site, 2);
  assert.strictEqual(s.waSource.desconhecido, 2, 'd (null) + f (null)');
  assert.strictEqual(s.waSource.maps, 1);
  assert.strictEqual(s.waSource.instagram, 1);
  assert.strictEqual(s.comEvidence, 2, 'a (wa_evidence_url) + e (wa_evidence DB)');
  assert.strictEqual(s.evidencePct, 67, '2/3');
  assert.strictEqual(s.descobertaPct, 50, '1 zap entre os 2 leads COM site (b/e são de lead sem site)');
  assert.strictEqual(s.semSites.total, 2, 'd + e (f fechado fora)');
  assert.strictEqual(s.semSites.tierA, 1, 'd: claimed, 4.9, 150 reviews');
  assert.strictEqual(s.semSites.tierB, 0, 'e: rating 3.0 < 3.5 e reviews 5 < 20 — fora do A e sem sinais');
});

test('funnelSummary: base vazia e shape completo', () => {
  const s = funnelSummary([]);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.comZap, 0);
  assert.strictEqual(s.descobertaPct, 0);
  assert.strictEqual(s.evidencePct, 0);
  assert.deepStrictEqual(s.semSites, { total: 0, tierA: 0, tierB: 0 });
  assert.deepStrictEqual(Object.keys(s).sort(), ['comEvidence', 'comHint', 'comPhone', 'comSite', 'comZap', 'descobertaPct', 'evidencePct', 'semSites', 'total', 'waSource', 'waStatus', 'zapsUnicos']);
});
```

- [ ] **Step 2: rodar** `node --test src/tests/metrics.test.js` — os 2 cases devem FALHAR (módulo ainda não existe).
- [ ] **Step 3: implementar** com o conteúdo exato acima.
- [ ] **Step 4:** verde.
- [ ] **Step 5: commit** — `git add src/utils/funnel.js src/tests/metrics.test.js && git commit -m "feat(funnel): funnelSummary pura - métricas de funil da base (tiers ICP snapshot)"`

---

## Task 5 — `scripts/funnel.js` (read-only: select + print + JSON) + `npm run funnel`

**Files:**
- Create: `scripts/funnel.js`
- Modify: `package.json` (`"scripts"`: adicionar `"funnel": "node scripts/funnel.js",` após `"audit:wa"`; a linha do `test` NÃO muda — nenhum arquivo de teste novo)
- Test: coberto pela Task 4 (a função é pura); o script em si segue o padrão do repo de scripts I/O sem case próprio (cf. `qualify.js`, `dedupe.js`).

**Comportamento:** lê a base com select completo (colunas `wa_*` da telemetria inclusas) → 400 de coluna ausente refetch com select reduzido (decisão K) → `funnelSummary` → imprime 6 linhas humanas → salva `data/funnel-<YYYY-MM-DD>.json`. Zero PATCH.

**Conteúdo exato do arquivo:**

```js
/* Funil da base leads — leitura PURA (sem PATCH): métricas impressas e salvas em
   data/funnel-<data>.json. Degrade de select pega quando 0010/0011 pendentes.
   npm run funnel */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sbFetchAll } = require('../src/utils/sb');
const { funnelSummary } = require('../src/utils/funnel');

// select completo: tudo que funnelSummary lê + telemetria das Fases 0/1
const COLS = 'id,phone,whatsapp,website,email,instagram,claimed,rating,reviews,types,captured_at,whatsapp_hint,wa_source,wa_status,wa_evidence,wa_attempts';

async function fetchBase() {
  try {
    return (await sbFetchAll(`leads?select=${COLS}&order=id`)) || [];
  } catch (e) {
    if (!/wa_(source|status|evidence|attempts)|whatsapp_hint/.test(e.message)) throw e;
    console.warn('[funnel] colunas de telemetria ausentes — refetch sem elas (aplique 0010/0011 no SQL Editor)');
    return (await sbFetchAll('leads?select=id,phone,whatsapp,website,email,instagram,claimed,rating,reviews,types,captured_at&order=id')) || [];
  }
}

async function main() {
  const rows = await fetchBase();
  const s = funnelSummary(rows);
  console.log(`[funnel] total=${s.total} comSite=${s.comSite} comPhone=${s.comPhone}`);
  console.log(`[funnel] zap: ${s.comZap} leads (${s.zapsUnicos} únicos), hint=${s.comHint}, descoberta=${s.descobertaPct}% de ${s.comSite} com site`);
  console.log(`[funnel] wa_status: declared=${s.waStatus.declared} suspect=${s.waStatus.suspect} invalid=${s.waStatus.invalid} outro=${s.waStatus.outro}`);
  console.log(`[funnel] wa_source: maps=${s.waSource.maps} site=${s.waSource.site} instagram=${s.waSource.instagram} desconhecido=${s.waSource.desconhecido}`);
  console.log(`[funnel] evidência preenchida: ${s.comEvidence}/${s.comZap} (${s.evidencePct}%)`);
  console.log(`[funnel] sem site: ${s.semSites.total} (tierA=${s.semSites.tierA}, tierB=${s.semSites.tierB})`);
  const file = path.join('data', `funnel-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  console.log(`[funnel] salvo em ${file}`);
}

if (require.main === module) main().catch((e) => { console.error('[funnel]', e.message); process.exit(1); });
module.exports = { main };
```

- [ ] **Step 1: criar o arquivo** exatamente como acima; adicionar a linha do script npm (`"funnel": "node scripts/funnel.js",`) ao `package.json` — SOMENTE o objeto `scripts`; **a lista do `test` fica intocada**.
- [ ] **Step 2: gate rápido** — `node -e "require('./scripts/funnel').main().catch((e)=>{console.error(e.message);process.exit(1)})"` com `.env` real: deve 500 `supabase_not_configured` SEM env, e com env deve imprimir as 6 linhas do resumo + salvar `data/funnel-<hoje>.json` (base real: total 129, comSite 31). **Smoke manual — não commitar artefato `data/` gerado** (conferir `git status` antes do commit).
- [ ] **Step 3: commit** — `git add scripts/funnel.js package.json && git commit -m "feat(funnel): script read-only de funil da base + npm run funnel"`

---

## Plano de verificação final (o executor NÃO cria PR nem deploya)

1. **Suíte:** `npm run test` — verde, **zero falha**. Contagem de cases NOVOS desta fase: **7** (Task 2: 4 em `enrich-wa.test.js`; Task 3: 1 em `categories.test.js`; Task 4: 2 em `metrics.test.js`). Todos os cases pré-existentes intactos — se algo quebra nesses, REVISÃO: erros típicos são stub de `global.fetch` vazado (suíte sequencial no node:test: rodar 2x seguidas) ou edição acidental na fila estática do `enrich-wa` (diff da Task 2 é o ÚNICO permitido).
2. **Migration:** NENHUMA nesta fase (decisão L) — nada a aplicar; `0010`/`0011` já devem estar aplicadas da Fase 1 (conferir no Studio: `wa_attempts` default 0 e `wa_evidence` presentes).
3. **Run real do fallback:** `npm run enrich:wa 10` (faz fila estática — deve logar a linha de métricas da Fase 1 EXATAMENTE igual) e depois `npm run enrich:wa 10 3` → deve imporimir `[enrich:wa] fallback DOM: N lead(s) p/ render com Chromium`, abrir/fechar Chromium por lead (processo Chromium não restar no `tasklist`), e logar `[enrich:wa] fallback DOM concluído: ...`. Zap achado no DOM entra com `wa_evidence` = finalUrl de redirect (conferir no Studio).
4. **Funil:** `npm run funnel` → 6 linhas de resumo coerentes com a base real (total 129 hoje; comSite ~31) + `data/funnel-2026-10-19.json` válido e COM os 12 keys do shape (conferir com leitura do JSON). Rodar 2x não deve duplicar nem patchear nada (read-only; `git status` limpo fora do `data/` ignorado).
5. **Consultas:** `node -e "console.log(require('./src/utils/categories').termsOfCategory('tapecaria'))"` — lista com 7 termos; smoke da captura fica a cargo do usuário (uma run curta `npm run capture:tap` opcional — a spec NÃO manda rodar captura completa: budget/dedupe/relevance V2 são pré-existentes e o case do Task 3 já cobre o contrato).

## Fora de escopo (Fase 2)

- `analyzeSite`/`site-analyzer.js` — INTACTO (contrato v2 da Fase 1; o fallback lê o DOM em volta dele).
- Baileys/sessão real de WhatsApp (decisão pendente do usuário).
- Captura em massa de IG (ops), UI/painel/api (`web/`, `api/*`), captura V2 (scraper Maps já feita), novos nichos.
- Mudança em `defaultBudgetMinutes`/budgets do runner (NOTA em H: impacto da 2ª passada é contingenciado pelo cap de 60min).
- Migração nova (decisão L: nenhuma coluna nova). Reset manual de `wa_attempts`.
- topografia: termos novos (nicho já rico + assert que trava a lista).

## ARQUIVOS TOCADOS (lista completa)

| # | Arquivo | Ação |
| --- | --- | --- |
| 1 | `src/enrich/site-renderer.js` | criar (Task 1 — sem teste na suíte) |
| 2 | `scripts/enrich-wa.js` | modificar (Task 2 — arquivo inteiro; fallback DOM opt-in) |
| 3 | `src/tests/enrich-wa.test.js` | modificar (Task 2 — 4 cases novos; Fase 1 intacta) |
| 4 | `src/utils/categories.js` | modificar (Task 3 — terms de 4 categorias) |
| 5 | `src/tests/categories.test.js` | modificar (Task 3 — 1 case novo) |
| 6 | `src/utils/funnel.js` | criar (Task 4 — funnelSummary pura) |
| 7 | `src/tests/metrics.test.js` | modificar (Task 4 — 2 cases novos) |
| 8 | `scripts/funnel.js` | criar (Task 5 — script read-only) |
| 9 | `package.json` | modificar (Task 5 — script `funnel`; `test` intocado) |

