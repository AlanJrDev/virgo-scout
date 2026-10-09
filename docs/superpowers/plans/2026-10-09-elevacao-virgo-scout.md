# Elevação Virgo Scout — Enriquecimento, IA v2 e UX de Qualidade de Leads

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevar o sistema de leads a um patamar de garantia de qualidade: enriquecer cada lead com sinais reais (site, WhatsApp, Instagram, e-mail, tempo de existência, perfil reclamado, status de funcionamento), fazer a IA e a classificação usarem todos os sinais, e dar acesso rápido aos leads mais interessantes com filtros de oportunidade marcados na tela Base de Leads.

**Architecture:** O pipeline ganha uma camada de enriquecimento pós-captura em dois estágios: (1) o scraper do Maps extrai mais campos da página de detalhe (categoria, plus code, lat/lng, Place ID, "reclamado", horários, fechado, redes sociais); (2) um novo módulo `site-analyzer` visita o site de cada lead com `fetch` + regex (zero dependências) e extrai e-mail, Instagram, WhatsApp declarado e ano de fundação. A classificação vira multi-camada (categoria oficial > nome > origin > título do site), o score incorpora os novos sinais, e a UI da Base de Leads expõe tudo com filtros de oportunidade e a fila "Contatar hoje". Correções críticas do diagnóstico (copy enganosa, nav mobile morta, payload duplicado) entram primeiro.

**Tech Stack:** Node 24 (CommonJS), Playwright (Chromium full + `--headless=new`), Supabase via PostgREST direto (`sb_secret_`), Groq (`openai/gpt-oss-120b`), painel vanilla JS + GSAP, testes `node --test`.

**Spec:** Diagnósticos desta rodada (bateria DOM/UX Playwright + auditoria de código + mapa de campos capturáveis) — achados referenciados nos tasks como `[AUD #n]` (auditoria de código) e `[BAT Fn]` (bateria DOM).

## Global Constraints

- Zero novas dependências npm (análise de site é `fetch` + regex puro).
- Nenhuma chave/secredo no cliente; Groq/Supabase só no servidor.
- Senso numérico BR: normalizar antes de gravar no Supabase (rating vírgula, reviews com milhar) — lição do `[2026-10-03]` do brain.
- Playwright local: sempre `chromium.launch({ headless: false, args: ['--headless=new'] })` (headless-shell quebra com `spawn EFTYPE`).
- PostgREST limita 1000 linhas/req: leituras amplas usam `sbFetchAll` com `order=` estável.
- Commits curtos por task; `npm test` verde antes de cada commit.
- Ícones: SVG inline no padrão existente (stroke 1.8/2, `currentColor`), nunca emoji.
- `prefers-reduced-motion`: toda animação nova precisa de fallback estático.
- Idioma: pt-BR em toda a copy nova.

---

## FASE 0 — Correções críticas do diagnóstico

### Task 1: Copy honesta — score não é nota, e "qualificados" está invertido

**Files:**
- Modify: `web/app.js:196` (popup do mapa), `web/app.js:401` (gráfico Regiões), `web/app.js:725` (IA local "qualificados"), `web/app.js:708-719` (areaKeys hardcoded), `web/app.js:34` (saudação), `web/app.js:479` ("validados"), `web/app.js:90` (capTitle)

**Contexto (bugs `[AUD #21, #22, #23, #32, #25, #26, #27]`):** o popup do mapa e o gráfico de Regiões mostram `avgScore` (0–99) rotulado de "nota"; a IA local define "qualificados" como "site + telefone" quando o critério real é **telefone + sem site + nota ≥ 4,5**; `areaKeys` é hardcoded para advocacia (arquitetura responde errado); a saudação é hardcoded "Alan".

- [ ] **Step 1 — Popup do mapa (app.js:196):** trocar `' nota ' + r.avgScore` por `' potencial ' + r.avgScore`:
```js
return '<b>' + escapeHtml(r.label) + '</b><br><span>' + r.count + ' leads · ' + r.comSite + ' com site · ' +
  r.alta + ' alta (' + altaPct + '%) · potencial médio ' + r.avgScore + '</span>';
```
- [ ] **Step 2 — Gráfico de Regiões (app.js:401):** `sub: r.avgScore + ' potencial'` no lugar de `+ ' nota'`.
- [ ] **Step 3 — IA local (app.js:725):** trocar a frase por `'<strong>' + S.qualif + ' leads</strong> são oportunidades ideais (telefone + sem site + nota 4,5★+): ' + (S.pctQualif || 0) + '% da base.'`
- [ ] **Step 4 — areaKeys dinâmico (app.js:708):** substituir o objeto hardcoded por derivação de `areas` do payload:
```js
var areaHit = null;
var nq = norm(q);
(areas || []).forEach(function (a) {
  if (a.value && nq.indexOf(norm(a.label).split(' ')[0].slice(0, 7)) !== -1) areaHit = a.label;
});
```
- [ ] **Step 5 — Saudação (app.js:34):** deixar `'#greeting'` com `', ' + (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + '!'` e completar o nome em `loadMe()`: após `if (name) name.textContent = me.user;` adicionar:
```js
var g = document.getElementById('greeting');
if (g) g.textContent = g.textContent.replace(',', ', ' + String(me.user || '').split('@')[0].split(/[._-]/)[0] + '!');
```
- [ ] **Step 6 — "validados" (app.js:479) →** `'Telefone presente na base (não validado como WhatsApp)'`. **capTitle (app.js:90-91):** o título já é fixo por categoria; no `setCaptureUI` idle, prefixar "Captura — " em vez de "Captura ativa — ": em `syncCatUI` usar `'Captura — ' + (…)`.
- [ ] **Step 7 — Verificar + commit:** `node --check web/app.js`, rodar `npm run serve` e confirmar via probe que popup/gráfico não dizem "nota". Commit: `fix: copy honesta de score, qualificados e areaKeys por categoria`.

### Task 2: Nav mobile — Base de Leads inacessível `[BAT F6, crítico]`

