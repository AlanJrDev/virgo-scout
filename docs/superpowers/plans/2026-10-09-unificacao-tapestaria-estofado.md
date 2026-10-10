# Unificação de Leads + Tapeçaria/Estofado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todos os leads numa tabela só com coluna/filtro de Tipo (afetando KPIs, mapa e fila), duas categorias novas de captura (Tapeçaria e Estofado, DF inteiro) e dedupe multi-categoria com identidade por place_id.

**Architecture:** Fonte única = Supabase em local e produção (`/api/leads` com `?type=` opcional); registro central de categorias (`src/utils/categories.js`) compartilhado por sync, repair, servidor e captura; sync vira "planUpsert" (inserts novos + patches não-degradantes com união de `types` + deletes de órfãos); UI troca o toggle de categoria por um segmented control global de Tipo no topbar.

**Tech Stack:** Node 24 CommonJS, zero dependências novas, Supabase PostgREST direto (sbFetch/sbFetchAll), Playwright (chromium `--headless=new`), painel vanilla JS + GSAP, testes `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-09-unificacao-categorias-design.md` (obrigatório ler antes de cada task).

## Global Constraints

- Tags de banco (sem acento, em tudo que é código/chave/URL): `advogados`, `arquitetura`, `tapecaria`, `estofado`. Labels UI: Advogado, Arquitetura, Tapeçaria, Estofado.
- Migration `0005_types_placeid.sql` **já aplicada** — coluna `types` viva; ids com place_id já reescritos.
- Servidor local em http://localhost:8901 **já rodando — não derrubar**. QA_USER/QA_PASS no `.env`.
- Testes: `npm test` (base 114 verdes). TDD obrigatório onde há lógica pura.
- Playwright: `chromium.launch({ headless:false, args:['--no-sandbox','--headless=new'] })`; probes em servidor próprio (porta 8902) e script apagado depois.
- Migrations nunca rodam via PostgREST (SQL Editor). Deploy Vercel: `vercel deploy --prod` (integração Git parada).
- Sem novas dependências npm. Sem comentários novos no código (seguir estilo do arquivo).
- PowerShell: não usar `&&` (usar `; if ($?) { }`).

---

### Task 1: Registro de categorias + leitura por prefixo

**Files:**
- Create: `src/utils/categories.js`
- Create: `src/tests/categories.test.js`
- Modify: `src/utils/leads-io.js` (match por registro)
- Modify: `src/utils/metrics.js:36-38` (`matchCategory` ganha `'all'`)

**Interfaces:**
- Produces: `CATEGORIES` (map key→{tag,label,script,queriesModule,queriesExport,basename}), `CAT_KEYS` (string[]), `tagOf(category)→tag`, `typeList(lead)→string[]` (lê `types` com fallback `source`, split por vírgula), `typeOfLead(lead)→string` (primeiro tipo ou `'advogados'`), `matchesType(lead,type)→boolean` (`type==='all'`→true).
- Produces: `matchFile(filename,category)→boolean` exportado de `leads-io`.
- Demais tasks importam tudo de `src/utils/categories.js`.

- [ ] **Step 1: Escrever o teste falhando**

```js
// src/tests/categories.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { CATEGORIES, CAT_KEYS, tagOf, typeList, typeOfLead, matchesType } = require('../utils/categories');
const { matchFile } = require('../utils/leads-io');

test('registro cobre as 4 categorias com tags sem acento', () => {
  assert.deepStrictEqual(CAT_KEYS, ['advogados', 'arquitetura', 'tapecaria', 'estofado']);
  assert.strictEqual(tagOf('tapecaria'), 'tapecaria');
  assert.strictEqual(tagOf('inexistente'), 'advogados');
  assert.strictEqual(CATEGORIES.tapecaria.label, 'Tapeçaria');
});

test('typeList faz split de types com fallback para source', () => {
  assert.deepStrictEqual(typeList({ types: 'tapecaria,estofado' }), ['tapecaria', 'estofado']);
  assert.deepStrictEqual(typeList({ source: 'arquitetura' }), ['arquitetura']);
  assert.deepStrictEqual(typeList({}), ['advogados']);
  assert.strictEqual(typeOfLead({ types: 'estofado,tapecaria' }), 'estofado');
  assert.strictEqual(typeOfLead({}), 'advogados');
});

test('matchesType: all casa tudo; tag exata casa; tag ausente não casa', () => {
  const l = { types: 'tapecaria,estofado' };
  assert.strictEqual(matchesType(l, 'all'), true);
  assert.strictEqual(matchesType(l, 'tapecaria'), true);
  assert.strictEqual(matchesType(l, 'advogados'), false);
});

test('matchFile separa prefixos de arquivo por categoria', () => {
  assert.strictEqual(matchFile('tapecaria-df-max.json', 'tapecaria'), true);
  assert.strictEqual(matchFile('tapecaria-df-max.json', 'advogados'), false);
  assert.strictEqual(matchFile('advogados-df-max.json', 'advogados'), true);
  assert.strictEqual(matchFile('arquitetura-df-max.json', 'advogados'), false);
  assert.strictEqual(matchFile('estofado-df-max.json', 'estofado'), true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/tests/categories.test.js`
Expected: FAIL — Cannot find module `../utils/categories`

- [ ] **Step 3: Implementar `src/utils/categories.js`**

```js
const CATEGORIES = {
  advogados: { tag: 'advogados', label: 'Advogado', script: 'capture-advogados-df.js', queriesModule: './queries', queriesExport: 'QUERIES', basename: null },
  arquitetura: { tag: 'arquitetura', label: 'Arquitetura', script: 'capture-arquitetura.js', queriesModule: './queries-arquitetura', queriesExport: 'QUERIES_ARQ', basename: 'arquitetura-df-max' },
  tapecaria: { tag: 'tapecaria', label: 'Tapeçaria', script: 'capture-tapecaria.js', queriesModule: './queries-tapecaria', queriesExport: 'QUERIES_TAP', basename: 'tapecaria-df-max' },
  estofado: { tag: 'estofado', label: 'Estofado', script: 'capture-estofado.js', queriesModule: './queries-estofado', queriesExport: 'QUERIES_EST', basename: 'estofado-df-max' },
};
const CAT_KEYS = Object.keys(CATEGORIES);
function tagOf(category) { return (CATEGORIES[category] || CATEGORIES.advogados).tag; }
function typeList(lead) {
  const raw = (lead && (lead.types || lead.source)) || '';
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}
function typeOfLead(lead) { return typeList(lead)[0] || 'advogados'; }
function matchesType(lead, type) { return type === 'all' || typeList(lead).includes(type); }
module.exports = { CATEGORIES, CAT_KEYS, tagOf, typeList, typeOfLead, matchesType };
```

