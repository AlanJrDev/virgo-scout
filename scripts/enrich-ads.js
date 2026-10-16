/* Detecta anúncio ativo por lead (Ads Transparency). npm run enrich-ads [limite]
   Resumível por ads_checked_at. Falha => grava só ads_checked_at (unknown). */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { checkAds } = require('../src/enrich/ads');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const rows = (await sbFetch(`leads?select=id,name,website&ads_checked_at=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:ads] ${rows.length} leads a checar`);
  let ativos = 0, unknown = 0, ok = 0;
  for (const r of rows) {
    const q = r.name || r.website || '';
    const res = await checkAds(q);
    const patch = { ads_checked_at: new Date().toISOString() };
    if (res) { patch.ads_active = res.active; if (res.landing) patch.ads_landing = res.landing; if (res.active) ativos++; }
    else unknown++;
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch });
      ok++;
    } catch (e) { console.error(`[enrich:ads] erro ${r.id}: ${e.message}`); }
    await sleep(500);
  }
  console.log(`[enrich:ads] concluído: ${ok} ok, ${ativos} com anúncio, ${unknown} unknown`);
}

if (require.main === module) main().catch((e) => { console.error('[enrich:ads]', e.message); process.exit(1); });
module.exports = { main };