**Files:**
- Modify: `web/index.html` (fim do `<main>`, antes dos scripts)
- Modify: `web/styles.css` (bloco `@media(max-width:720px)` + novas regras)
- Modify: `web/app.js` (`showView` — botões da bottom bar usam o mesmo `data-view`)

- [ ] **Step 1 — HTML (index.html, logo após `</main>`):**
```html
<nav class="viewbar" aria-label="Telas">
  <button type="button" class="viewbar-btn active" data-view="dashboard"><svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg><span>Visão Geral</span></button>
  <button type="button" class="viewbar-btn" data-view="leads"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/></svg><span>Base de Leads</span></button>
</nav>
```
- [ ] **Step 2 — CSS (styles.css):**
```css
.viewbar{display:none}
@media(max-width:720px){
  .viewbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:50;background:rgba(6,11,22,.92);backdrop-filter:blur(10px);border-top:1px solid var(--border-strong);padding:6px 10px calc(6px + env(safe-area-inset-bottom))}
  .viewbar-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;border:0;background:none;color:var(--muted);font-size:11px;font-weight:600;border-radius:10px}
  .viewbar-btn svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .viewbar-btn.active{color:var(--cyan)}
  .main{padding-bottom:76px}
}
```
- [ ] **Step 3 — app.js `showView`:** já cobre `[data-view]` por delegação (bottom bar entra de graça); adicionar ao final de `showView`: `document.querySelectorAll('.viewbar-btn').forEach(...)` espelhando o toggle `active` dos `.nav-item`.
- [ ] **Step 4 — Verificar:** probe mobile 390×844 → clicar `.viewbar-btn[data-view="leads"]` → `#viewLeads` visível, sem scroll horizontal. Commit: `fix: bottom bar de telas no mobile (F6)`.

### Task 3: Payload duplicado — 447 KB carregados 2× `[BAT F5]`

**Files:**
- Modify: `web/index.html:231` (remove `<script src="data/leads.js">`)
- Modify: `scripts/build-web-data.js` (gera `web/data/leads.js` como `window.VIRGO_DATA` — mantém, mas o HTML não o inclui mais)
- Modify: `web/app.js:819` (boot: carrega fallback dinamicamente apenas se `/api/leads` falhar)

- [ ] **Step 1 — index.html:** remover a linha `<script src="data/leads.js"></script>`.
- [ ] **Step 2 — app.js boot:**
```js
function bootOfflineFallback() {
  var s = document.createElement('script');
  s.src = 'data/leads.js';
  s.onerror = function () { boot(null); };
  s.onload = function () { boot(null); };
  document.head.appendChild(s);
}
```
e no `loadLeads()`: `.catch(function () { bootOfflineFallback(); })` e no `!r.ok` → idem (mantém redirect 401).
- [ ] **Step 3 — Verificar:** probe mede `performance.getEntriesByType('resource')` → `data/leads.js` só aparece quando a API falha; peso da página cai ~450 KB. Commit: `perf: fallback estático sob demanda (−447 KB)`.

### Task 4: Tabela — ordenação de filtros e telefone fixo

**Files:**
- Modify: `web/table.js:296-298` (ordenação dos selects), `web/table.js:50-53` (`fmtPhone`)

- [ ] **Step 1 — Ordenar por contagem (table.js:296):**
```js
var toItems = function (map) {
  return Object.keys(map).map(function (k) { return { value: k, label: k + ' · ' + map[k] }; })
    .sort(function (a, b) { return parseInt(b.label.split('·')[1], 10) - parseInt(a.label.split('·')[1], 10) || (a.value < b.value ? -1 : 1); });
};
```
- [ ] **Step 2 — fmtPhone 10 dígitos (table.js:50):**
```js
function fmtPhone(p) {
  var d = normPhone(String(p || '').replace(/\D/g, ''));
  if (d.length === 10) return d.slice(0, 2) + ' ' + d.slice(2, 6) + '-' + d.slice(6);
  if (d.length === 11) return d.slice(0, 2) + ' ' + d.slice(2, 7) + '-' + d.slice(7);
  return String(p || '');
}
```
- [ ] **Step 3 — Verificar + commit:** probe: telefone fixo (10 dígitos) agrupado 4-4; select de regiões ordenado por contagem desc. Commit: `fix: ordena filtros por contagem e formata fixo 4-4`.

### Task 5: Acessibilidade e estados — mapa, aria e erro global

**Files:**
- Modify: `web/index.html:164` (`#leadMap` role), `web/index.html:45` (cat-switch role), `web/styles.css:145` (atribuição do mapa `[BAT F1]`)
- Modify: `web/app.js:120` (guard `CaptureState` `[AUD #16]`), `web/app.js:158` (empty-state do mapa), `web/app.js:507` (banner de erro de API `[AUD #17]`)

- [ ] **Step 1 —** index.html: `#leadMap` → remover `role="img"`, manter `aria-label` num wrapper `<div class="map-wrap">`; `.cat-switch`: `role="tablist"` → `role="group"` e botões sem `role="tab"` (é filtro, não tabs).
- [ ] **Step 2 — styles.css:145:** `.maplibregl-ctrl-attrib{font-size:10px;color:var(--muted)!important}` + `.maplibregl-ctrl-attrib a{color:var(--cyan)!important}` (contraste sobre fundo escuro).
- [ ] **Step 3 — app.js:120:** `var dec = window.CaptureState ? window.CaptureState.decide(...) : { toast: true, reload: false };`
- [ ] **Step 4 — Erro de API (app.js `loadLeads`):** quando API falha e o fallback carrega, `toast('Sem conexão com a API — dados locais de fallback', 'warn')` + `.today` do card captura recebe classe `stale` (borda âmbar). Empty do mapa: se `!regions.length` → `host.innerHTML = '<div class="empty-box"><strong>Sem região para plotar</strong><p>Execute uma captura.</p></div>'`.
- [ ] **Step 5 —** Verificar (probe + `node --check`) e commit: `fix: a11y do mapa, guard do CaptureState e estado de erro de API`.