- [ ] **Step 4: Adaptar `src/utils/leads-io.js`**

Trocar a lógica de prefixo por registro (mantém `newestLeadsFile` com a mesma assinatura):

```js
const { CATEGORIES, tagOf } = require('./categories');

function matchFile(f, category) {
  const tag = tagOf(category);
  if (tag === 'advogados') {
    return !Object.values(CATEGORIES).some((c) => c.tag !== 'advogados' && f.startsWith(c.tag));
  }
  return f.startsWith(tag + '-');
}

function newestLeadsFile(dataDir, category = 'advogados') {
  const tag = tagOf(category);
  const preferred =
    tag === 'advogados'
      ? [process.env.BASENAME ? `${process.env.BASENAME}.v2.json` : null, 'advogados-df-max.v2.json', 'advogados-df-max.json'].filter(Boolean)
      : [`${tag}-df-max.v2.json`, `${tag}-df-max.json`];
  for (const f of preferred) {
    const p = path.join(dataDir, f);
    if (matchFile(f, category) && fs.existsSync(p)) return p;
  }
  const any = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && !f.includes('validacao') && !f.includes('job') && matchFile(f, category))
    .map((f) => ({ f, m: fs.statSync(path.join(dataDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return any.length ? path.join(dataDir, any[0].f) : null;
}

module.exports = { newestLeadsFile, matchFile };
```

- [ ] **Step 5: `matchCategory` de `'all'` em `src/utils/metrics.js`**

Na linha 36:

```js
function matchCategory(file, category) {
  if (category === 'all') return true;
  return require('./leads-io').matchFile(file, category);
}
```

(Ex.: `require` no topo do arquivo junto aos outros imports — não dentro da função.)

- [ ] **Step 6: Rodar testes novos + suíte completa**

Run: `node --test src/tests/categories.test.js` → PASS
Run: `npm test` → 114+4 verdes (nenhum existente quebra)

- [ ] **Step 7: Commit**

```bash
git add src/utils/categories.js src/tests/categories.test.js src/utils/leads-io.js src/utils/metrics.js
git commit -m "feat: registro de categorias (4 tags) + typeList/matchesType + matchFile por prefixo"
```

---

### Task 2: Classificador Tapeçaria/Estofado

**Files:**
- Modify: `src/utils/classify.js:38-40` (`rulesFor` + regras novas)
- Test: `src/tests/classify.test.js`

**Interfaces:**
- Consumes: `tagOf` não necessário — classificador recebe a **chave** da categoria (`'tapecaria'`, `'estofado'`).
- Produces: `classifyLead(lead, 'tapecaria'|'estofado')` → `{area, confidence}` com mesmas camadas (0.95 categoria, 0.9 nome, 0.7 origem, 0.6 título, 0.3 fallback `'Geral'`).

- [ ] **Step 1: Testes falhando**

Adicionar ao final de `src/tests/classify.test.js`:

```js
test('tapeçaria: área pela categoria oficial do Maps (camada 0.95)', () => {
  const r = classifyLead({ name: 'Loja X', category: 'Loja de cortinas e tapeçaria' }, 'tapecaria');
  assert.strictEqual(r.area, 'Cortinas');
  assert.strictEqual(r.confidence, 0.95);
});

test('tapeçaria: área pela origem da query (camada 0.7)', () => {
  const r = classifyLead({ name: 'Decoração Y', origin: 'tapeçaria Lago Sul Brasília DF' }, 'tapecaria');
  assert.strictEqual(r.area, 'Tapeçaria');
  assert.ok(r.confidence <= 0.8);
});

test('estofado: área pelo nome', () => {
  const r = classifyLead({ name: 'Estofados São Marcos' }, 'estofado');
  assert.strictEqual(r.area, 'Estofado');
  assert.ok(r.confidence <= 0.95);
});
```

Obs.: `norm()` remove acentos (`tapeçaria`→`tapecaria`, ç→c — NÃO `tapecaria`), então as keywords vão SEM acento e `tapecaria` é keyword obrigatória da regra Tapeçaria.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/tests/classify.test.js`
Expected: FAIL — as áreas novas não existem (área cai em `'Geral'`/erro)

- [ ] **Step 3: Implementar em `src/utils/classify.js`**

Após `RULES_ARQ` (linha 36):

```js
const AREAS_TAP = ['Tapeçaria', 'Cortinas', 'Persianas'];

const RULES_TAP = {
  Tapeçaria: ['tapecaria', 'tapercaria', 'tapete'],
  Cortinas: ['cortina', 'cortineiro', 'voil'],
  Persianas: ['persiana'],
};

const AREAS_EST = ['Estofado', 'Sofás'];

