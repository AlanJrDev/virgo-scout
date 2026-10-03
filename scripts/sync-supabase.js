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

function toRow(l) {
  return {
    id: leadId(l),
    name: l.name || null,
    rating: l.rating ?? null,
    reviews: l.reviews ?? null,
    address: l.address || null,
    phone: l.phone || null,
    website: l.website || null,
    source: l.source || null,
    area: l.area || null,
    area_conf: l.area_conf ?? null,
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

module.exports = { norm, leadId, syncLeads };
