# Qualificação Multifonte — Backbone (motor + fontes + feedback) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enriquecer cada lead com sinais de intenção/capacidade (site, Ads, Instagram), rodá-los por um motor de qualificação puro que produz `fit`/`icp`/`reasons`/`why_now`, persistir o resultado e instrumentar o desfecho — para priorizar quem compra site/sistema.

**Architecture:** Motor puro `src/qualify` (pesos versionados) sobre colunas enriquecidas em `leads`. Enrichers resumíveis e não-degradantes (`enrich-audit`, `enrich-ads`, `enrich-ig`) gravam sinais; `metrics.js` calcula no build; `scripts/qualify.js` persiste `fit/icp/reach/reasons/why_now` para filtro em SQL. Fontes: HTTP/Playwright, zero dependência npm nova.

**Tech Stack:** Node 24 (CommonJS), `fetch` + Playwright (já existente), Supabase via PostgREST direto, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-16-qualificacao-multifonte-design.md`

## Global Constraints

- Zero novas dependências npm (só `fetch`/Playwright já instalados).
- Enrichers **não-degradantes**: PATCH apenas com campos não-vazios; falha → `null`/`unknown`, nunca grava lixo (padrão de `scripts/enrich-leads.js`).
- Enrichers **resumíveis** por coluna `*_checked_at`; batch com `limit` por CLI e `sleep` entre chamadas.
- Migrations rodam no **SQL Editor** (não via PostgREST) — regra do projeto; `alter table ... add column if not exists`.
- PostgREST limita 1000 linhas/req: leituras amplas usam `sbFetchAll` com `order=` estável.
- `npm test` verde antes de cada commit; teste novo entra na lista do script `test` do `package.json`.
- Idioma pt-BR na copy; ícones SVG inline (não usado neste plano de backend).
- Integração Git da Vercel parada: deploy é manual (`vercel deploy --prod`) — não faz parte deste plano.

---

## File Structure

- `src/qualify/weights.js` — pesos versionados (única fonte de ajuste).
- `src/qualify/engine.js` — `qualify(lead)` puro; helpers `accessScore`, `reviewsScore`, `icpOf`, `whyNow`.
- `src/enrich/site-audit.js` — `auditSite(html, url)` + `auditUrl(url, {fetchImpl})`.
- `src/enrich/ads.js` — `parseAdsHtml(html)` + `checkAds(query, {fetchImpl})`.
- `src/enrich/instagram.js` — `parseIgProfile(html)` + `fetchIg(handle, {fetchImpl})`.
- `src/utils/outcomes.js` — `markOutcome(id, outcome)`.
- `scripts/qualify.js` — persiste `fit/icp/reach/reasons/why_now`.
- `scripts/enrich-audit.js`, `scripts/enrich-ads.js`, `scripts/enrich-ig.js` — enrichers em batch.
- `supabase/migrations/0007_qualification.sql` — colunas novas.
- Testes: `src/tests/qualify.test.js`, `site-audit.test.js`, `ads.test.js`, `instagram.test.js`, `outcomes.test.js`; casos novos em `metrics.test.js`.
- Modificados: `src/utils/metrics.js` (fit/icp no payload + filtros), `package.json` (scripts + testes).

---

### Task 1: Pesos do motor (`weights.js`)

**Files:**
- Create: `src/qualify/weights.js`

**Interfaces:**
- Produces: objeto de pesos versionado (`version`, `oportunidade`, `capacidade`, `intencao`, `acesso`, `sistema`), consumido por `engine.js` (Task 2).

- [ ] **Step 1: Criar o arquivo de pesos**

```js
// Pesos do motor de qualificação. Ajustar APENAS aqui (não no engine).
// Bump `version` a cada recalibração para rastrear qual rodada gerou um fit.
module.exports = {
  version: 1,
  oportunidade: { semSite: 15, siteRuim: 12, semSiteComIg: 10, naoReclamado: 3, max: 30 },
  capacidade: { reviewsMax: 10, adsAtivo: 15, claimed: 5, desdeAnos: 2, estavel: 5, max: 30 },
  intencao: { adsAtivo: 15, igRecente: 10, igRecenteDias: 45, claimed: 5, max: 25 },
  acesso: { whatsappValidado: 10, celular: 5, email: 3, instagram: 3, max: 15 },
  sistema: { minReviews: 50 },
};
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/qualify/weights.js`
Expected: sem saída (ok).

- [ ] **Step 3: Commit**

```bash
git add src/qualify/weights.js
git commit -m "feat: pesos versionados do motor de qualificacao"
```

---

### Task 2: Motor `qualify()` (TDD)

**Files:**
- Create: `src/qualify/engine.js`
- Test: `src/tests/qualify.test.js`
- Modify: `package.json` (adicionar `src/tests/qualify.test.js` à lista do script `test`)

**Interfaces:**
- Consumes: `weights.js` (Task 1); `hasWa`, `waDigits` de `src/utils/wa.js`.
- Produces: `qualify(lead) → { fit:number(0-100), reach:number(0-15), icp:string[], reasons:string[], why_now:string|null }`. `icp` ∈ {`'site'`,`'sistema'`} (pode conter ambos ou vazio). Helpers exportados: `accessScore(lead)`, `reviewsScore(reviews)`, `icpOf(lead, siteBad)`, `whyNow(lead)`.

- [ ] **Step 1: Escrever o teste que falha**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { qualify, reviewsScore, accessScore } = require('../qualify/engine');

test('lead sem site com WhatsApp validado vira ICP site com motivos', () => {
  const q = qualify({ name: 'X', reviews: 40, rating: 4.8, whatsapp: '5561999990000', claimed: true });
  assert.ok(q.icp.includes('site'));
  assert.ok(q.reasons.includes('sem site'));
  assert.ok(q.fit > 40);
  assert.strictEqual(q.reach, 10);
});

test('lead fechado qualifica 0', () => {
  const q = qualify({ name: 'X', closed: true, whatsapp: '5561999990000', reviews: 300 });
  assert.strictEqual(q.fit, 0);
  assert.deepStrictEqual(q.icp, []);
});

test('anuncio ativo soma capacidade e intencao e define why_now', () => {
  const base = qualify({ name: 'X', website: 'https://x.com', reviews: 80, whatsapp: '5561999990000' });
  const comAds = qualify({ name: 'X', website: 'https://x.com', reviews: 80, whatsapp: '5561999990000', ads_active: true });
  assert.ok(comAds.fit > base.fit);
  assert.strictEqual(comAds.why_now, 'anunciando agora');
  assert.ok(comAds.reasons.includes('anúncio ativo'));
});

test('negocio com site e escala vira ICP sistema', () => {
  const q = qualify({ name: 'X', website: 'https://x.com', reviews: 120, whatsapp: '5561999990000' });
  assert.ok(q.icp.includes('sistema'));
});

test('site ruim (auditoria) conta como oportunidade', () => {
  const q = qualify({ name: 'X', website: 'https://x.com', site_audit: { ruim: true }, whatsapp: '5561999990000' });
  assert.ok(q.reasons.includes('site desatualizado'));
  assert.ok(q.icp.includes('site'));
});

test('reviewsScore e log e satura em 10', () => {
  assert.strictEqual(reviewsScore(0), 0);
  assert.ok(reviewsScore(100) > reviewsScore(10));
  assert.strictEqual(reviewsScore(1e6), 10);
});

test('accessScore soma canais e satura em 15', () => {
  assert.strictEqual(accessScore({ whatsapp: '5561999990000', email: 'a@b.c', instagram: 'x' }), 15);
  assert.strictEqual(accessScore({}), 0);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/qualify.test.js`