const RULES_EST = {
  Estofado: ['estofado', 'impermeabiliz', 'reforma de sofa'],
  Sofás: ['sofa', 'poltron'],
};
```

`rulesFor` (linha 38) vira:

```js
function rulesFor(category) {
  if (category === 'arquitetura') return { areas: AREAS_ARQ, rules: RULES_ARQ, fallback: 'Outros' };
  if (category === 'tapecaria') return { areas: AREAS_TAP, rules: RULES_TAP, fallback: 'Geral' };
  if (category === 'estofado') return { areas: AREAS_EST, rules: RULES_EST, fallback: 'Geral' };
  return { areas: AREAS, rules: RULES, fallback: 'Geral' };
}
```

- [ ] **Step 4: Rodar testes**

Run: `node --test src/tests/classify.test.js` → PASS
Run: `npm test` → verde completo

- [ ] **Step 5: Commit**

```bash
git add src/utils/classify.js src/tests/classify.test.js
git commit -m "feat: classificador com areas/regras para tapeçaria e estofado"
```

---

### Task 3: sync multi-tipo — planUpsert (TDD)

**Files:**
- Modify: `scripts/sync-supabase.js` (`toRow`, `syncLeads`, novas funções)
- Test: `src/tests/sync.test.js`

**Interfaces:**
- Consumes: `tagOf`, `typeList` de `src/utils/categories.js`.
- Produces:
  - `placeIdOrHash(lead)→string` — `place_id` quando existir, senão sha1 (o `id` do row).
  - `planUpsert(newRows, existingRows)→{ inserts: Row[], patches: [{id, set}], deletes: string[] }` — **pura**.
  - `syncLeads({dataDir, category, runBuild})` — mesma assinatura; agora: busca existentes por `place_id IN`/`id IN`, aplica o plano (PATCH não-degradante, DELETE de órfãos, POST em chunks), grava `captures`, roda build.
- Regras do `set` do patch: campos do row novo com valor não-nulo/não-vazio (boolean `false` conta como valor); `source` sempre troca (proveniência da última captura); `types` = união ordenada dos candidatos + novo; `status`/`notes`/`last_contact_at` do banco **nunca** entram no set; quando o row novo tem `place_id` e o alvo tem id sha1, o set inclui `id ← place_id` (nunca há conflito: se outro row já tiver aquele id, ele é candidato e vira o alvo preferido).

- [ ] **Step 1: Testes falhando**

Adicionar ao final de `src/tests/sync.test.js`:

```js
test('placeIdOrHash prefere place_id e cai para sha1', () => {
  const { placeIdOrHash, leadId } = require('../../scripts/sync-supabase');
  const a = { name: 'Loja', address: 'Rua A', place_id: '0x1:0x9' };
  const b = { name: 'Loja', address: 'Rua A' };
  assert.strictEqual(placeIdOrHash(a), '0x1:0x9');
  assert.strictEqual(placeIdOrHash(b), leadId(b));
});

test('planUpsert: negócio novo vira insert', () => {
  const { planUpsert, toRow } = require('../../scripts/sync-supabase');
  const nr = toRow({ name: 'Nova', address: 'Rua B', source: 'tapecaria' });
  nr.types = 'tapecaria';
  const plan = planUpsert([nr], []);
  assert.strictEqual(plan.inserts.length, 1);
  assert.strictEqual(plan.patches.length, 0);
  assert.strictEqual(plan.deletes.length, 0);
});

test('planUpsert: existente com mesmo place_id ganha patch não-degradante + types unidos', () => {
  const { planUpsert, toRow } = require('../../scripts/sync-supabase');
  const novo = toRow({ name: 'Loja Y', address: 'QI 1', source: 'estofado', phone: '', rating: '4,8', reviews: '12' });
  novo.place_id = '0x2:0x9';
  novo.types = 'estofado';
  const existente = { id: '0x2:0x9', place_id: '0x2:0x9', types: 'tapecaria', source: 'tapecaria' };
  const plan = planUpsert([novo], [existente]);
  assert.strictEqual(plan.inserts.length, 0);
  const p = plan.patches[0];
  assert.strictEqual(p.id, '0x2:0x9');
  assert.strictEqual(p.set.types, 'estofado,tapecaria');
  assert.strictEqual(p.set.phone, undefined);          // null não degrada
  assert.strictEqual(p.set.rating, 4.8);               // valor novo entra
  assert.strictEqual(p.set.source, 'estofado');        // proveniência atualiza
  assert.ok(!('status' in p.set));                     // status intocado
  assert.deepStrictEqual(plan.deletes, []);
});

test('planUpsert: row sha1 antigo do mesmo lugar migra o id para place_id e órfão é deletado', () => {
  const { planUpsert, toRow, leadId } = require('../../scripts/sync-supabase');
  const novo = toRow({ name: 'Loja Z', address: 'SAAN', source: 'tapecaria' });
  novo.place_id = '0x3:0x9';
  novo.types = 'tapecaria';
  const antigo = { id: leadId({ name: 'Loja Z', address: 'SAAN' }), place_id: null, types: 'advogados', source: 'advogados' };
  const plan = planUpsert([novo], [antigo]);
  assert.strictEqual(plan.patches[0].id, antigo.id);
  assert.strictEqual(plan.patches[0].set.id, '0x3:0x9');
  assert.strictEqual(plan.patches[0].set.types, 'advogados,tapecaria');
  assert.deepStrictEqual(plan.deletes, []);
});
```

Obs.: `toRow({rating:'4,8'})` → `num('4,8')` = 4.8; `phone:''` → `normPhone('')` = null (campo some do patch).

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/tests/sync.test.js`
Expected: FAIL — `placeIdOrHash is not a function` / `planUpsert is not a function`

- [ ] **Step 3: Implementar em `scripts/sync-supabase.js`**

No topo, junto aos imports existentes:

```js
const { tagOf } = require('../src/utils/categories');
```

Trocar a linha do `id` em `toRow` (linha 65):

```js
function placeIdOrHash(l) {
  const pid = l.place_id && String(l.place_id).trim();
  return pid || leadId(l);
}
```

e em `toRow`: `id: placeIdOrHash(l)` (substitui `id: leadId(l)`).

Novas funções (após `dedupeRows`):

```js
function planUpsert(newRows, existing) {
  const inserts = [], patches = [], deletes = [];
  for (const nr of newRows) {
    const hash = leadId(nr);
    const pid = nr.place_id || null;
    const cands = existing.filter((e) =>
      e.id === nr.id || e.id === hash || (pid && e.place_id === pid)
    );
    if (!cands.length) { inserts.push(nr); continue; }
    const target =
      cands.find((e) => pid && e.id === pid) ||
      cands.find((e) => pid && e.place_id === pid) ||
      cands[0];
    const set = {};
    for (const [k, v] of Object.entries(nr)) {
      if (k === 'id' || k === 'types') continue;
      if (v === null || v === undefined || v === '') continue;
      set[k] = v;
    }
    set.source = nr.source;
    const candTypes = cands.flatMap((e) => String(e.types || e.source || '').split(','));
    set.types = [...new Set([...candTypes, ...(nr.types || '').split(',')].filter(Boolean))].sort().join(',');
    if (pid && target.id !== pid) set.id = pid;
    patches.push({ id: target.id, set });
    for (const e of cands) if (e.id !== target.id) deletes.push(e.id);
  }
  return { inserts, patches, deletes };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function inList(values) {
  return values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',');
}

async function fetchExisting(rows) {
  const pids = [...new Set(rows.map((r) => r.place_id).filter(Boolean))];
  const ids = [...new Set(rows.map((r) => r.id))];
  const out = new Map();
  for (const c of chunk(pids, 60)) {
    const rs = await sbFetch(`leads?select=id,place_id,types,source&place_id=in.(${inList(c)})`);
    for (const r of rs || []) out.set(r.id, r);
  }
  for (const c of chunk(ids, 80)) {
    const rs = await sbFetch(`leads?select=id,place_id,types,source&id=in.(${inList(c)})`);
    for (const r of rs || []) out.set(r.id, r);
  }
  return [...out.values()];
}
```

