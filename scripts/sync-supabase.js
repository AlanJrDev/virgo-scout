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

function toRow(l) {
  return {
    id: leadId(l),
    name: l.name || null,
    rating: num(l.rating),
    reviews: int(l.reviews),
    address: l.address || null,
    phone: l.phone || null,
    website: l.website || null,
    source: l.source || null,
    area: l.area || null,
    area_conf: num(l.area_conf),
    captured_at: l.captured_at || null,
  };
}

async function syncLeads({ dataDir, runBuild = true } = {}) {
  if (!sbEnabled()) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY não configurados');
  const dir = dataDir || path.join(__dirname, '..', 'data');
  const file = newestLeadsFile(dir);
  if (!file) throw new Error(`nenhum JSON de leads em ${dir}`);
  const leads = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = leads.map(toRow);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sbFetch('leads?on_conflict=id', {
      method: 'POST',
      body: rows.slice(i, i + CHUNK),
      headers: { Prefer: 'resolution=merge-duplicates' },
    });
  }
  await sbFetch('captures', {
    method: 'POST',
    body: [{ status: 'done', finished_at: new Date().toISOString(), leads_count: rows.length }],
  });
  if (runBuild) execFileSync(process.execPath, [path.join(__dirname, 'build-web-data.js')], { stdio: 'inherit' });
  return { file: path.basename(file), synced: rows.length };
}

if (require.main === module) {
  syncLeads()
    .then((r) => console.log(`[sync] ${r.synced} leads → Supabase (${r.file})`))
    .catch((e) => { console.error('[sync]', e.message); process.exit(1); });
}

module.exports = { norm, leadId, toRow, syncLeads };
