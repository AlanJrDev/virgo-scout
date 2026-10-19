/* Sobe o JSON de leads local para o Supabase (upsert) e registra o job em captures.
   npm run sync  |  automático ao fim da captura (se sbEnabled) */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sbEnabled, sbFetch } = require('../src/utils/sb');
const { newestLeadsFile } = require('../src/utils/leads-io');
const { tagOf, relevanceFilter } = require('../src/utils/categories');

const CHUNK = 500;

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function leadId(lead) {
  return crypto.createHash('sha1').update(`${norm(lead.name)}|${norm(lead.address)}`).digest('hex');
}

/* Dado bruto do Maps pode vir "4,5" (vírgula BR) ou "1.234" (milhar) — normaliza p/ numeric/int */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function int(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  let s = String(v).trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* Telefone BR → dígitos sem 55/0 inicial; dado inválido é preservado (não degrada) */
function normPhone(v) {
  if (v === null || v === undefined || v === '') return null;
  let d = String(v).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length <= 12) d = d.slice(1);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d.length >= 8 ? d : String(v).trim();
}

function cleanAddr(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ');
  return s || null;
}

/* Artefato de paginação do Google Maps ("Resultados"), nome vazio ou lead "fantasma"
   (só nome, sem place_id/endereço/telefone/site/IG/email) não é lead. */
function isLead(l) {
  const name = String((l && l.name) || '').trim();
  if (!name || /^resultados?$/i.test(name)) return false;
  return !!(l.place_id || l.address || l.phone || l.website || l.instagram || l.email);
}

function placeIdOrHash(l) {
  const pid = l.place_id && String(l.place_id).trim();
  return pid || leadId(l);
}

function toRow(l) {
  const row = {
    id: placeIdOrHash(l),
    name: l.name || null,
    rating: num(l.rating),
    reviews: int(l.reviews),
    address: cleanAddr(l.address),
    phone: normPhone(l.phone),
    website: l.website || null,
    source: l.source || null, // o chamador troca pela tag de categoria
    origin: l.source || null, // query original da captura (contexto do classificador)
    area: l.area || null,
    area_conf: num(l.area_conf),
    captured_at: l.captured_at || null,
    category: l.category || null,
    plus_code: l.plus_code || null,
    lat: num(l.lat),
    lng: num(l.lng),
    place_id: l.place_id || null,
    claimed: typeof l.claimed === 'boolean' ? l.claimed : null,
    hours: l.hours || null,
    photos: int(l.photos),
    closed: l.closed === true,
    instagram: l.instagram || null,
    facebook: l.facebook || null,
    whatsapp: String(l.whatsapp || '').replace(/\D/g, '') || null,
  };
  if (row.whatsapp) row.wa_source = 'maps'; // origem do zap: página do place no Maps
  return row;
}

/* Dedupe por id (nome+endereço normalizados): mantém a linha mais rica
   (mais reviews; empate → website/telefone) e reporta quantas caiu. */
function richer(a, b) {
  const ra = a.reviews || 0, rb = b.reviews || 0;
  if (ra !== rb) return ra > rb;
  const wa = (a.website ? 1 : 0) + (a.phone ? 1 : 0);
  const wb = (b.website ? 1 : 0) + (b.phone ? 1 : 0);
  return wa > wb;
}

function dedupeRows(rows) {
  const byId = new Map();
  let dropped = 0;
  for (const r of rows) {
    const cur = byId.get(r.id);
    if (!cur) { byId.set(r.id, r); continue; }
    dropped++;
    if (richer(r, cur)) byId.set(r.id, r);
  }
  return { rows: [...byId.values()], dropped };
}

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

async function upsertRows(rows) {
  let waWarned = false;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    try {
      await sbFetch('leads?on_conflict=id', {
        method: 'POST',
        body: batch,
        headers: { Prefer: 'resolution=merge-duplicates' },
      });
    } catch (e) {
      if (!/wa_/.test(String(e.message || ''))) throw e;
      const slim = batch.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('wa_'))));
      if (slim.every((r, idx) => Object.keys(r).length === Object.keys(batch[idx]).length)) throw e;
      if (!waWarned) {
        console.warn('[sync] colunas wa_* ausentes — aplique supabase/migrations/0010 no SQL Editor (salvando sem elas)');
        waWarned = true;
      }
      await sbFetch('leads?on_conflict=id', {
        method: 'POST',
        body: slim,
        headers: { Prefer: 'resolution=merge-duplicates' },
      });
    }
  }
}