---

## FASE 1 — Enriquecimento de leads

### Task 6: Scraper v2 — novos campos da página de detalhe do Maps

**Files:**
- Modify: `src/scraper/mapsScraper.js:104-144` (evaluate + chamada normalize)
- Modify: `src/utils/leads.js:57-108` (normalizeLead + CSV)
- Test: `src/tests/backend.test.js` (adiciona casos normalizeLead)

**Interfaces (produz):** lead normalizado ganha: `category` (string|null), `plus_code`, `lat`/`lng` (number|null), `place_id`, `claimed` (true|false|null), `hours` (string|null), `closed` (bool), `photos` (int|null), `instagram`, `facebook` (string|null).

- [ ] **Step 1 — Testes primeiro (backend.test.js):**
```js
test('normalizeLead preserva novos campos do enriquecimento', () => {
  const l = normalizeLead({ name: 'X', category: 'Advogado trabalhista', plus_code: 'Q5J3+WC Brasília',
    lat: '-15.79', lng: '-47.88', place_id: '0x935a3b:0x1', claimed: false, hours: 'Aberto ⋅ Fecha 18:00',
    closed: false, photos: 12, instagram: 'https://instagram.com/xadv', facebook: null, phone: '', website: '', source: 'q' });
  assert.strictEqual(l.category, 'Advogado trabalhista');
  assert.strictEqual(l.lat, -15.79); assert.strictEqual(l.claimed, false);
  assert.strictEqual(l.photos, 12); assert.strictEqual(l.instagram, 'https://instagram.com/xadv');
});
```
- [ ] **Step 2 — Rodar:** `npm test` → novo caso FALHA (campos não existem em normalizeLead).
- [ ] **Step 3 — normalizeLead (leads.js:57):** adicionar ao retorno:
```js
category: String(raw.category || '').trim() || null,
plus_code: String(raw.plus_code || '').trim() || null,
lat: Number.isFinite(parseFloat(raw.lat)) ? parseFloat(raw.lat) : null,
lng: Number.isFinite(parseFloat(raw.lng)) ? parseFloat(raw.lng) : null,
place_id: String(raw.place_id || '').trim() || null,
claimed: raw.claimed === true || raw.claimed === false ? raw.claimed : null,
hours: String(raw.hours || '').trim() || null,
closed: !!raw.closed,
photos: Number.isFinite(parseInt(raw.photos, 10)) ? parseInt(raw.photos, 10) : null,
instagram: String(raw.instagram || '').trim() || null,
facebook: String(raw.facebook || '').trim() || null,
```
e colunas CSV: estender `cols`/header com `category;plus_code;lat;lng;place_id;claimed;hours;closed;photos;instagram;facebook`.
- [ ] **Step 4 — Scraper evaluate (mapsScraper.js:104):** dentro do `page.evaluate`, após o bloco do rating:
```js
// categoria: botão após o h1 (fallback: jsaction category)
let category = '';
const catBtn = document.querySelector('button.DkEaL') || document.querySelector('button[jsaction*="category"]');
if (catBtn) category = catBtn.innerText.trim();
// plus code: mesmo padrão do endereço
let plus_code = '';
const olocBtn = document.querySelector('button[data-item-id="oloc"]');
if (olocBtn) plus_code = (olocBtn.querySelector('.Io6YTe')?.innerText || olocBtn.innerText).trim();
// redes sociais: âncoras externas além do authority
let instagram = '', facebook = '';
document.querySelectorAll('a[data-item-id^="http"], a[href*="instagram.com"], a[href*="facebook.com"]').forEach((a) => {
  const h = a.getAttribute('href') || '';
  if (/instagram\.com\//.test(h) && !instagram) instagram = h;
  if (/facebook\.com\//.test(h) && !facebook) facebook = h;
});
// texto do painel para sinais
const panel = bodyText;
let claimed = null;
if (/reivindicar este perfil|reivindique este perfil|claim this business/i.test(panel)) claimed = false;
else if (/perfil reclamado|perfil propriedade do titular/i.test(panel)) claimed = true;
const closed = /fechado (definitivamente|permanentemente)|encerrado/i.test(panel);
let hours = '';
const hm = panel.match(/aberto[^\n]{0,30}fecha\s*(\d{1,2}:\d{2})/i);
if (hm) hours = 'Aberto ⋅ Fecha ' + hm[1];
let photos = null;
const gal = document.querySelector('button[aria-label*="Fotos"], button[aria-label*="photos" i]');
if (gal) { const pm = (gal.getAttribute('aria-label') || '').match(/(\d+)/); if (pm) photos = parseInt(pm[1], 10); }
```
O retorno passa a incluir os campos; a URL do painel fornece lat/lng/place_id — no evaluate use `location.href`:
```js
const mUrl = (location.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || []);
const pId = (location.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/) || [])[1] || '';
```
retornar `lat: mUrl[1] || '', lng: mUrl[2] || '', place_id: pId`. No `enrichWithDetails`, propagar `detail.*` ao `normalizeLead({...})` (todos os novos campos com `|| base.<campo>` ausente → passa `detail.category || ''` etc.).
- [ ] **Step 5 — Rodar `npm test`** (verde) + captura smoke: `QUERIES="advogado Águas Claras DF" MAX_DETAILS=3 MAX_SCROLLS=8 npm run capture:quick` → inspecionar `data/*.json` com probe node (campos presentes nos 3 primeiros). Commit: `feat: scraper captura categoria, plus code, geo, place_id, claimed, horas, fotos e redes`.

### Task 7: Migration 0004 + sync dos novos campos

**Files:**
- Create: `supabase/migrations/0004_leads_enrichment.sql`
- Modify: `scripts/sync-supabase.js:64-79` (`toRow`), `scripts/repair-data.js` (mesma toRow — compartilha)

**Interfaces (produz):** colunas `leads.category, plus_code, lat, lng, place_id, claimed, hours, photos, closed, instagram, facebook, email, whatsapp_hint, since_year, site_title, enriched_at` (site-analyzer preenche as últimas na Task 8).