Expected: FAIL — `Cannot find module '../qualify/engine'`.

- [ ] **Step 3: Implementar o motor**

```js
// Motor de qualificação — puro, sem I/O. Pesos em ./weights.
const W = require('./weights');
const { hasWa, waDigits } = require('../utils/wa');

const cap = (n, max) => Math.max(0, Math.min(max, n));
const year = () => new Date().getFullYear();

// porte por volume de avaliações (log): 10→~4, 100→~7, 1e6→10
function reviewsScore(reviews) {
  const n = Math.max(0, Number(reviews) || 0);
  return Math.min(W.capacidade.reviewsMax, Math.round(Math.log10(n + 1) * 3.5));
}

function siteIsBad(a) { return !!(a && a.ruim === true); }

function accessScore(l) {
  let s = 0;
  if (hasWa(l)) s += W.acesso.whatsappValidado;
  else if (String(waDigits(l.phone)).length >= 13) s += W.acesso.celular;
  if (l.email) s += W.acesso.email;
  if (l.instagram) s += W.acesso.instagram;
  return cap(s, W.acesso.max);
}

function icpOf(l, siteBad) {
  const out = [];
  if (!l.website || siteBad) out.push('site');
  const escala = (Number(l.reviews) || 0) >= W.sistema.minReviews || l.multi_unidade === true;
  if (l.website && escala) out.push('sistema');
  return out;
}

function whyNow(l) {
  if (l.ads_active === true) return 'anunciando agora';
  if (l.since_year && year() - l.since_year <= 1) return 'recém-aberto';
  const d = Date.parse(l.ig_last_post);
  if (Number.isFinite(d) && Date.now() - d <= 30 * 86400000) return 'Instagram ativo recente';
  return null;
}

function qualify(lead) {
  const l = lead || {};
  if (l.closed) return { fit: 0, reach: 0, icp: [], reasons: ['fechado'], why_now: null };
  const siteBad = siteIsBad(l.site_audit);
  const reasons = [];

  // Oportunidade
  let op = 0;
  if (!l.website) { op += W.oportunidade.semSite; reasons.push('sem site'); }
  else if (siteBad) { op += W.oportunidade.siteRuim; reasons.push('site desatualizado'); }
  if (!l.website && l.instagram) { op += W.oportunidade.semSiteComIg; reasons.push('sem site, com Instagram'); }
  if (l.claimed === false) { op += W.oportunidade.naoReclamado; reasons.push('perfil não reclamado'); }
  op = cap(op, W.oportunidade.max);

  // Capacidade
  let cp = reviewsScore(l.reviews);
  if (l.ads_active === true) { cp += W.capacidade.adsAtivo; reasons.push('anúncio ativo'); }
  if (l.claimed === true) cp += W.capacidade.claimed;
  if (l.since_year && year() - l.since_year >= W.capacidade.desdeAnos) { cp += W.capacidade.estavel; reasons.push('negócio estabelecido'); }
  cp = cap(cp, W.capacidade.max);

  // Intenção
  let it = 0;
  if (l.ads_active === true) it += W.intencao.adsAtivo;
  const d = Date.parse(l.ig_last_post);
  if (Number.isFinite(d) && Date.now() - d <= W.intencao.igRecenteDias * 86400000) { it += W.intencao.igRecente; reasons.push('Instagram ativo'); }
  if (l.claimed === true) it += W.intencao.claimed;
  it = cap(it, W.intencao.max);

  // Acesso
  const reach = accessScore(l);
  if (hasWa(l)) reasons.push('WhatsApp validado');
  else if (reach >= W.acesso.celular) reasons.push('celular');

  const fit = cap(op + cp + it + reach, 100);
  const icp = fit > 0 ? icpOf(l, siteBad) : [];
  return { fit, reach, icp, reasons: [...new Set(reasons)], why_now: whyNow(l) };
}

module.exports = { qualify, accessScore, reviewsScore, icpOf, whyNow };
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test src/tests/qualify.test.js`
Expected: PASS (7 testes).