async function syncLeads({ dataDir, category = 'advogados', runBuild = true, capture = null } = {}) {
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
  const topRows = rows0.length ? relevanceFilter(rows0, tag).kept : rows0;
  const { rows, dropped } = dedupeRows(topRows);
  const relevanceDropped = rows0.length - topRows.length;
  const existing = await fetchExisting(rows);
  const plan = planUpsert(rows, existing);
  for (const p of plan.patches) {
    await patchLead(p.id, p.set);
  }
  for (const c of chunk(plan.deletes, 80)) {
    await sbFetch(`leads?id=in.(${inList(c)})`, { method: 'DELETE' });
  }
  await upsertRows(plan.inserts);
  let orphanDropped = 0;
  try {
    const dbIds = await sbFetch(`leads?select=id&source=eq.${encodeURIComponent(tag)}`);
    const inSet = new Set(rows.map((r) => r.id));
    const orphans = dbIds.map((r) => r.id).filter((id) => !inSet.has(id));
    orphanDropped = orphans.length;
    for (const c of chunk(orphans, 80)) {
      await sbFetch(`leads?id=in.(${inList(c)})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
  } catch (e) { console.error('[sync] limpeza de órfãos falhou:', e.message); }
  let dbDeduped = 0;
  try {
    const d = await require('../src/utils/dedupe').dedupeLeads({ apply: true });
    dbDeduped = d.removed || 0;
  } catch (e) { console.error('[sync] dedupe db falhou:', e.message); }
  await writeCapture(rows.length, capture);
  if (runBuild) execFileSync(process.execPath, [path.join(__dirname, 'build-web-data.js')], { stdio: 'inherit' });
  return { file: path.basename(file), synced: rows.length, deduped: dropped, relevanceDropped, orphanDropped, dbDeduped };
}

/* ===== Captures V2 (telemetria) ===== */

/* Payload da rodada em captures. status 'partial' só vale depois da migration
   0009 (check constraint atual aceita running/done/failed); sem capture →
   payload legado mínimo. qs vai como ARRAY jsonb (não string dupla). */
function captureRecord(leadsCount, cap = null) {
  if (!cap) return { status: 'done', finished_at: new Date().toISOString(), leads_count: leadsCount };
  const raCount = cap.ra_count ?? null;
  return {
    status: cap.partial ? 'partial' : 'done', // partial: true = rodada cortada por budget
    started_at: cap.started_at || null,
    finished_at: new Date().toISOString(),
    leads_count: leadsCount,
    queries: raCount,
    category: cap.category || null,
    budget_min: cap.budget_min ?? null,
    ra_count: raCount,
    qs: Array.isArray(cap.qs) ? cap.qs : [],
  };
}

/* Legado pré-0009: só colunas de 0001; 'partial' vira 'done' (check constraint
   antiga rejeita) — o sidecar <basename>-meta.json é a fonte real do estado. */
function legacyCaptureRecord(record) {
  return {
    status: record.status === 'partial' ? 'done' : record.status,
    started_at: record.started_at ?? null,
    finished_at: record.finished_at,
    leads_count: record.leads_count,
    queries: record.queries ?? null,
  };
}

/* 400 em captures pode SER schema (colunas V2 ausentes: PGRST204/42703/23514,
   relationship) OU constraint violation (status 'partial' pré-0009 → check
   captures_status_check) — ambos pedem o fallback legado. O corpo real do
   PostgREST chega anexado ao e.message pelo sb.js ('sb_400 :: <corpo>'). Como
   400 nesse endpoint raramente é erro de lógica, QUALQUER sb_400 da write
   cai no legado; rethrow só para 401/404/rede/5xx. */
function isCaptureSchemaError(msg) {
  return /\bsb_400\b|PGRST204|42703|23514|schema|column|constraint|relationship|categor|budget|ra_count|\bqs\b/i.test(String(msg || ''));
}

/* captures NÃO tem UNIQUE: idempotência por started_at da rodada — registro
   existente vira PATCH; check-first que falhar segue para POST (pior caso:
   1 registro extra, nunca perca a sincronização por causa disso). */
// > Se houver DUPLICATAS do mesmo started_at, pegamos a 1ª (order implícito)
// > e ignoramos as demais — aceitação consciente: o sync nunca trava por dado
// > sujo, e a 0009 (Task 6) pode criar UNIQUE em started_at.
async function captureRowId(startedAt) {
  if (!startedAt) return null;
  try {
    const rows = await sbFetch(`captures?select=id&started_at=eq.${encodeURIComponent(startedAt)}`);
    return (rows && rows[0] && rows[0].id) || null;
  } catch (e) {
    console.error(`[sync] captures check-first falhou (segue com POST): ${e.message}`);
    return null;
  }
}

async function writeCapture(leadsCount, cap) {
  const record = captureRecord(leadsCount, cap);
  try {
    const id = await captureRowId(record.started_at);
    if (id) {
      await sbFetch(`captures?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: record, headers: { Prefer: 'return=minimal' } });
      return;
    }
    await sbFetch('captures', { method: 'POST', body: [record] });
  } catch (e) {
    if (!isCaptureSchemaError(e.message)) throw e;
    console.error(`[sync] captures sem colunas V2 (migration 0009 pendente?): ${e.message} — tentando payload legado`);
    try {
      const legacy = legacyCaptureRecord(record);
      const id = await captureRowId(record.started_at);
      if (id) {
        await sbFetch(`captures?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: legacy, headers: { Prefer: 'return=minimal' } });
      } else {
        await sbFetch('captures', { method: 'POST', body: [legacy] });
      }
    } catch (e2) {
      console.error(`[sync] captures legado também falhou: ${e2.message}`);
      throw e2;
    }
  }
}

if (require.main === module) {
  const category = process.argv[2] || 'advogados';
  syncLeads({ category })
    .then((r) => console.log(`[sync] ${r.synced} leads (${r.deduped} local${r.dbDeduped ? `, ${r.dbDeduped} no banco` : ''} dedupe${r.relevanceDropped ? `, ${r.relevanceDropped} fora do nicho` : ''}${r.orphanDropped ? `, ${r.orphanDropped} órfãos removidos` : ''}) → Supabase (${r.file})`))
    .catch((e) => { console.error('[sync]', e.message); process.exit(1); });
}

module.exports = { norm, leadId, placeIdOrHash, planUpsert, toRow, normPhone, cleanAddr, isLead, dedupeRows, upsertRows, patchLead, syncLeads, captureRecord, legacyCaptureRecord, writeCapture };