- [ ] **Step 1 — Migration 0004_leads_enrichment.sql:**
```sql
-- Virgo Scout 0004: enriquecimento (Maps detalhe + site analyzer)
alter table leads add column if not exists category text;
alter table leads add column if not exists plus_code text;
alter table leads add column if not exists lat numeric;
alter table leads add column if not exists lng numeric;
alter table leads add column if not exists place_id text;
alter table leads add column if not exists claimed boolean;
alter table leads add column if not exists hours text;
alter table leads add column if not exists photos int;
alter table leads add column if not exists closed boolean;
alter table leads add column if not exists instagram text;
alter table leads add column if not exists facebook text;
alter table leads add column if not exists email text;
alter table leads add column if not exists whatsapp_hint boolean;
alter table leads add column if not exists since_year int;
alter table leads add column if not exists site_title text;
alter table leads add column if not exists enriched_at timestamptz;
create index if not exists leads_unenriched on leads (enriched_at) where enriched_at is null;
```
- [ ] **Step 2 — toRow (sync-supabase.js:64):** acrescentar ao objeto retornado:
```js
category: l.category || null, plus_code: l.plus_code || null,
lat: num(l.lat), lng: num(l.lng), place_id: l.place_id || null,
claimed: typeof l.claimed === 'boolean' ? l.claimed : null,
hours: l.hours || null, photos: int(l.photos),
closed: l.closed === true, instagram: l.instagram || null, facebook: l.facebook || null,
```
- [ ] **Step 3 — Teste sync (sync.test.js):** estender o caso existente `toRow normaliza` para cobrir `category/lat/claimed/photos/closed` com literais BR (`lat: '-15,79'` → `num` resolve vírgula).
- [ ] **Step 4 — `npm test`** verde; usuário aplica 0004 no SQL Editor; validar colunas com `sbFetch('leads?select=category,place_id&limit=1')`. Commit: `feat: schema + sync do enriquecimento (0004)`.

### Task 8: Site analyzer — e-mail, Instagram, WhatsApp e ano de fundação

**Files:**
- Create: `src/enrich/site-analyzer.js`
- Test: `src/tests/site-analyzer.test.js`

**Interfaces (produz):** `async function analyzeSite(url, { fetchImpl, timeoutMs = 6000 })` → `{ ok, status, email, instagram, facebook, whatsapp, since_year, title }` — `instagram`/`facebook` são handles (`'@xadv'` ou URL), `whatsapp` é o número de dígitos do wa.me ou null, `since_year` int|null.

- [ ] **Step 1 — Testes (site-analyzer.test.js)** com HTML fixture inline:
```js
const { analyzeSite, extractSignals } = require('../enrich/site-analyzer');
const HTML = `<html><head><title>Souza Advocacia Trabalhista — Brasília</title></head>
  <body><a href="mailto:contato@souzadv.com.br">contato</a>
  <a href="https://instagram.com/souzadv">IG</a>
  <a href="https://wa.me/5561999990000">Zap</a>
  <footer>© 2013 Souza Advocacia. Todos os direitos reservados.</footer></body></html>`;

test('extrai email, instagram, whatsapp e ano de fundação', async () => {
  const s = await analyzeSite('https://souzadv.com.br', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => HTML }) });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.email, 'contato@souzadv.com.br');
  assert.ok(s.instagram.includes('souzadv'));
  assert.strictEqual(s.whatsapp, '5561999990000');
  assert.strictEqual(s.since_year, 2013);
  assert.ok(s.title.includes('Trabalhista'));
});
test('url sem esquema ganha https; erro de rede vira ok:false', async () => {
  const bad = await analyzeSite('souzadv.com.br', { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.email, null);
});
test('descarta emails falsos-positivos comuns', () => {
  const s = extractSignals('<a href="mailto:sentry@example.com">x</a> @fontes png@2x.png');
  assert.strictEqual(s.email, null);
});
```
- [ ] **Step 2 — Rodar:** `node --test src/tests/site-analyzer.test.js` → FALHA (módulo não existe).
- [ ] **Step 3 — Implementação (src/enrich/site-analyzer.js):**
```js
// Análise de sites de leads — fetch + regex, zero dependências.
const BAD_EMAIL = /(sentry|example|wixpress|godaddy|@2x|\.png|\.jpg|\.webp|no-?reply|domain\.com)/i;

function extractSignals(html) {
  const text = String(html || '').slice(0, 400000);
  let email = null;
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    if (!BAD_EMAIL.test(m[0])) { email = m[0].toLowerCase(); break; }
  }
  let instagram = null, facebook = null, whatsapp = null;
  for (const m of text.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,40})/g)) {
    if (!/^(p|reel|reels|explore|stories|accounts)/i.test(m[1])) { instagram = m[1]; break; }
  }
  for (const m of text.matchAll(/facebook\.com\/([A-Za-z0-9.-]{2,60})/g)) {
    if (!/^(sharer|share|tr|plugins|policies)/i.test(m[1])) { facebook = m[1]; break; }
  }
  const wa = text.match(/wa\.me\/(\+?\d{6,15})/) || text.match(/api\.whatsapp\.com[^"']*[?&]phone=(\d{6,15})/);
  if (wa) whatsapp = wa[1].replace('+', '');
  let since_year = null;
  const cy = text.match(/(?:©|&copy;|copyright)[^0-9<]{0,24}((?:19|20)\d{2})/i) || text.match(/desde\s+((?:19|20)\d{2})/i) || text.match(/fundad[ao]\s+em\s+((?:19|20)\d{2})/i);
  if (cy) since_year = parseInt(cy[1], 10);
  const title = (text.match(/<title[^>]*>([^<]{0,140})/i) || [])[1]?.trim() || null;
  return { email, instagram, facebook, whatsapp, since_year, title };
}

async function analyzeSite(rawUrl, { fetchImpl, timeoutMs = 6000 } = {}) {
  const f = fetchImpl || fetch;
  let url = String(rawUrl || '').trim();
  if (!url) return { ok: false, status: 0, email: null, instagram: null, facebook: null, whatsapp: null, since_year: null, title: null };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const res = await f(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', Accept: 'text/html' } });
    if (!res.ok) return { ok: false, status: res.status, ...empty() };
    const html = await res.text();
    return { ok: true, status: res.status, ...extractSignals(html) };
  } catch { return { ok: false, status: 0, ...empty() }; }
}
function empty() { return { email: null, instagram: null, facebook: null, whatsapp: null, since_year: null, title: null }; }
module.exports = { analyzeSite, extractSignals };
```
- [ ] **Step 4 — Rodar testes** → PASS. Adicionar `src/tests/site-analyzer.test.js` ao script `test` do package.json. Commit: `feat: site-analyzer extrai email, instagram, whatsapp e ano de fundação`.