- [ ] **Step 5: Registrar no `package.json` e rodar a suíte**

Adicionar `src/tests/qualify.test.js` à lista do script `test` (após `src/tests/audit-wa.test.js`). Run: `npm test`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add src/qualify/engine.js src/tests/qualify.test.js package.json
git commit -m "feat: motor de qualificacao puro (fit/icp/reasons/why_now)"
```

---

### Task 3: Integrar `fit`/`icp` ao payload (`metrics.js`)

**Files:**
- Modify: `src/utils/metrics.js` (import; `buildTop`; `buildStats`; `buildPayload`)
- Test: `src/tests/metrics.test.js` (casos novos)

**Interfaces:**
- Consumes: `qualify` (Task 2).
- Produces: cada item de `payload.top` e `payload.pool` ganha `fit:number`, `reach:number`, `icp:string[]`, `reasons:string[]`, `why_now:string|null`. `buildStats` ganha `icpSite:number`, `icpSistema:number`, `avgFit:number`. `buildPayload(leads, { icp, minFit })` filtra `pool`/`top` por ICP e `fit ≥ minFit` (default: sem filtro).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `src/tests/metrics.test.js`:

```js
const { qualify } = require('../qualify/engine'); // sanity de import no arquivo de teste

test('pool expoe fit/icp/reasons e ordena por fit', () => {
  const leads = [
    { name: 'Forte', reviews: 200, rating: 4.9, whatsapp: '5561999990000', claimed: true },      // sem site, volume
    { name: 'Fraco', reviews: 1, rating: 3.0, website: 'https://x.com' },
  ];
  const p = buildPayload(leads, { dataDir: TMP, category: 'advogados' });
  assert.strictEqual(typeof p.pool[0].fit, 'number');
  assert.ok(Array.isArray(p.pool[0].icp));
  assert.ok(Array.isArray(p.pool[0].reasons));
  assert.strictEqual(p.pool[0].name, 'Forte');       // maior fit primeiro
  assert.ok(p.stats.icpSite >= 1);
  assert.strictEqual(typeof p.stats.avgFit, 'number');
});

test('buildPayload filtra por icp e minFit', () => {
  const leads = [
    { name: 'Site', reviews: 200, whatsapp: '5561999990000', claimed: true },
    { name: 'Sistema', website: 'https://x.com', reviews: 300, whatsapp: '5561999990000' },
  ];
  const p = buildPayload(leads, { dataDir: TMP, category: 'advogados', icp: 'sistema', minFit: 1 });
  assert.strictEqual(p.pool.length, 1);
  assert.strictEqual(p.pool[0].name, 'Sistema');
});
```

(`TMP` já existe no topo desse arquivo de teste; manter.)

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/metrics.test.js`
Expected: FAIL — `p.pool[0].fit` é `undefined`.

- [ ] **Step 3: Implementar**

Em `src/utils/metrics.js`, adicionar ao topo (junto aos requires):

```js
const { qualify } = require('../qualify/engine');
```

Em `buildTop`, dentro do `.map((l) => ({ ... }))`, adicionar os campos (usar o objeto `l` já pontuado):

```js
      fit: qualify(l).fit,
      reach: qualify(l).reach,
      icp: qualify(l).icp,
      reasons: qualify(l).reasons,
      why_now: qualify(l).why_now,
```

E trocar o critério de ordenação de `buildTop` de score para fit (mantendo `score` no payload para badge legado):

```js
function buildTop(leads, n = 5) {
  return leads
    .map((l) => ({ ...l, score: scoreOf(l), _q: qualify(l) }))
    .sort((a, b) => b._q.fit - a._q.fit)
    .slice(0, n)
    .map((l) => ({
      // ...campos existentes...
      fit: l._q.fit,
      reach: l._q.reach,
      icp: l._q.icp,
      reasons: l._q.reasons,
      why_now: l._q.why_now,
    }));
}
```

(Manter os campos já existentes — `wa`, `phone_link`, etc. Apenas acrescentar; remover `_q` do objeto final.)

Em `buildStats`, adicionar ao retorno:

```js
  const icpSite = leads.filter((l) => qualify(l).icp.includes('site')).length;
  const icpSistema = leads.filter((l) => qualify(l).icp.includes('sistema')).length;
  const fits = leads.map((l) => qualify(l).fit);
  const avgFit = fits.length ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : 0;
  // ...incluir no return: { ..., icpSite, icpSistema, avgFit }
```

Em `buildPayload(leads, opts = {})`, após montar `scored`, filtrar o pool antes de gerar a saída:

```js
  const icpFilter = opts.icp && opts.icp !== 'all' ? opts.icp : null;
  const minFit = Number.isFinite(opts.minFit) ? opts.minFit : 0;
  const poolLeads = prepared.filter((l) => {
    const q = qualify(l);
    if (icpFilter && !q.icp.includes(icpFilter)) return false;
    return q.fit >= minFit;
  });
```

E usar `poolLeads` (em vez de `prepared`) em `buildTop`, `buildStats`, `regionAgg`, `ratingBuckets`, `areaDistribution`, `buildQuality` — para que KPIs reflitam o filtro.

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS (qualify + metrics + demais).

- [ ] **Step 5: Commit**

```bash
git add src/utils/metrics.js src/tests/metrics.test.js
git commit -m "feat: fit/icp/reasons no payload e filtros icp/minFit (metrics)"
```

---

### Task 4: Migration 0007 + persistência (`scripts/qualify.js`)

**Files:**
- Create: `supabase/migrations/0007_qualification.sql`
- Create: `scripts/qualify.js`
- Modify: `package.json` (script `"qualify": "node scripts/qualify.js"`)