Reescrever `syncLeads` (linhas 124-144) mantendo assinatura/retorno:

```js
async function syncLeads({ dataDir, category = 'advogados', runBuild = true } = {}) {
  if (!sbEnabled()) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY não configurados');
  const dir = dataDir || path.join(__dirname, '..', 'data');
  const file = newestLeadsFile(dir, category);
  if (!file) throw new Error(`nenhum JSON de leads (${category}) em ${dir}`);
  const leads = JSON.parse(fs.readFileSync(file, 'utf8')).filter(isLead);
  const tag = tagOf(category);
  const rows0 = leads.map((l) => {
    const row = toRow(l);
    row.source = tag;
    row.types = tag;
    return row;
  });
  const { rows, dropped } = dedupeRows(rows0);
  const existing = await fetchExisting(rows);
  const plan = planUpsert(rows, existing);
  for (const p of plan.patches) {
    await sbFetch(`leads?id=eq.${encodeURIComponent(p.id)}`, {
      method: 'PATCH', body: p.set, headers: { Prefer: 'return=minimal' },
    });
  }
  for (const c of chunk(plan.deletes, 80)) {
    await sbFetch(`leads?id=in.(${inList(c)})`, { method: 'DELETE' });
  }
  await upsertRows(plan.inserts);
  await sbFetch('captures', {
    method: 'POST',
    body: [{ status: 'done', finished_at: new Date().toISOString(), leads_count: rows.length }],
  });
  if (runBuild) execFileSync(process.execPath, [path.join(__dirname, 'build-web-data.js')], { stdio: 'inherit' });
  return { file: path.basename(file), synced: rows.length, deduped: dropped };
}
```

Exportar as funções novas: `module.exports = { norm, leadId, placeIdOrHash, planUpsert, toRow, normPhone, cleanAddr, isLead, dedupeRows, upsertRows, syncLeads };`

- [ ] **Step 4: Rodar testes**

Run: `node --test src/tests/sync.test.js` → PASS
Run: `npm test` → verde completo

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-supabase.js src/tests/sync.test.js
git commit -m "feat: sync multi-tipo — placeIdOrHash, planUpsert (insert/patch não-degradante/union de types), id migra para place_id"
```

---

### Task 4: repair e refill nas 4 categorias

**Files:**
- Modify: `scripts/repair-data.js:17-21`
- Modify: `scripts/capture-refill.js:9-13,25`

**Interfaces:**
- Consumes: `CAT_KEYS`, `tagOf` de `src/utils/categories.js`.

- [ ] **Step 1: repair — iterar registro**

Em `scripts/repair-data.js`, trocar o loop binário:

```js
const { CAT_KEYS, tagOf } = require('../src/utils/categories');

for (const category of CAT_KEYS) {
  const file = newestLeadsFile(dir, category);
  if (!file) { console.warn(`[repair] sem JSON de leads p/ ${category} em ${dir}`); continue; }
  const tag = tagOf(category);
  // ... resto igual, usando `tag` no lugar dos ternários antigos
}
```

- [ ] **Step 2: refill — não filtrar por categoria**

Em `scripts/capture-refill.js`, a query de pendentes (linha 13) fica sem recorte de source (refill vale para qualquer tipo; a coluna `types` é preservada porque o upsert do refill manda só `row` — `types` não está em `toRow`, então o banco mantém o valor; **atenção**: `merge-duplicates` só sobrescreve colunas enviadas, então `types` nunca sai no payload do refill):

```js
`leads?select=id,name,address,website,types,source&and=(phone.is.null,email.is.null,instagram.is.null)&order=id&limit=${lim}`
```

e a linha 25: `const row = toRow({ ...r, ...lead, source: r.source });` — não mudar mais nada (o `row.id = r.id` da linha 26 continua preservando o id do banco).

- [ ] **Step 3: Rodar testes**

Run: `npm test` → verde (repair não tem teste de I/O; refill tem stubs que devem continuar passando)

- [ ] **Step 4: Commit**

```bash
git add scripts/repair-data.js scripts/capture-refill.js
git commit -m "feat: repair itera as 4 categorias; refill cobre todos os tipos preservando types"
```

---

### Task 5: Queries e runners Tapeçaria/Estofado + registro no servidor

**Files:**
- Create: `scripts/queries-tapecaria.js`
- Create: `scripts/queries-estofado.js`
- Create: `scripts/capture-tapecaria.js`
- Create: `scripts/capture-estofado.js`
- Modify: `package.json` (scripts)
- Modify: `scripts/serve-web.js:90-109,196-212` (startCapture + catOf via registro)
- Modify: `api/queries.js` (parâmetro category via registro)

**Interfaces:**
- Produces: `QUERIES_TAP` (string[]), `QUERIES_EST` (string[]); runners no padrão de `capture-arquitetura.js`; npm scripts `capture:tap`, `capture:est`.

- [ ] **Step 1: `scripts/queries-tapecaria.js`**

```js
/* Queries da categoria tapeçaria — DF inteiro, priorizando alto poder aquisitivo */
const RAS_TIER1 = [
  'Lago Sul', 'Lago Norte', 'Asa Sul', 'Asa Norte', 'Plano Piloto',
  'Águas Claras', 'Cruzeiro', 'Park Way', 'Jardim Botânico',
];

const RAS_TIER2 = [
  'Guará', 'Sobradinho', 'Sobradinho II', 'Paranoá', 'Núcleo Bandeirante',
  'Santa Maria', 'Samambaia', 'Taguatinga', 'Ceilândia', 'Gama',
  'Brazlândia', 'Itapoã', 'Estrutural', 'Sol Nascente',
];

const TERM_TAP = 'tapeçaria';

const QUERIES_TAP = [...RAS_TIER1, ...RAS_TIER2].map((ra) => `${TERM_TAP} ${ra} Brasília DF`);

