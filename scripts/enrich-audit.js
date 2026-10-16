/* Auditoria de site em batch. npm run enrich-audit [limite]
   Resumível: pega leads COM site e sem site_audit. Falha => não grava. */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { auditUrl } = require('../src/qualify/site-audit');
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