**Interfaces:**
- Consumes: `qualify` (Task 2), `sbFetchAll`/`sbFetch` (`src/utils/sb.js`).
- Produces: colunas `leads.site_audit jsonb, ads_active boolean, ads_landing text, ads_checked_at timestamptz, ig_followers int, ig_posts int, ig_last_post date, ig_checked_at timestamptz, fit int, icp text, reach int, fit_reasons text[], why_now text, outcome text, outcome_at timestamptz, qualified_at timestamptz`. `scripts/qualify.js` grava `fit/icp/reach/fit_reasons/why_now/qualified_at` a partir dos sinais existentes.

- [ ] **Step 1: Criar a migration**

`supabase/migrations/0007_qualification.sql`:

```sql
-- 0007: qualificação multifonte — sinais de intenção/capacidade + fit persistido.
alter table leads add column if not exists site_audit jsonb;
alter table leads add column if not exists ads_active boolean;
alter table leads add column if not exists ads_landing text;
alter table leads add column if not exists ads_checked_at timestamptz;
alter table leads add column if not exists ig_followers int;
alter table leads add column if not exists ig_posts int;
alter table leads add column if not exists ig_last_post date;
alter table leads add column if not exists ig_checked_at timestamptz;
alter table leads add column if not exists fit int;
alter table leads add column if not exists icp text;
alter table leads add column if not exists reach int;
alter table leads add column if not exists fit_reasons text[];
alter table leads add column if not exists why_now text;
alter table leads add column if not exists outcome text;
alter table leads add column if not exists outcome_at timestamptz;
alter table leads add column if not exists qualified_at timestamptz;
create index if not exists leads_fit on leads (fit desc nulls last);
```

- [ ] **Step 2: Criar o script de persistência**

`scripts/qualify.js`:

```js
/* Recalcula e persiste fit/icp/reach/reasons/why_now de todos os leads.
   npm run qualify — puro sobre as colunas já enriquecidas. */
require('dotenv').config();
const { sbFetchAll, sbFetch } = require('../src/utils/sb');
const { qualify } = require('../src/qualify/engine');

async function main() {
  const rows = await sbFetchAll(
    'leads?select=id,name,phone,whatsapp,website,instagram,reviews,rating,claimed,since_year,closed,site_audit,ads_active,ig_last_post&order=id'
  );
  console.log(`[qualify] ${rows.length} leads`);
  let ok = 0, fail = 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    const q = qualify(r);
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: {
          fit: q.fit, reach: q.reach,
          icp: q.icp.join(',') || null,
          fit_reasons: q.reasons,
          why_now: q.why_now,
          qualified_at: now,
        },
      });
      ok++;
    } catch (e) { fail++; console.error(`[qualify] erro ${r.id}: ${e.message}`); }
  }
  console.log(`[qualify] concluído: ${ok} ok, ${fail} falhas`);
}

if (require.main === module) main().catch((e) => { console.error('[qualify]', e.message); process.exit(1); });
module.exports = { main };
```

- [ ] **Step 3: Rodar sintaxe + script em seco**

Run: `node --check scripts/qualify.js`
Expected: sem saída.
Nota: a migration precisa ser aplicada no **SQL Editor** antes de `npm run qualify` gravar (senão o PATCH falha em coluna inexistente). Marcar aqui como dependência do usuário.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0007_qualification.sql scripts/qualify.js package.json
git commit -m "feat: migration 0007 + persistencia de fit/icp (qualify)"
```

---

### Task 5: Auditoria de site (`site-audit.js`, TDD)

**Files:**
- Create: `src/enrich/site-audit.js`
- Test: `src/tests/site-audit.test.js`
- Modify: `package.json` (adicionar `src/tests/site-audit.test.js` à lista do `test`)

**Interfaces:**
- Produces: `auditSite(html, finalUrl) → { https:bool, mobile:bool, platform:string, copyright_year:number|null, has_form:bool, has_booking:bool, peso_kb:number, ruim:bool }`; `auditUrl(rawUrl, { fetchImpl, timeoutMs }) → Promise<resultado|null>` (null em falha/offline). Consumido por `scripts/enrich-audit.js` (Task 6) e pelo `site_audit` do motor (Task 2).

- [ ] **Step 1: Escrever o teste que falha**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { auditSite, auditUrl } = require('../enrich/site-audit');

test('site https com viewport e WordPress nao e ruim', () => {
  const a = auditSite('<html><head><meta name="viewport" content="width=device-width"><link href="/wp-content/x.css"></head><body><form></form></body></html>', 'https://x.com');
  assert.strictEqual(a.https, true);
  assert.strictEqual(a.mobile, true);
  assert.strictEqual(a.platform, 'wordpress');
  assert.strictEqual(a.ruim, false);
});

test('http sem viewport, builder, copyright antigo => ruim', () => {
  const a = auditSite('<html><head></head><body>wixstatic © 2013</body></html>', 'http://x.com');
  assert.strictEqual(a.mobile, false);
  assert.strictEqual(a.platform, 'wix');
  assert.strictEqual(a.copyright_year, 2013);
  assert.strictEqual(a.ruim, true);
});

test('formulario e agendamento detectados', () => {
  const a = auditSite('<form></form> agende seu horario', 'https://x.com');
  assert.strictEqual(a.has_form, true);
  assert.strictEqual(a.has_booking, true);
});

test('auditUrl devolve null quando fetch falha', async () => {
  const r = await auditUrl('https://x.com', { fetchImpl: async () => { throw new Error('boom'); } });
  assert.strictEqual(r, null);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/site-audit.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/enrich/site-audit.js`:

```js
// Auditoria de qualidade de site — fetch + regex, zero dependências.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

function platformOf(t) {
  if (/wixstatic|wix\.com|wixsite/i.test(t)) return 'wix';
  if (/wp-content|wp-includes|wordpress/i.test(t)) return 'wordpress';
  if (/squarespace/i.test(t)) return 'squarespace';
  if (/cdn\.shopify|shopify/i.test(t)) return 'shopify';
  if (/canva|godaddy|weebly|site123|jimdo/i.test(t)) return 'builder';
  return 'outro';
}

function auditSite(html, finalUrl) {
  const raw = String(html || '');
  const t = raw.slice(0, 400000);
  const https = /^https:/i.test(String(finalUrl || ''));
  const mobile = /<meta[^>]+name=["']viewport["']/i.test(t);
  const platform = platformOf(t);
  const cy = t.match(/(?:©|&copy;|copyright)[^0-9<]{0,24}((?:19|20)\d{2})/i);
  const copyright_year = cy ? parseInt(cy[1], 10) : null;
  const has_form = /<form[\s>]/i.test(t) || /mailto:/i.test(t);
  const has_booking = /agend|agendar|reserv|booking|schedul/i.test(t);
  const peso_kb = Math.round(Buffer.byteLength(raw, 'utf8') / 1024);
  const stale = !!copyright_year && new Date().getFullYear() - copyright_year >= 3;
  const ruim = !https || !mobile || stale || platform === 'builder';
  return { https, mobile, platform, copyright_year, has_form, has_booking, peso_kb, ruim };
}

async function auditUrl(rawUrl, { fetchImpl, timeoutMs = 8000 } = {}) {
  const f = fetchImpl || fetch;
  let url = String(rawUrl || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const res = await f(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) return null;
    return auditSite(await res.text(), res.url || url);
  } catch { return null; }
}

module.exports = { auditSite, auditUrl };
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS (4 novos + demais).

- [ ] **Step 5: Commit**

```bash
git add src/enrich/site-audit.js src/tests/site-audit.test.js package.json
git commit -m "feat: auditoria de qualidade de site (site-audit)"
```

---

### Task 6: Enricher de auditoria (`scripts/enrich-audit.js`)

**Files:**
- Create: `scripts/enrich-audit.js`
- Modify: `package.json` (script `"enrich:audit": "node scripts/enrich-audit.js"`)

**Interfaces:**
- Consumes: `auditUrl` (Task 5), `sbFetch` (`src/utils/sb.js`), coluna `site_audit` (Task 4).
- Produces: linhas `leads` com `site_audit` jsonb preenchido (não sobrescreve quando a auditoria falha).

- [ ] **Step 1: Criar o script**

```js
/* Auditoria de site em batch. npm run enrich:audit [limite]
   Resumível: pega leads COM site e sem site_audit. Falha => não grava. */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { auditUrl } = require('../src/enrich/site-audit');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const rows = (await sbFetch(`leads?select=id,website&website=not.is.null&site_audit=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:audit] ${rows.length} sites a auditar`);
  let ok = 0, ruim = 0, fail = 0;
  for (const r of rows) {
    const a = await auditUrl(r.website);
    if (!a) { fail++; console.log(`[enrich:audit] skip ${r.website.slice(0, 40)}`); await sleep(300); continue; }
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { site_audit: a } });
      ok++; if (a.ruim) ruim++;
      console.log(`[enrich:audit] ok ${r.website.slice(0, 40)} -> ruim=${a.ruim} plat=${a.platform}`);
    } catch (e) { fail++; console.error(`[enrich:audit] erro ${r.id}: ${e.message}`); }
    await sleep(300);
  }
  console.log(`[enrich:audit] concluído: ${ok} ok (${ruim} ruins), ${fail} falhas`);
}

if (require.main === module) main().catch((e) => { console.error('[enrich:audit]', e.message); process.exit(1); });
module.exports = { main };
```

- [ ] **Step 2: Sintaxe + commit**

Run: `node --check scripts/enrich-audit.js`

```bash
git add scripts/enrich-audit.js package.json
git commit -m "feat: enrich:audit — auditoria de site em batch"
```

---

### Task 7: Detecção de anúncios (`ads.js`, TDD)

**Files:**
- Create: `src/enrich/ads.js`
- Test: `src/tests/ads.test.js`
- Modify: `package.json` (adicionar `src/tests/ads.test.js`)

**Interfaces:**
- Produces: `parseAdsHtml(html) → { active:bool, landing:string|null }`; `checkAds(query, { fetchImpl, timeoutMs }) → Promise<{ active, landing } | null>`. Consumido por `scripts/enrich-ads.js` (Task 8).

Nota: a página pública do Google Ads Transparency é dinâmica; `parseAdsHtml` é testado contra fixture e `checkAds` faz melhor esforço (falha → `null`, tratado como `unknown`, nunca `active=false`).

- [ ] **Step 1: Escrever o teste que falha**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseAdsHtml, checkAds } = require('../enrich/ads');

test('pagina vazia => sem anuncio ativo', () => {
  const r = parseAdsHtml('<html><body>Nenhum anúncio encontrado</body></html>');
  assert.strictEqual(r.active, false);
  assert.strictEqual(r.landing, null);
});

test('pagina com card de anuncio e landing => ativo', () => {
  const html = '<html><body>3 anúncios <a href="https://clinicax.com.br/orcamento">Ver</a></body></html>';
  const r = parseAdsHtml(html);
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.landing, 'clinicax.com.br');
});

test('checkAds devolve null quando fetch falha', async () => {
  const r = await checkAds('Clínica X', { fetchImpl: async () => { throw new Error('boom'); } });
  assert.strictEqual(r, null);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/ads.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/enrich/ads.js`:

```js
// Detecção de anúncio ativo no Google Ads Transparency Center (público).
// FRÁGIL por natureza (página dinâmica): falha => null (= unknown), nunca false.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const EMPTY_RE = /nenhum an[úu]ncio|no ads|sem resultados|no results|nenhum resultado/i;
const CARD_RE = /\d+\s+an[úu]ncios?|ad creatives|an[úu]ncio(s)?\b/i;

function extractLanding(t) {
  const m = String(t || '').match(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=["'<])/i);
  return m ? m[1].toLowerCase() : null;
}

function parseAdsHtml(html) {
  const t = String(html || '');
  const empty = EMPTY_RE.test(t);
  const active = !empty && CARD_RE.test(t);
  return { active, landing: active ? extractLanding(t) : null };
}

async function checkAds(query, { fetchImpl, timeoutMs = 10000 } = {}) {
  const f = fetchImpl || fetch;
  const q = String(query || '').trim();
  if (!q) return null;
  const url = 'https://adstransparency.google.com/?region=BR&query=' + encodeURIComponent(q);
  try {
    const res = await f(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) return null;
    return parseAdsHtml(await res.text());
  } catch { return null; }
}

module.exports = { parseAdsHtml, checkAds, extractLanding };
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/enrich/ads.js src/tests/ads.test.js package.json
git commit -m "feat: deteccao de anuncio ativo (Ads Transparency)"
```

---

### Task 8: Enricher de anúncios (`scripts/enrich-ads.js`)

**Files:**
- Create: `scripts/enrich-ads.js`
- Modify: `package.json` (script `"enrich:ads": "node scripts/enrich-ads.js"`)

**Interfaces:**
- Consumes: `checkAds` (Task 7), `sbFetch`, colunas `ads_active/ads_landing/ads_checked_at` (Task 4).
- Produces: `ads_active` (bool) e `ads_landing` por lead; sempre marca `ads_checked_at`.

- [ ] **Step 1: Criar o script**

```js
/* Detecta anúncio ativo por lead (Ads Transparency). npm run enrich:ads [limite]
   Resumível por ads_checked_at. Falha => grava só ads_checked_at (unknown). */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { checkAds } = require('../src/enrich/ads');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const rows = (await sbFetch(`leads?select=id,name,website&ads_checked_at=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:ads] ${rows.length} leads a checar`);
  let ativos = 0, unknown = 0, ok = 0;
  for (const r of rows) {
    const q = r.name || r.website || '';
    const res = await checkAds(q);
    const patch = { ads_checked_at: new Date().toISOString() };
    if (res) { patch.ads_active = res.active; if (res.landing) patch.ads_landing = res.landing; if (res.active) ativos++; }
    else unknown++;
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch });
      ok++;
    } catch (e) { console.error(`[enrich:ads] erro ${r.id}: ${e.message}`); }
    await sleep(500);
  }
  console.log(`[enrich:ads] concluído: ${ok} ok, ${ativos} com anúncio, ${unknown} unknown`);
}

if (require.main === module) main().catch((e) => { console.error('[enrich:ads]', e.message); process.exit(1); });
module.exports = { main };
```

- [ ] **Step 2: Sintaxe + commit**

Run: `node --check scripts/enrich-ads.js`

```bash
git add scripts/enrich-ads.js package.json
git commit -m "feat: enrich:ads — deteccao de anuncio em batch"
```

---

### Task 9: Instagram público (`instagram.js`, TDD)

**Files:**
- Create: `src/enrich/instagram.js`
- Test: `src/tests/instagram.test.js`
- Modify: `package.json` (adicionar `src/tests/instagram.test.js`)

**Interfaces:**
- Produces: `parseIgProfile(html) → { blocked:bool, followers:number|null, posts:number|null, last_post:string|null }`; `handleFrom(value) → string|null`; `fetchIg(handle, { fetchImpl }) → Promise<resultado|null>`. Consumido por `scripts/enrich-ig.js` (Task 10).

Nota de honestidade: o Instagram frequentemente serve muro de login para acesso anônimo. Quando não há meta pública, `blocked=true` e os números ficam `null` (= unknown). `last_post` é melhor esforço via `<time datetime>`.

- [ ] **Step 1: Escrever o teste que falha**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseIgProfile, handleFrom } = require('../enrich/instagram');

test('extrai seguidores e posts do og:description', () => {
  const html = '<meta property="og:description" content="1,234 Followers, 12 Following, 88 Posts - Clínica X">';
  const r = parseIgProfile(html);
  assert.strictEqual(r.blocked, false);
  assert.strictEqual(r.followers, 1234);
  assert.strictEqual(r.posts, 88);
});

test('muro de login => blocked', () => {
  const r = parseIgProfile('<html><body>Faça login para continuar</body></html>');
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.followers, null);
});