module.exports = { QUERIES_TAP, RAS_TIER1, RAS_TIER2 };
```

- [ ] **Step 2: `scripts/queries-estofado.js`**

Mesma estrutura: `TERM_EST = 'estofado'`, `QUERIES_EST = [...RAS_TIER1, ...RAS_TIER2].map((ra) => `${TERM_EST} ${ra} Brasília DF`)`, exportando `QUERIES_EST, RAS_TIER1, RAS_TIER2` (listas duplicadas são aceitas — YAGNI p/ extrair módulo compartilhado).

- [ ] **Step 3: runners (padrão `capture-arquitetura.js`)**

`scripts/capture-tapecaria.js`:

```js
/* Runner da categoria tapeçaria — mesmo pipeline da captura principal.
   Uso: npm run capture:tap */
process.env.BASENAME = 'tapecaria-df-max';
process.env.CAPTURE_CATEGORY = 'tapecaria';
process.env.QUERIES = process.env.QUERIES || require('./queries-tapecaria').QUERIES_TAP.join('|');

const { main } = require('./capture-advogados-df');

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

`scripts/capture-estofado.js`: idem com `BASENAME = 'estofado-df-max'`, `CAPTURE_CATEGORY = 'estofado'`, `QUERIES_EST`.

- [ ] **Step 4: `package.json` — scripts**

```json
"capture:tap": "node scripts/capture-tapecaria.js",
"capture:est": "node scripts/capture-estofado.js"
```

- [ ] **Step 5: `serve-web.js` via registro**

No topo: `const { CATEGORIES } = require('../src/utils/categories');`

`catOf` (linha 26) aceita as 4 chaves (default `advogados`):

```js
function catOf(params) {
  const c = params.get('category');
  return CATEGORIES[c] ? c : 'advogados';
}
```

`startCapture` (linhas 90-109) usa o registro para script/queries:

```js
function startCapture(category = 'advogados') {
  const st = jobStatus();
  if (st.status === 'running') return { code: 409, body: { error: 'already_running', job: st } };
  const cfg = CATEGORIES[category] || CATEGORIES.advogados;
  const queries = require(cfg.queriesModule)[cfg.queriesExport];
  const effective = process.env.QUERIES ? process.env.QUERIES.split('|').filter(Boolean) : queries;
  const out = fs.openSync(JOB_LOG, 'w');
  const err = fs.openSync(JOB_ERR, 'w');
  const child = spawn(process.execPath, [path.join(__dirname, cfg.script)], {
    detached: true, stdio: ['ignore', out, err],
    cwd: path.join(__dirname, '..'), env: process.env,
  });
  const job = { pid: child.pid, started_at: new Date().toISOString(), queries: effective.length, category: cfg.tag, log: path.basename(JOB_LOG) };
  fs.writeFileSync(JOB_FILE, JSON.stringify(job, null, 2));
  child.unref();
  return { code: 202, body: { ok: true, job: { ...job, status: 'running', done: 0, total: job.queries } } };
}
```

POST `/api/capture` (linha 200-201): `let cat = category; try { const j = JSON.parse(body || '{}'); if (CATEGORIES[j.category]) cat = j.category; } catch {}` — e `category` do `qs` (linha 166) continua vindo do `catOf` agora com 4 chaves.

GET `/api/queries` (linha 206-212):

```js
const cfg = CATEGORIES[category] || CATEGORIES.advogados;
const queries = require(cfg.queriesModule)[cfg.queriesExport];
json(res, 200, { queries, category: cfg.tag });
```

- [ ] **Step 6: `api/queries.js` — categoria via query string**

```js
const { CATEGORIES } = require('../src/utils/categories');
// ...
const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
const cfg = CATEGORIES[qs.get('category')] || CATEGORIES.advogados;
const { [cfg.queriesExport]: queries } = require(`../scripts/${cfg.queriesModule.replace('./', '')}`);
json(res, 200, { queries, category: cfg.tag });
```

- [ ] **Step 7: Validar queries por contrato (sem captura ainda)**

Run:
```powershell
node -e "const a=require('./scripts/queries-tapecaria').QUERIES_TAP; const b=require('./scripts/queries-estofado').QUERIES_EST; console.log(a.length, b.length, a[0], b[0], a[a.length-1])"
```
Expected: mesmo número (≈23), `a[0]` = `tapeçaria Lago Sul Brasília DF`, último = `... Sol Nascente Brasília DF`.

Run: `npm test` → verde.
Extra: subir servidor temporário na 8902 (`$env:PORT=8902; node scripts/serve-web.js`) e bater em `GET /api/queries?category=tapecaria` (com cookie de sessão — ou apenas checar 401 vs 500 para provar que o require do módulo não estoura) — depois matar o servidor.

- [ ] **Step 8: Commit**

```bash
git add scripts/queries-tapecaria.js scripts/queries-estofado.js scripts/capture-tapecaria.js scripts/capture-estofado.js package.json scripts/serve-web.js api/queries.js
git commit -m "feat: captura tapeçaria/estofado (RAs priorizados) + registro de categorias no servidor"
```

---

### Task 6: `/api/leads` unificado (Supabase + `?type=` + buildPayload 'all')

**Files:**
- Modify: `scripts/serve-web.js:111-120,183,191-193` (`livePayload` → Supabase)
- Modify: `api/leads.js`
- Modify: `src/utils/metrics.js:304-330` (`buildPayload` com `category:'all'`) e `buildTop` (linha 165-188: expõe `types`)

**Interfaces:**
- Consumes: `matchesType`, `typeOfLead`, `typeList` de `src/utils/categories.js`; `sbFetchAll` de `src/utils/sb.js`.
- Produces: `GET /api/leads[?type=all|advogados|arquitetura|tapecaria|estofado]` → payload com todos os campos atuais + `pool[].types: string[]`; `buildPayload(leads, { category: 'all' })` classifica `area` por tipo do próprio lead e varre todos os arquivos em `buildRecent`/`buildDelta`.
- Fallback offline do cliente (`bootOfflineFallback`) não muda.

- [ ] **Step 1: Teste falhando — buildTop expõe types e buildPayload 'all'**

Adicionar a `src/tests/metrics.test.js`:

```js
test('buildTop expõe types (array) com fallback para source', () => {
  const { buildTop } = require('../utils/metrics');
  const rows = [
    { id: 'a', name: 'Loja A', address: 'Q 1', types: 'tapecaria,estofado', phone: '61999998888', rating: 5, reviews: 10 },
    { id: 'b', name: 'Escritório B', address: 'Q 2', source: 'advogados', phone: '61999997777', rating: 5, reviews: 9 },
    { id: 'c', name: 'Ateliê C', address: 'Q 3', source: 'estofado', phone: '61999996666', rating: 5, reviews: 8 },
  ];
  const top = buildTop(rows, 3);
  const byId = Object.fromEntries(top.map((t) => [t.id, t]));
  assert.deepStrictEqual(byId.a.types, ['tapecaria', 'estofado']);
  assert.deepStrictEqual(byId.b.types, ['advogados']);
  assert.deepStrictEqual(byId.c.types, ['estofado']);
});

test("buildPayload category 'all': area vem do tipo do próprio lead", () => {
  const { buildPayload } = require('../utils/metrics');
  const rows = [
    { id: '1', name: 'Estofados Rio', address: 'Guará, Brasília - DF', source: 'estofado', phone: '61333334444', rating: 4, reviews: 3 },
  ];
  const p = buildPayload(rows, { dataDir: require('node:path').join(__dirname, '..', '..', 'data'), category: 'all' });
  assert.strictEqual(p.areas.find((a) => a.area === 'Estofado').n, 1);
  assert.ok(p.top[0].types.includes('estofado'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/tests/metrics.test.js` — FAIL (`types` undefined / area errada)

- [ ] **Step 3: `src/utils/metrics.js`**

Topo (junto aos require existentes): `const { typeList, typeOfLead } = require('./categories');`

Em `buildTop`, no objeto de saída (linha 165) adicionar:

```js
types: typeList(l),
```

Em `buildPayload` (linha 304):

```js
function buildPayload(leads, opts = {}) {
  const dataDir = opts.dataDir;
  const category = opts.category || 'advogados';
  const fallbackTs = opts.fallbackTs;
  let prepared = prepare(leads);
  if (category === 'all') {
    prepared = prepared.map((l) => ({ ...l, area: l.area || classifyLead(l, typeOfLead(l)).area }));
  } else if (category === 'arquitetura') {
    prepared = prepared.map((l) => ({ ...l, area: l.area || classifyLead(l, category).area }));
  }
  // ... resto como está (stats, top, pool, delta, areas, recent — todos já recebem `category`
  //    e o matchCategory 'all' da Task 1 faz buildRecent/buildDelta varrerem tudo)
}
```

(`areaDistribution(prepared, category)` com `'all'`: mudar `areaDistribution` (linha 84-87) para classificar por lead quando `category === 'all'`: `classifyLead(l, category === 'all' ? typeOfLead(l) : category)`.)

- [ ] **Step 4: `api/leads.js` — sem filtro de source + `?type=`**

```js
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetchAll, SbError } = require('../src/utils/sb');
const { buildPayload } = require('../src/utils/metrics');
const { matchesType } = require('../src/utils/categories');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
  const type = qs.get('type') || 'all';
  try {
    const rows = await sbFetchAll('leads?select=*&order=id');
    const filtered = (rows || []).filter((r) => matchesType(r, type));
    const payload = buildPayload(filtered, { dataDir: '/tmp', category: 'all' });
    payload.source = 'supabase';
    json(res, 200, payload);
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    console.error('[api/leads]', e);
    json(res, 500, { error: 'internal' });
  }
};
```

- [ ] **Step 5: `serve-web.js` — `livePayload` lê Supabase**

Remover `readLeads` (linhas 30-42) e o `newestLeadsFile` import se ficarem sem uso. No topo adicionar `const { sbFetchAll } = require('../src/utils/sb');` e `const { matchesType } = require('../src/utils/categories');` (manter `SbError` já importado).

Substituir `livePayload` (111-120):

```js
let payloadCache = { at: 0, type: null, payload: null };

async function livePayload(type = 'all') {
  const now = Date.now();
  if (payloadCache.payload && payloadCache.type === type && now - payloadCache.at < 5000) return payloadCache.payload;
  const rows = await sbFetchAll('leads?select=*&order=id');
  const filtered = (rows || []).filter((r) => matchesType(r, type));
  const payload = buildPayload(filtered, { dataDir: DATA, category: 'all' });
  payload.source = 'supabase';
  payloadCache = { at: now, type, payload };
  return payload;
}
```

Pontos de chamada:
- `/api/leads` (linha 191-193): `json(res, 200, await livePayload(qs.get('type') || 'all'))` com catch: `if (e instanceof SbError) json(res, 503, { error: 'supabase_down' }) else json(res, 500, { error: e.message })`.
- `/api/insight` (linha 183): `formatContext(await livePayload('all'))` — remover o bloco `if (j.category === 'arquitetura')` (linha 179) e a variável `cat`.

- [ ] **Step 5b: delta em modo 'all' pareia a mesma categoria (ruling pós-review Task 6)**

`buildDelta(dataDir,'all')` não pode comparar arquivos de categorias diferentes (ex.: tapecaria 40 vs arquitetura 1233 → −97% sem sentido). Regra: em `'all'`, achar o arquivo mais recente, derivar o prefixo de categoria dele (`tapecaria-`/`estofado-`/`arquitetura-`, senão `advogados`) e aplicar a lógica das duas capturas mais recentes **dentro dessa categoria** (feed `recent` continua varrendo tudo — é cronológico). TDD: teste novo RED→GREEN.

- [ ] **Step 6: Testes**

Run: `node --test src/tests/metrics.test.js` → PASS
Run: `npm test` → verde
Smoke manual: `Invoke-WebRequest http://localhost:8901/api/leads?type=tapecaria` (servidor 8901 existente recarrega código? **não** — é processo antigo; validar via servidor temporário na 8902: `$env:PORT=8902; node scripts/serve-web.js`, login com QA_USER/QA_PASS, `?type=all` vs `?type=arquitetura` — contagens diferentes — e depois matar). Registrar contagens no report.

- [ ] **Step 7: Commit**

```bash
git add scripts/serve-web.js api/leads.js src/utils/metrics.js src/tests/metrics.test.js
git commit -m "feat: /api/leads unificado via Supabase com filtro ?type= + buildPayload all"
```

---

### Task 7: UI global — type-switch no topbar + select de captura