### Task 9: `npm run enrich` — batch resumável de análise de sites

**Files:**
- Create: `scripts/enrich-leads.js`
- Modify: `package.json` (script `"enrich": "node scripts/enrich-leads.js"`)

**Interfaces (consome):** `analyzeSite(url)` da Task 8; `sbFetch`/`sbFetchAll` de `src/utils/sb.js`. **Produz:** linhas `leads` com `email, instagram, facebook, whatsapp_hint (bool = whatsapp extraído do site), since_year, site_title, enriched_at`.

- [ ] **Step 1 — Script (scripts/enrich-leads.js):**
```js
/* Enriquece leads COM site: analisa o site e grava sinais no Supabase.
   npm run enrich [limite]  — resumível (pula leads com enriched_at). */
require('dotenv').config();
const { sbFetchAll, sbFetch } = require('../src/utils/sb');
const { analyzeSite } = require('../src/enrich/site-analyzer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const rows = await sbFetchAll(`leads?select=id,website&website=not.is.null&enriched_at=is.null&order=id&limit=${limit}`);
  console.log(`[enrich] ${rows.length} leads com site a analisar`);
  let ok = 0, fail = 0;
  for (const r of rows) {
    const s = await analyzeSite(r.website);
    const patch = { enriched_at: new Date().toISOString() };
    if (s.email) patch.email = s.email;
    if (s.instagram) patch.instagram = s.instagram;
    if (s.facebook) patch.facebook = s.facebook;
    if (s.whatsapp) { patch.whatsapp_hint = true; }
    if (s.since_year) patch.since_year = s.since_year;
    if (s.title) patch.site_title = s.title;
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: patch });
      ok++; console.log(`[enrich] ok ${r.website.slice(0, 40)} -> ${JSON.stringify({ e: s.email, ig: s.instagram, wa: !!s.whatsapp, yr: s.since_year })}`);
    } catch (e) { fail++; console.error(`[enrich] erro ${r.id}: ${e.message}`); }
    await sleep(400);
  }
  console.log(`[enrich] concluído: ${ok} ok, ${fail} falhas`);
}
main().catch((e) => { console.error('[enrich]', e.message); process.exit(1); });
```
- [ ] **Step 2 — package.json:** adicionar `"enrich": "node scripts/enrich-leads.js"`.
- [ ] **Step 3 — Execução real controlada:** `npm run enrich 5` → confirmar PATCHes no banco (`select email, instagram, since_year from leads where enriched_at is not null limit 5`). Commit: `feat: npm run enrich — análise de sites em batch resumável`.

### Task 10: Re-enriquecimento dos leads sem detalhe (refill)

**Files:**
- Create: `scripts/capture-refill.js`
- Modify: `src/scraper/mapsScraper.js` (exporta `enrichOneByQuery`)
- Modify: `package.json` (`"capture:refill": "node scripts/capture-refill.js"`)

**Contexto:** 82% da base (1.105 advogados) não passou pela página de detalhe (MAX_DETAILS=80). O refill busca cada lead por `nome + endereço/cidade` no Maps, abre o primeiro card e extrai o detalhe completo (Task 6), gravando por cima via upsert.

- [ ] **Step 1 — mapsScraper exporta** `enrichOneByQuery(page, query)` (reusa `scrapeQuery` com `maxDetails: 1`, retorna `leads[0]`).
- [ ] **Step 2 — capture-refill.js:**
```js
/* Refill: re-processa leads sem telefone/canal via busca nominal no Maps.
   npm run capture:refill [limite] — resumível (só pega lead sem phone/email/instagram). */
require('dotenv').config();
const { launchBrowser, enrichOneByQuery } = require('../src/scraper/mapsScraper');
const { sbFetchAll, sbFetch } = require('../src/utils/sb');
const { toRow } = require('./sync-supabase');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '40', 10);
  const rows = await sbFetchAll(`leads?select=id,name,address,website,source&and=(phone.is.null,email.is.null,instagram.is.null)&order=id&limit=${limit}`);
  if (!rows.length) { console.log('[refill] nenhum lead pendente'); return; }
  const { browser, page } = await launchBrowser({ headless: true });
  let saved = 0;
  try {
    for (const r of rows) {
      const q = `${r.name} ${String(r.address || '').split(',').slice(-1)[0] || 'Brasília DF'}`;
      try {
        const lead = await enrichOneByQuery(page, q);
        if (!lead || !lead.name) continue;
        if (lead.phone || lead.website) {
          const row = toRow({ ...r, ...lead, source: r.source });
          await sbFetch('leads?on_conflict=id', { method: 'POST', body: [row], headers: { Prefer: 'resolution=merge-duplicates' } });
          saved++;
          console.log(`[refill] ${r.name} -> fone=${lead.phone ? 'sim' : 'não'} site=${lead.website ? 'sim' : 'não'}`);
        }
      } catch (e) { console.error(`[refill] falha "${q}": ${e.message}`); }
      await sleep(2500);
    }
  } finally { await browser.close().catch(() => {}); }
  console.log(`[refill] ${saved}/${rows.length} leads atualizados`);
}
main().catch((e) => { console.error('[refill]', e.message); process.exit(1); });
```
- [ ] **Step 3 — Smoke real:** `npm run capture:refill 3` → 3 leads ganham phone/site no banco. (Rodada completa de 1.105 fica como operação do usuário, em lotes.) Commit: `feat: capture:refill — re-enriquecimento nominal dos leads sem canal`.

