/* Recalcula e persiste fit/icp/reach/reasons/why_now de todos os leads.
   npm run qualify — puro sobre as colunas já enriquecidas. */
require('dotenv').config();
const { sbFetchAll, sbFetch } = require('../src/utils/sb');
const { qualify } = require('../src/qualify/engine');

async function main() {
  const rows = await sbFetchAll(
    'leads?select=id,name,phone,whatsapp,website,instagram,email,reviews,rating,claimed,since_year,closed,site_audit,ads_active,ig_last_post&order=id'
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
