/* Sobe o JSON de leads local para o Supabase (upsert) e registra o job em captures.
   npm run sync  |  automático ao fim da captura (se sbEnabled) */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sbEnabled, sbFetch } = require('../src/utils/sb');
const { newestLeadsFile } = require('../src/utils/leads-io');
const { tagOf } = require('../src/utils/categories');

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
  return {
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

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sbFetch('leads?on_conflict=id', {
      method: 'POST',
      body: rows.slice(i, i + CHUNK),
      headers: { Prefer: 'resolution=merge-duplicates' },
    });
  }
}

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

if (require.main === module) {
  const category = process.argv[2] || 'advogados';
  syncLeads({ category })
    .then((r) => console.log(`[sync] ${r.synced} leads${r.deduped ? ` (${r.deduped} duplicados removidos)` : ''} → Supabase (${r.file})`))
    .catch((e) => { console.error('[sync]', e.message); process.exit(1); });
}

module.exports = { norm, leadId, placeIdOrHash, planUpsert, toRow, normPhone, cleanAddr, isLead, dedupeRows, upsertRows, syncLeads };