test('handleFrom normaliza URL ou @handle', () => {
  assert.strictEqual(handleFrom('https://instagram.com/clinicax/'), 'clinicax');
  assert.strictEqual(handleFrom('@clinicax'), 'clinicax');
  assert.strictEqual(handleFrom('clinicax'), 'clinicax');
  assert.strictEqual(handleFrom(''), null);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/instagram.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/enrich/instagram.js`:

```js
// Instagram público — melhor esforço. Muro de login => blocked (unknown).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

function handleFrom(value) {
  let v = String(value || '').trim();
  if (!v) return null;
  v = v.replace(/^@/, '');
  const m = v.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (m) return m[1];
  return /^[A-Za-z0-9_.]{2,40}$/.test(v) ? v : null;
}

function num(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parseIgProfile(html) {
  const t = String(html || '');
  const m = t.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || t.match(/<meta[^>]+content=["']([^"']*(?:Followers|seguidores)[^"']*)["'][^>]+property=["']og:description["']/i);
  const desc = m ? m[1] : '';
  const f = desc.match(/([\d.,]+)\s*(?:Followers|seguidores)/i);
  const p = desc.match(/([\d.,]+)\s*(?:Posts|publica)/i);
  const tm = t.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  const blocked = !m;
  return { blocked, followers: f ? num(f[1]) : null, posts: p ? num(p[1]) : null, last_post: tm ? tm[1].slice(0, 10) : null };
}

async function fetchIg(handle, { fetchImpl, timeoutMs = 8000 } = {}) {
  const f = fetchImpl || fetch;
  const h = handleFrom(handle);
  if (!h) return null;
  try {
    const res = await f('https://www.instagram.com/' + h + '/', { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) return null;
    return parseIgProfile(await res.text());
  } catch { return null; }
}

module.exports = { parseIgProfile, fetchIg, handleFrom };
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/enrich/instagram.js src/tests/instagram.test.js package.json
git commit -m "feat: leitura publica de perfil do Instagram (best-effort)"
```

---

### Task 10: Enricher de Instagram (`scripts/enrich-ig.js`)

**Files:**
- Create: `scripts/enrich-ig.js`
- Modify: `package.json` (script `"enrich:ig": "node scripts/enrich-ig.js"`)

**Interfaces:**
- Consumes: `fetchIg`/`handleFrom` (Task 9), `sbFetch`, colunas `ig_*` (Task 4).
- Produces: `ig_followers/ig_posts/ig_last_post` por lead com `instagram`; sempre marca `ig_checked_at`.

- [ ] **Step 1: Criar o script**

```js
/* Instagram em batch. npm run enrich:ig [limite]
   Resumível por ig_checked_at. Muro de login => grava só ig_checked_at. */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { fetchIg } = require('../src/enrich/instagram');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '40', 10);
  const rows = (await sbFetch(`leads?select=id,instagram&instagram=not.is.null&ig_checked_at=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:ig] ${rows.length} perfis a checar`);
  let ok = 0, dados = 0, blocked = 0;
  for (const r of rows) {
    const res = await fetchIg(r.instagram);
    const patch = { ig_checked_at: new Date().toISOString() };
    if (res && !res.blocked) {
      if (res.followers != null) patch.ig_followers = res.followers;
      if (res.posts != null) patch.ig_posts = res.posts;
      if (res.last_post) patch.ig_last_post = res.last_post;
      dados++;
    } else blocked++;
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch });
      ok++;
    } catch (e) { console.error(`[enrich:ig] erro ${r.id}: ${e.message}`); }
    await sleep(1200);
  }
  console.log(`[enrich:ig] concluído: ${ok} ok, ${dados} com dados, ${blocked} blocked`);
}

if (require.main === module) main().catch((e) => { console.error('[enrich:ig]', e.message); process.exit(1); });
module.exports = { main };
```

- [ ] **Step 2: Sintaxe + commit**

Run: `node --check scripts/enrich-ig.js`

```bash
git add scripts/enrich-ig.js package.json
git commit -m "feat: enrich:ig — leitura publica de Instagram em batch"
```

---

### Task 11: Desfecho do lead (`outcomes.js` + endpoint, TDD)

**Files:**
- Create: `src/utils/outcomes.js`
- Create: `api/outcome.js`
- Test: `src/tests/outcomes.test.js`
- Modify: `package.json` (adicionar `src/tests/outcomes.test.js`)

**Interfaces:**
- Produces: `markOutcome(id, outcome)` — valida id (`/^[a-f0-9]{6,64}$/i`) e `outcome ∈ ALLOWED`; PATCH `{ outcome, outcome_at }`. `ALLOWED = ['novo','contatado','respondeu','reuniao','fechou','perdeu']`. Endpoint `POST /api/outcome { id, outcome }` autenticado.

- [ ] **Step 1: Escrever o teste que falha**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { markOutcome, ALLOWED } = require('../utils/outcomes');

test('outcome invalido rejeita sem tocar no banco', async () => {
  await assert.rejects(() => markOutcome('abc123', 'zebra'), (e) => e.code === 'invalid_outcome');
});

test('id invalido rejeita', async () => {
  await assert.rejects(() => markOutcome('!!', 'respondeu'), (e) => e.code === 'invalid_id');
});

test('lista de outcomes esperada', () => {
  assert.deepStrictEqual(ALLOWED, ['novo', 'contatado', 'respondeu', 'reuniao', 'fechou', 'perdeu']);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test src/tests/outcomes.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o util**

`src/utils/outcomes.js`:

```js
// Registro do desfecho comercial do lead (base do feedback de calibração).
const { sbFetch } = require('./sb');

const ALLOWED = ['novo', 'contatado', 'respondeu', 'reuniao', 'fechou', 'perdeu'];

async function markOutcome(id, outcome) {
  const iid = String(id || '');
  if (!/^[a-f0-9]{6,64}$/i.test(iid)) { const e = new Error('invalid_id'); e.code = 'invalid_id'; throw e; }
  if (!ALLOWED.includes(outcome)) { const e = new Error('invalid_outcome'); e.code = 'invalid_outcome'; throw e; }
  await sbFetch(`leads?id=eq.${iid}`, { method: 'PATCH', body: { outcome, outcome_at: new Date().toISOString() } });
  return true;
}