---

## FASE 2 — Classificação e IA v2

### Task 11: Classificador v2 — quatro camadas de sinal

**Files:**
- Modify: `src/utils/classify.js:53-65` (`classifyLead`)
- Test: `src/tests/classify.test.js` (novos casos)

**Interfaces (consome):** `lead.category` (oficial do Maps, Task 6), `lead.site_title` (Task 8). **Produz:** mesma `{ area, confidence }` com nova ordem de precedência: **categoria oficial (0.95) > nome (0.9) > origin (0.7) > título do site (0.6) > fallback (0.3)**.

- [ ] **Step 1 — Testes:**
```js
test('categoria oficial do Maps ganha do nome', () => {
  const r = classifyLead({ name: 'Melo & Irmãos', category: 'Advogado trabalhista' });
  assert.deepStrictEqual(r, { area: 'Trabalhista', confidence: 0.95 });
});
test('título do site é a quarta camada', () => {
  const r = classifyLead({ name: 'Studio A', origin: '', site_title: 'Topografia e Agrimensura no DF' });
  assert.strictEqual(r.area, 'Topografia');
  assert.strictEqual(r.confidence, 0.6);
});
test('lead fechado não vira área especial', () => {
  const r = classifyLead({ name: 'Advogado criminal X', closed: true });
  assert.strictEqual(r.area, 'Criminal'); // classificação segue; score é quem desqualifica
});
```
- [ ] **Step 2 — Implementação:** em `classifyLead`, antes da camada do nome:
```js
const catText = norm(lead.category);
if (catText) {
  for (const area of areas) {
    if (rules[area].some((kw) => catText.includes(kw))) return { area, confidence: 0.95 };
  }
}
```
e após a camada de origin, antes do fallback:
```js
const titleText = norm(lead.site_title);
if (titleText) {
  for (const area of areas) {
    if (rules[area].some((kw) => titleText.includes(kw))) return { area, confidence: 0.6 };
  }
}
```
- [ ] **Step 3 —** `npm test` verde. Commit: `feat: classificador v2 — categoria oficial, nome, origem e título do site`.

### Task 12: Score v2 — novos sinais e desqualificação honesta

**Files:**
- Modify: `src/utils/metrics.js:100-113` (`scoreOf` + `badgeOf`)
- Test: `src/tests/metrics.test.js` (novos casos)

**Interfaces:** lead enriquecido (Tasks 6/8). Score 0–99: **sem canal (sem fone E email E instagram) → 0 / badge `Incontatável`**; `closed` → 0 / badge `Fechado` (novo, chip cinza). Pesos: base com canal 20; fone +15; e-mail +8; Instagram +4; rating×6 (máx 30); log10(reviews+1)×4; sem site +15; site antigo (since_year ≤ ano−5) +4; perfil não reclamado +4; cap 99.

- [ ] **Step 1 — Testes:**
```js
test('lead sem canal algum é Incontatável mesmo com sinais', () => {
  assert.strictEqual(scoreOf({ rating: 4.9, reviews: 300, instagram: null, email: null }), 0);
  const p = buildPayload([{ name: 'Só IG', instagram: 'xadv', rating: 4.8, reviews: 20 }], { dataDir: TMP, category: 'advogados' });
  assert.notStrictEqual(p.pool[0].badge, 'Incontatável');
});
test('lead fechado desqualifica', () => {
  const p = buildPayload([{ name: 'Fechado ME', phone: '61999990000', closed: true }], { dataDir: TMP, category: 'advogados' });
  assert.strictEqual(p.pool[0].badge, 'Fechado'); assert.strictEqual(p.pool[0].score, 0);
});
test('sinais novos somam: email + instagram + não reclamado', () => {
  const base = { phone: '61999990000', rating: 4.0, reviews: 10, website: 'https://x.com' };
  const com = scoreOf({ ...base, email: 'a@b.c', instagram: 'x', claimed: false });
  assert.ok(com > scoreOf(base));
});
```
- [ ] **Step 2 — Implementação (metrics.js):**
```js
function hasChannel(l) { return /\d{8,}/.test(l.phone || '') || !!l.email || !!l.instagram; }
function scoreOf(l) {
  if (l.closed) return 0;
  if (!hasChannel(l)) return 0;
  let s = 20;
  if (/\d{8,}/.test(l.phone || '')) s += 15;
  if (l.email) s += 8;
  if (l.instagram) s += 4;
  s += Math.max(0, l.rating || 0) * 6;
  s += Math.log10((l.reviews || 0) + 1) * 4;
  if (!l.website) s += 15;
  else if (l.since_year && new Date().getFullYear() - l.since_year >= 5) s += 4;
  if (l.claimed === false) s += 4;
  return Math.max(0, Math.min(99, Math.round(s)));
}
```
`buildTop`: badge passa a `l.closed ? 'Fechado' : (hasChannel(l) ? badgeOf(l.score) : 'Incontatável')` — e `wa` continua por telefone; quando só houver e-mail/instagram, `wa` null mas o lead deixa de ser incontatável.
- [ ] **Step 3 — CSS:** `.badge.Fechado{background:rgba(100,116,139,.12);color:#94a3b8;border:1px solid rgba(100,116,139,.25)}`.
- [ ] **Step 4 —** `npm test` verde. Commit: `feat: score v2 — canais, fechados, senioridade e perfil não reclamado`.

### Task 13: IA v2 — contexto enriquecido e respostas por sinal

**Files:**
- Modify: `scripts/groq.js` (`formatContext` + prompt do sistema)
- Modify: `src/utils/metrics.js` (`buildStats` soma os novos sinais)
- Modify: `web/app.js` (`aiAnswer` local — respostas sobre e-mail/instagram/tempo)
- Test: `src/tests/groq.test.js` (formatContext)

