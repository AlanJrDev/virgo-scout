/* Sobe o JSON de leads local para o Supabase (upsert) e registra o job em captures.
   npm run sync  |  automático ao fim da captura (se sbEnabled) */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sbEnabled, sbFetch } = require('../src/utils/sb');
const { newestLeadsFile } = require('../src/utils/leads-io');

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

/* Artefato de paginação do Google Maps ("Resultados") ou nome vazio não é lead —
   mesma regra do prepare() dos metrics (evita id colidindo entre categorias). */
function isLead(l) {
  const name = String((l && l.name) || '').trim();
  return !!name && !/^resultados?$/i.test(name);
}

function toRow(l) {
  return {
    id: leadId(l),
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
  const tag = category === 'arquitetura' ? 'arquitetura' : 'advogados';
  const rows0 = leads.map((l) => {
    const row = toRow(l);
    row.source = tag;
    return row;
  });
  const { rows, dropped } = dedupeRows(rows0);
  await upsertRows(rows);
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

module.exports = { norm, leadId, toRow, normPhone, cleanAddr, isLead, dedupeRows, upsertRows, syncLeads };