**Files:**
- Modify: `web/index.html:45-47` (cat-switch → type-switch), `:75` (card de captura ganha `#capCat`)
- Modify: `web/app.js:77-91,144,841,906-936` (estado/refetch)
- Modify: `web/styles.css:277-278,355-359` (seletores + badges de opção)
- Modify: `api/insight.js` (divergência descoberta na Task 6 — insight da prod ainda filtra `source=eq/neq.arquitetura` e faz o mapping binário da linha 15; unificar: remover o filtro de source e o ternário da linha 18, `buildPayload(rows, { dataDir: '/tmp', category: 'all' })`, ignorar `b.category` — idem ao insight local pós-Task 6)

**Interfaces:**
- Consumes: `GET /api/leads?type=` da Task 6; `CATEGORIES` labels duplicados como constante no cliente.
- Produces: estado `typeFilter` (sessionStorage `vs_type`, default `'all'`), `captureCat` (sessionStorage `vs_capture_cat`, default `'advogados'`); `syncTypeUI()`; comportamento: clicar em Tipo → `loadLeads()` refaz o payload inteiro (KPIs/fila/tabela re-renderizam via `boot(d)`).

- [ ] **Step 0: `api/insight.js` unificado (1 arquivo, escopo Task 6 descoberto)**

Trocar linhas 15 e 18-19 por: sem mapping binário de `b.category` (remover linha 15 e o `category` do ternário); `const rows = await sbFetchAll('leads?select=*&order=id');` e `buildPayload(rows || [], { dataDir: '/tmp', category: 'all' })`. `history`/`askGroq`/eros permanecem. `npm test` verde (há teste de insight em `src/tests/api.test.js` — atualizar expectativa do filtro removido se necessário, preservando as asserções de resposta).

- [ ] **Step 1: `web/index.html` — trocar o toggle (linhas 45-47)**

```html
<div class="type-switch" id="typeSwitch" role="group" aria-label="Tipo de lead">
  <button type="button" class="type-btn active" data-type="all" aria-pressed="true" title="Todos os tipos">Todos</button>
  <button type="button" class="type-btn" data-type="advogados" aria-pressed="false" title="Advogados">Adv</button>
  <button type="button" class="type-btn" data-type="arquitetura" aria-pressed="false" title="Arquitetura">Arq</button>
  <button type="button" class="type-btn" data-type="tapecaria" aria-pressed="false" title="Tapeçaria">Tap</button>
  <button type="button" class="type-btn" data-type="estofado" aria-pressed="false" title="Estofado">Est</button>
</div>
```

Card de captura (após o `<strong id="capTitle">`, linha 75):

```html
<label class="cap-cat" for="capCat"><span class="sr-only">Categoria da captura</span>
  <select id="capCat">
    <option value="advogados">Advogados</option>
    <option value="arquitetura">Arquitetura</option>
    <option value="tapecaria">Tapeçaria</option>
    <option value="estofado">Estofado</option>
  </select>
</label>
```

- [ ] **Step 2: `web/app.js` — estado novo**

Substituir linhas 77-91:

```js
var typeFilter = 'all';
try { var vt = sessionStorage.getItem('vs_type'); if (vt) typeFilter = vt; } catch (e) {}
var captureCat = 'advogados';
try { var vc = sessionStorage.getItem('vs_capture_cat'); if (vc) captureCat = vc; } catch (e) {}
function syncTypeUI() {
  var box = document.getElementById('typeSwitch');
  if (box) {
    var btns = box.querySelectorAll('.type-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-type') === typeFilter;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  var sel = document.getElementById('capCat');
  if (sel) sel.value = captureCat;
  var t = document.getElementById('capTitle');
  var labels = { advogados: 'Advocacia', arquitetura: 'Arquitetura', tapecaria: 'Tapeçaria', estofado: 'Estofado' };
  if (t) t.textContent = 'Captura — ' + (labels[captureCat] || 'Advocacia');
}
```

Linha 144 (`startCapture`): body vira `{ category: captureCat }`.
Linha 841 (insight): remover `category: category` do body.
Linha 907 (`loadLeads`): `fetch('/api/leads?type=' + typeFilter, { cache: 'no-store' })`.

Substituir o handler `.cat-switch` (linhas 922-936):

```js
syncTypeUI();
var typeBox = document.getElementById('typeSwitch');
if (typeBox) {
  typeBox.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.type-btn') : null;
    if (!b) return;
    var t = b.getAttribute('data-type');
    if (t === typeFilter) return;
    typeFilter = t;
    try { sessionStorage.setItem('vs_type', t); } catch (err) {}
    syncTypeUI();
    loadLeads();
  });
}
var capSel = document.getElementById('capCat');
if (capSel) {
  capSel.addEventListener('change', function () {
    captureCat = capSel.value;
    try { sessionStorage.setItem('vs_capture_cat', captureCat); } catch (err) {}
    syncTypeUI();
  });
}
```

- [ ] **Step 3: `web/styles.css` — renomear seletores + estilo do select**

Trocar `.cat-switch`/`.cat-btn` por `.type-switch`/`.type-btn` nas linhas 277-278 e 355-359 (mesmas regras; `margin-left:auto` preservado). Adicionar:

```css
.cap-cat{margin-left:auto;display:inline-flex}
.cap-cat select{height:30px;background:var(--surface);border:1px solid var(--border);border-radius:9px;color:var(--text);font:inherit;font-size:12.5px;font-weight:600;padding:0 8px;cursor:pointer}
```

- [ ] **Step 4: Probe Playwright (servidor próprio 8902, script em %TEMP%\opencode\probe\, apagar depois)**