- [ ] **Step 1 — buildStats (metrics.js):** adicionar `comEmail, comInstagram, comZapSite (whatsapp_hint), naoReclamados, desdeAntigo (since_year ≥ 5 anos)`.
- [ ] **Step 2 — formatContext (groq.js):** incluir as linhas novas:
```
E-mail direto: N · Instagram: N · WhatsApp no site: N
Perfis não reclamados (Maps): N · Negócios de 5+ anos: N
```
e no system prompt: "Responda como analista de pré-venda da Virgo Tech (venda de sites/LPs). Priorize leads com telefone, sem site próprio e boa reputação."
- [ ] **Step 3 — aiAnswer local (app.js):** novas regras keyword: `email|e-mail` → `S.comEmail`; `instagram|insta` → `S.comInstagram`; `desde|anos|antigo` → `S.desdeAntigo`; `reclam` → `S.naoReclamados`.
- [ ] **Step 4 — Teste groq.test.js:** caso `formatContext` inclui "E-mail direto" quando stats.comEmail > 0. `npm test` verde. Commit: `feat: IA v2 — contexto com e-mail, instagram, senioridade e prioridade de pré-venda`.

---

## FASE 3 — UX: Base de Leads e acesso rápido

### Task 14: Payload UI — novos campos na pool

**Files:**
- Modify: `src/utils/metrics.js:139-160` (`buildTop` output)
- Test: `src/tests/metrics.test.js`

- [ ] **Step 1 — buildTop output:** adicionar ao objeto: `email: l.email || null, instagram: l.instagram || null, whatsapp_hint: l.whatsapp_hint === true, since_year: l.since_year || null, category: l.category || null, closed: l.closed === true, claimed: l.claimed === null ? null : l.claimed === true`.
- [ ] **Step 2 — Teste:** pool de 1 lead enriquecido expõe `email/instagram/since_year` verídicos. Commit junto com a Task 15.

### Task 15: Base de Leads — coluna Canais, chips de oportunidade e filtro de status

**Files:**
- Modify: `web/index.html` (tools da tabela: chip "Sem site (oportunidade)", select de status)
- Modify: `web/table.js` (COLS, células, matches, sortVal)
- Modify: `web/styles.css` (chip oportunidade, célula canais)
- Test: manual via probe + shot-ui

**Interfaces (consome):** pool com campos da Task 14.

- [ ] **Step 1 — index.html tools:** substituir o check "Com site" por três chips:
```html
<label class="tbl-check opp" id="tblNoSiteBox"><input type="checkbox" id="tblNoSite"><span>Sem site · oportunidade</span></label>
<label class="tbl-check" id="tblPhoneBox"><input type="checkbox" id="tblHasPhone"><span>Com telefone</span></label>
<select class="tbl-select" id="tblStatus" aria-label="Status de contato">
  <option value="">Todos os status</option><option value="novo">Novos</option><option value="contatado">Contatados</option>
</select>
```
- [ ] **Step 2 — COLS (table.js):** coluna `site` vira `channels` com label `Canais` (ícones: site, Instagram, e-mail, WhatsApp — cada um `<a>` com `aria-label`, cores: site ciano, IG `#E1306C`, e-mail verde, WA `#25D366`); nova coluna `since` `Desde` (ano, `optional:true` — só renderiza se `state.rows.some(l => l.since_year)`).
- [ ] **Step 3 — matches (table.js):** `state.noSite` → `!hasSite(l)`; `state.status` → `(l.status || 'novo') === state.status`; `state.phone` passa a exigir canal: `hasChannel(l)` (fone, e-mail OU instagram).
- [ ] **Step 4 — CSS:** `.tbl-check.opp{border-color:rgba(52,211,153,.45);color:var(--green)}` e `.tbl-check.opp.on{background:rgba(52,211,153,.12)}`; ícones de canal `.ch-ico{width:17px;height:17px}` com cor por `data-ch`.
- [ ] **Step 5 — Probe de verificação:** filtro "Sem site" + "Com telefone" → contagem = `stats.qualif`-ish; chip fica verde quando ativo; ordenação por Canais ordena por nº de canais. Commit: `feat: base com coluna Canais, chip sem-site e filtro de status`.

### Task 16: Fila "Contatar hoje" — acesso rápido aos melhores

**Files:**
- Modify: `web/index.html` (card no topo do `#viewLeads`, antes da tabela)
- Modify: `web/app.js` (computa fila do pool + render + marca contato)
- Modify: `web/styles.css` (estilo da fila)

**Interfaces (consome):** pool com `status, score, wa, email` (Tasks 12/14). **Regra:** contáveis (`score > 0`, `closed !== true`) com `status === 'novo'`, ordenados por score desc, top 10; prioriza `sem site` na ordenação secundária.

