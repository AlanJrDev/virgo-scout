/* Sanidade do motor sobre a base real: distribuição de fit/icp e motivos.
   npm run qualify:stats — puro, não grava. Insumo para calibrar weights.js. */
require('dotenv').config();
const { sbFetchAll } = require('../src/utils/sb');
const { qualify } = require('../src/qualify/engine');

async function main() {
  const rows = await sbFetchAll(
    'leads?select=id,name,phone,whatsapp,website,instagram,email,reviews,rating,claimed,since_year,closed,site_audit,ads_active,ig_last_post&order=id'
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