Checks: (1) após login, `#typeSwitch` com 5 botões e "Todos" ativo; (2) `.cat-switch` ausente; (3) `#capCat` presente com 4 options e `#capTitle` = "Captura — Advocacia"; (4) KPI total no modo Todos = soma das contagens; (5) clicar "Arq" → recarrega e KPI total cai (número extraído do DOM, registrado no report); (6) `sessionStorage.vs_type` persiste após reload; (7) `POST /api/capture` spyado (interceptar, não disparar de verdade) recebe `category` igual ao select ao trocar select para "Tapeçaria" e clicar Nova captura (interceptar fetch, abortar). `npm test` verde.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/app.js web/styles.css
git commit -m "feat: type-switch global no topbar (?type= em tudo) + select de categoria na captura"
```

---

### Task 8: Coluna Tipo na tabela + badges

**Files:**
- Modify: `web/table.js` (COLS, CELLS, sortVal, matches/search)
- Modify: `web/styles.css` (badges)

**Interfaces:**
- Consumes: `pool[].types: string[]` (Task 6), `TIPO_LABEL` local.
- Produces: coluna "Tipo" (w 10) entre `area` e `status`; cada célula: badges `<span class="tipo t-<tag>">Label</span>`; sort por labels concatenados; a busca global da tabela casa também contra os labels de tipo.

- [ ] **Step 1: `web/table.js`**

Perto do `COLS`/`CELLS` (padrão existente do arquivo):

```js
var TIPO_LABEL = { advogados: 'Advogado', arquitetura: 'Arquitetura', tapecaria: 'Tapeçaria', estofado: 'Estofado' };
var TIPO_ORDER = ['advogados', 'arquitetura', 'tapecaria', 'estofado'];
```

- `COLS`: inserir `{ k: 'tipo', label: 'Tipo', w: 10 }` logo após a coluna `area` (e a remoção correspondente em `COLS_NO_DATE`/lista de colunas sem data — seguir o padrão `optional` existente se aplicável; Tipo NÃO é optional: sempre renderiza, com fallback para `l.status`... não — fallback: se `types` ausente, usar `['advogados']`).
- `CELLS.tipo`:

```js
tipo: function (l) {
  var types = (l.types && l.types.length ? l.types : ['advogados']).slice();
  types.sort(function (a, b) { return TIPO_ORDER.indexOf(a) - TIPO_ORDER.indexOf(b); });
  return types.map(function (t) {
    var label = TIPO_LABEL[t] || t;
    return '<span class="tipo t-' + esc(t) + '">' + esc(label) + '</span>';
  }).join(' ');
}
```

- `sortVal` para `tipo`: `return TIPO_LABEL[(l.types && l.types[0]) || 'advogados'] || '';`
- Haystack da busca (`matches` / filtro de texto existente): incluir `types.map(t => TIPO_LABEL[t] || t).join(' ')` quando o campo de busca casar com nome/área — seguir a estrutura atual de `q` (se o texto livre casa nome+área, acrescentar labels de tipo ao haystack).

- [ ] **Step 2: `web/styles.css`**

```css
.tipo{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:.02em;border:1px solid transparent;white-space:nowrap}
.tipo.t-advogados{background:rgba(56,132,255,.14);color:#7aa7ff;border-color:rgba(56,132,255,.32)}
.tipo.t-arquitetura{background:rgba(56,189,248,.12);color:var(--cyan);border-color:rgba(56,189,248,.3)}
.tipo.t-tapecaria{background:rgba(244,114,182,.13);color:#f472b6;border-color:rgba(244,114,182,.32)}
.tipo.t-estofado{background:rgba(52,211,153,.12);color:var(--green);border-color:rgba(52,211,153,.3)}
```

- [ ] **Step 3: Probe Playwright (8902)**

Checks: (1) header da tabela tem "Tipo"; (2) células com badges (classe `.tipo` presente, labels corretos para tags conhecidas do payload); (3) clicar no header ordena por Tipo e não quebra outras colunas; (4) busca por "Tapeçaria" no campo de texto encontra leads do tipo; (5) lead sem `types` renderiza badge "Advogado". `npm test` verde.

- [ ] **Step 4: Commit**

```bash
git add web/table.js web/styles.css
git commit -m "feat: coluna Tipo na base de leads com badges por categoria"
```

---

### Task 9: QA final + smoke real + deploy

**Files:**
- Modify: nenhum (validação); log em `.superpowers/sdd/` ou report do task.

**Interfaces:**
- Consome tudo das Tasks 1-8.

- [ ] **Step 1: Suíte completa**

Run: `npm test` → 100% verde (base 114 + novos).

- [ ] **Step 2: Smoke de captura real Tapeçaria (1 query)**

```powershell
$env:QUERIES='tapeçaria Lago Sul Brasília DF'; node scripts/capture-tapecaria.js
```
(Env reseta por sessão — rodar em processo próprio. Esperado: pelo menos 1 lead salvo em `data/tapecaria-df-max*.json` e sync para o Supabase com `types='tapecaria'`.)

Validação no banco:
```js
sbFetch("leads?select=id,name,types,source&types=like.*tapecaria*&limit=5")
```
→ linhas novas com `types` contendo `tapecaria`; business recapturado do mesmo lugar **não** duplicou (conferir contagem total antes/depois).

- [ ] **Step 3: Smoke Estofado (1 query)**

Idem com `$env:QUERIES='estofado Lago Sul Brasília DF'; node scripts/capture-estofado.js` + conferência `types=like.*estofado*`.

- [ ] **Step 4: Probe de ponta a ponta (8902)**

(1) payload `?type=tapecaria` contém os leads do smoke; (2) type-switch filtra KPIs+fila+conferir com contagens do payload; (3) coluna Tipo mostra "Tapeçaria"; (4) fila "Contatar hoje" some/aparece coerente com o filtro; (5) capture select dispara script certo (spy); (6) sem regressão: chips sem-site/contatáveis, status, IA (`/api/insight` com payload unificado).

- [ ] **Step 5: Deploy + verificação produção**

```powershell
vercel deploy --prod
```
Depois (verificar): `https://virgo-scout.vercel.app/app.js` contém "typeSwitch"; `/api/leads?type=arquitetura` (autenticado via cookie de sessão — ou validar pelo least: HTML serve e assets 200); vídeo do login intacto (`assets/videos/...mp4` → 200).

- [ ] **Step 6: Commit final + narrativa**

Se houver ajustes: commits pequenos por correção. Report final ao usuário com: contagens por tipo, comandos das rodadas max-DF (`npm run capture:tap` / `capture:est`), e nota de que o deploy Git da Vercel segue parado (usar CLI).

---

## Self-review do plano (feito na escrita)

1. **Spec coverage:** §1 → Tasks 6-8 (payload unificado, topbar, coluna, select de captura); §2 → Tasks 2, 5, 9; §3 → Task 3 (+ 0005 já aplicada); §4 riscos → Task 9 (smoke + monitorar volume); §5 testes → steps de teste em cada task + probes Task 7/8/9. ✓
2. **Placeholders:** nenhum TBD/TODO; todos os passos de código têm código. ✓
3. **Consistência de tipos:** `types` é `string[]` no payload (buildTop) e `string` no banco (vírgula) — conversions via `typeList` (server) e split no cliente (Task 8 usa `l.types` array). `matchesType` recebe row do banco (string) ✓; `TIPO_LABEL` usa as mesmas 4 tags do registro ✓.