- [ ] **Step 1 — HTML (index.html, dentro de #viewLeads antes de quality-row):**
```html
<div class="card queue-card" id="queueCard" hidden>
  <div class="card-head"><span class="head-ico"><svg viewBox="0 0 24 24"><path d="M12 3v10"/><path d="m8 9 4-4 4 4"/><path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/></svg></span>
    <h2>Contatar hoje</h2><span class="tbl-summary" id="queueSub"></span></div>
  <ul class="queue-list" id="queueList"></ul>
</div>
```
- [ ] **Step 2 — app.js (dentro de `render`, após VS_TABLE.render):**
```js
function renderQueue() {
  var pool = (currentPayload && currentPayload.pool) || [];
  var queue = pool.filter(function (l) { return l.score > 0 && !l.closed && (l.status || 'novo') === 'novo'; })
    .sort(function (a, b) { return (b.site ? 0 : 1) - (a.site ? 0 : 1) || b.score - a.score; })
    .slice(0, 10);
  var card = document.getElementById('queueCard');
  if (!card) return;
  card.hidden = !queue.length;
  document.getElementById('queueSub').textContent = queue.length + ' leads contatáveis ainda não abordados';
  document.getElementById('queueList').innerHTML = queue.map(function (l) {
    var why = [];
    if (!l.site) why.push('sem site');
    if (l.email) why.push('e-mail');
    if (l.instagram) why.push('Instagram');
    if (l.since_year) why.push('desde ' + l.since_year);
    return '<li data-id="' + escapeHtml(l.id || '') + '">' +
      '<div class="q-info"><strong>' + escapeHtml(l.name) + '</strong><span>' + escapeHtml((l.area || 'Geral') + (why.length ? ' · ' + why.join(' · ') : '')) + '</span></div>' +
      ring(l.score) + (l.wa ? waBtn(l) : '') + '</li>';
  }).join('');
  drawRings(document.getElementById('queueList'));
}
```
(chamar `renderQueue()` no fim do `render`; `waBtn` já marca contato via `data-contact-id` — propagar `data-contact-id` igual à Task 15 e remover o item da fila ao marcar: no handler de marcação, `li.remove()` + atualizar `queueSub`).
- [ ] **Step 3 — CSS:**
```css
.queue-list{list-style:none;display:flex;flex-direction:column}
.queue-list li{display:flex;align-items:center;gap:12px;padding:10px 2px;border-top:1px solid var(--border)}
.queue-list li:first-child{border-top:0}
.q-info{flex:1;min-width:0}
.q-info strong{display:block;font-size:13px}
.q-info span{font-size:11.5px;color:var(--faint)}
```
- [ ] **Step 4 — Verificar:** probe logado → fila com ≤10 itens, clique WA remove o item e o contador cai. Commit: `feat: fila Contatar hoje — top 10 contatáveis não abordados`.

### Task 17: Dashboard — KPI de oportunidade e nav "Capturar Leads" funcional

**Files:**
- Modify: `web/index.html:92` (KPI 4), `web/index.html:22` (nav), `web/app.js` (nav handler)
- [ ] **Step 1 —** KPI 4 passa a `Oportunidades Ideais` (verde→ já é green icon; sub da Task 1 permanece correto: "telefone + sem site + nota 4,5").
- [ ] **Step 2 — Nav "Capturar Leads":** dar `data-view="dashboard"` + `data-scroll="#captureCard"`; no handler de `[data-view]`, após `showView`, se `t.dataset.scroll` → `document.querySelector(sel)?.scrollIntoView({behavior:'smooth'})`. Adicionar `id="captureCard"` ao card de captura.
- [ ] **Step 3 — Dot de notificações `[AUD #5]`:** remover o `<i class="dot">` (não há notificações reais; o sino continua como botão estático até existirem).
- [ ] **Step 4 —** Probe + commit: `feat: KPI Oportunidades Ideais, nav captura funcional, dot falso removido`.

---

## FASE 4 — Efeitos e transições

### Task 18: Transição entre telas e micro-interações da tabela

**Files:**
- Modify: `web/app.js` (`showView`), `web/table.js` (`renderRows`)

- [ ] **Step 1 — showView com GSAP (respeitando reduced motion):**
```js
function animateViewIn(viewEl) {
  if (!hasGsap || !viewEl) return;
  var kids = viewEl.children;
  window.gsap.fromTo(kids, { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.32, stagger: 0.05, ease: 'expo.out', overwrite: true });
}
```
chamar com o `<section class="view">` que ficou visível (dashboard: `#viewDashboard`, leads: `#viewLeads`).
- [ ] **Step 2 — Tabela:** ao trocar filtro/página, `gsap.fromTo` nas `<tr>` novas com `stagger: 0.012, duration: 0.18` (guard: só se `hasGsap` e não reduced-motion; sem GSAP = instantâneo como hoje).
- [ ] **Step 3 — Verificar:** reduced-motion probe → sem transform aplicado; normal → entrada suave. Commit: `feat: transição de telas e stagger da tabela (respeita reduced motion)`.

---

## FASE 5 — QA final

### Task 19: Bateria completa de garantia de qualidade

**Files:**
- Modify: `scripts/shot-ui.js` (screenshots da fila, chips, coluna Canais)
- Test: todos os anteriores
- [ ] **Step 1 — `npm test`** inteiro verde (inclui site-analyzer, classify v2, score v2, sync, contact).
- [ ] **Step 2 — Bateria probe (subagent general):** login mobile+desktop, contrast scan (target: 0 pares <4.5 na Base), fila funcional (clique marca + remove), filtros novos contam certo, nav mobile abre Base, sem h-scroll, payload sem leads.js duplicado.
- [ ] **Step 3 — Detector impeccable** em todos os arquivos web alterados; comparar com baseline (git show HEAD) — corrigir apenas findings novos.
- [ ] **Step 4 — Captura real de validação:** `npm run capture:quick` (3 detalhes) → novos campos no JSON; `npm run enrich 5` → sinais no banco; `npm run capture:refill 3` → leads antes sem fone ganham canal.
- [ ] **Step 5 — Commit final:** `chore: bateria QA da rodada de elevação`.

---

## Riscos e expectativas honestas

- **E-mail/Instagram/WhatsApp/ano** só existem para leads **com site** (~190 hoje; cresce com `capture:refill` e novas capturas que passam 100% pelo detalhe). Sem site = sem esses sinais; o lead continua válido por telefone.
- **WhatsApp do site é link declarado** (`wa.me` no site) — não é verificação de número. O hint diz "declara WhatsApp no site".
- **Ano de fundação é best-effort** (copyright/desde/fundada em). Sites sem essas pistas ficam `null`.
- **Seletores do Maps giram** (lição `[2026-10-02]`): todo seletor novo tem 2 fallbacks (seletor secundário + regex no innerText). Se um campo novo vier 100% vazio numa captura, o responsável é o seletor — ajustar em `mapsScraper.js` antes de culpar o fluxo.
- **refill completo** (1.105 leads × ~11 s) ≈ 3,5 h de navegador local rodando — operar em lotes de 50-100.
- **Groq free tier**: rate limit — contexto por pergunta continua compacto.