module.exports = { markOutcome, ALLOWED };
```

- [ ] **Step 4: Implementar o endpoint (espelha `api/contact.js`)**

`api/outcome.js`:

```js
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { markOutcome } = require('../src/utils/outcomes');
const { SbError } = require('../src/utils/sb');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  try {
    await markOutcome((req.body || {}).id, (req.body || {}).outcome);
    json(res, 200, { ok: true });
  } catch (e) {
    if (e instanceof SbError) { json(res, e.status >= 500 ? 503 : e.status, { error: e.status >= 500 ? 'supabase_down' : e.code }); return; }
    if (e.code === 'invalid_id' || e.code === 'invalid_outcome') { json(res, 400, { error: e.code }); return; }
    console.error('[api/outcome]', e);
    json(res, 500, { error: 'internal' });
  }
};
```

- [ ] **Step 5: Verificar rota local**

Conferir que o servidor local (`scripts/serve-web.js`) roteia `POST /api/outcome` para `api/outcome.js` como faz com `api/contact.js`; se houver uma lista/registro explícito de rotas, adicionar `outcome`. Se o roteamento for por convenção de pasta `api/`, nenhuma mudança é necessária.

- [ ] **Step 6: Rodar os testes + commit**

Run: `npm test` → PASS.

```bash
git add src/utils/outcomes.js api/outcome.js src/tests/outcomes.test.js package.json
git commit -m "feat: registro de desfecho do lead (outcome) + endpoint"
```

---

### Task 12: Sanidade e calibração dos pesos

**Files:**
- Create: `scripts/qualify-stats.js`
- Modify: `package.json` (script `"qualify:stats": "node scripts/qualify-stats.js"`)

**Interfaces:**
- Consumes: `qualify` (Task 2), `sbFetchAll`.
- Produces: relatório no console com distribuição de `fit` (faixas), contagem por `icp`, média de `fit`, e top motivos (`reasons`) — insumo para recalibrar `weights.js`.

- [ ] **Step 1: Criar o script**

```js
/* Sanidade do motor sobre a base real: distribuição de fit/icp e motivos.
   npm run qualify:stats — puro, não grava. Insumo para calibrar weights.js. */
require('dotenv').config();
const { sbFetchAll } = require('../src/utils/sb');
const { qualify } = require('../src/qualify/engine');

async function main() {
  const rows = await sbFetchAll(
    'leads?select=id,name,phone,whatsapp,website,instagram,reviews,rating,claimed,since_year,closed,site_audit,ads_active,ig_last_post&order=id'
  );
  const bands = { '0-19': 0, '20-39': 0, '40-59': 0, '60-79': 0, '80-100': 0 };
  const icp = { site: 0, sistema: 0, nenhum: 0 };
  const motivo = {};
  let soma = 0;
  for (const r of rows) {
    const q = qualify(r);
    soma += q.fit;
    const b = q.fit >= 80 ? '80-100' : q.fit >= 60 ? '60-79' : q.fit >= 40 ? '40-59' : q.fit >= 20 ? '20-39' : '0-19';
    bands[b]++;
    if (!q.icp.length) icp.nenhum++;
    if (q.icp.includes('site')) icp.site++;
    if (q.icp.includes('sistema')) icp.sistema++;
    for (const m of q.reasons) motivo[m] = (motivo[m] || 0) + 1;
  }
  const top = Object.entries(motivo).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`[qualify:stats] ${rows.length} leads · fit médio ${rows.length ? Math.round(soma / rows.length) : 0}`);
  console.log('[qualify:stats] faixas:', JSON.stringify(bands));
  console.log('[qualify:stats] icp   :', JSON.stringify(icp));
  console.log('[qualify:stats] motivos top:');
  for (const [m, n] of top) console.log(`   ${String(n).padStart(4)}  ${m}`);
}

if (require.main === module) main().catch((e) => { console.error('[qualify:stats]', e.message); process.exit(1); });
module.exports = { main };
```

- [ ] **Step 2: Sintaxe + rodar (após migration aplicada)**

Run: `node --check scripts/qualify-stats.js`
Run (após `0007` no SQL Editor): `npm run qualify:stats`
Expected: faixas/icp/motivos impressos; sanidade visual (muitos leads em 0-19 se faltam sinais; ICP site/ sistema coerentes com a base).

- [ ] **Step 3: Commit**

```bash
git add scripts/qualify-stats.js package.json
git commit -m "feat: qualify:stats — sanidade e calibracao do motor"
```

---

## Self-Review

**Spec coverage:**
- §2 dois números (`fit`/`reach`) → Task 2. ✓
- §3 modelo (4 dimensões, ICP, desqualificadores, `why_now`) → Task 2. ✓
- §4 fontes: auditoria de site → Tasks 5–6; Ads Transparency → Tasks 7–8; Instagram → Tasks 9–10. ✓
- §5 fluxo/arquitetura (persistência em SQL, filtro no payload) → Tasks 3–4. ✓
- §6 migration 0007 + módulos + scripts → Tasks 4–12. ✓ (UI/§6-UI fica no plano irmão.)
- §7 erro/limites (unknown, não-degradante, resumível) → Global Constraints + Tasks 6/8/10. ✓
- §8 testes (TDD puro + smoke) → cada task. ✓
- §9 fases: F0→T1–T4; F1→T5–6; F2→T7–8; F3→T9–10; F4→T11–12; F5→plano de UI. ✓
- §10 fora de escopo respeitado (sem ML, sem fontes pagas, sem Baileys). ✓

**Placeholder scan:** sem TBD/TODO; todos os steps trazem código/comando.
**Type consistency:** `qualify` retorna `{fit,reach,icp,reasons,why_now}` em T2 e é consumido com os mesmos nomes em T3/T4/T12; colunas de T4 batem com os PATCHes de T6/T8/T10/T11 (`site_audit`, `ads_active/ads_landing/ads_checked_at`, `ig_followers/ig_posts/ig_last_post/ig_checked_at`, `fit/icp/reach/fit_reasons/why_now/qualified_at`, `outcome/outcome_at`). ✓

**Pendência de ambiente:** a migration `0007` precisa ser aplicada no SQL Editor pelo usuário antes de `npm run qualify`/`enrich:*` gravarem (mesma regra das 0004–0006).

