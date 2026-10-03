/* Reescreve as linhas do banco a partir dos JSONs locais (fonte da verdade):
   origin (query original), tag de categoria em source, telefone/endereço
   normalizados, dedupe por id e áreas reclassificadas com origin.
   Não registra em captures (não é uma captura). Uso: npm run repair */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { sbEnabled } = require('../src/utils/sb');
const { newestLeadsFile } = require('../src/utils/leads-io');
const { toRow, dedupeRows, upsertRows, isLead } = require('./sync-supabase');
const { classifyLead } = require('../src/utils/classify');

async function repair({ dataDir } = {}) {
  if (!sbEnabled()) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY não configurados');
  const dir = dataDir || path.join(__dirname, '..', 'data');
  const out = {};
  for (const category of ['advogados', 'arquitetura']) {
    const file = newestLeadsFile(dir, category);
    if (!file) { console.warn(`[repair] sem JSON de leads p/ ${category} em ${dir}`); continue; }
    const leads = JSON.parse(fs.readFileSync(file, 'utf8')).filter(isLead);
    const tag = category === 'arquitetura' ? 'arquitetura' : 'advogados';
    const rows0 = leads.map((l) => {
      const row = toRow(l);
      row.source = tag;
      const c = classifyLead({ name: row.name, origin: l.source }, category);
      row.area = c.area;
      row.area_conf = c.confidence;
      return row;
    });
    const { rows, dropped } = dedupeRows(rows0);
    await upsertRows(rows);
    const areas = {};
    for (const r of rows) areas[r.area || '(null)'] = (areas[r.area || '(null)'] || 0) + 1;
    out[category] = { rows: rows.length, dropped, areas };
    console.log(`[repair] ${category}: ${rows.length} linhas (−${dropped} dupes) → ${JSON.stringify(areas)}`);
  }
  return out;
}

if (require.main === module) {
  repair()
    .then(() => console.log('[repair] concluído'))
    .catch((e) => { console.error('[repair]', e.message); process.exit(1); });
}

module.exports = { repair };
