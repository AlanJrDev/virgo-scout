/* Detecta anúncio ativo por lead (Google search via Playwright). npm run enrich-ads [limite]
   Resumível por ads_checked_at. Falha => grava só ads_checked_at (unknown). */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { parseAdsHtml } = require('../src/enrich/ads');
const { launchBrowser } = require('../src/scraper/mapsScraper');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const rows = (await sbFetch(`leads?select=id,name,website&ads_checked_at=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:ads] ${rows.length} leads a checar`);
  let ativos = 0, unknown = 0, ok = 0;
  const { browser, page } = await launchBrowser({ headless: true });
  try {
    for (const r of rows) {
      const q = r.name || r.website || '';
      const patch = { ads_checked_at: new Date().toISOString() };
      try {
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });
        try { await page.waitForLoadState('domcontentloaded'); } catch {}
        await page.waitForTimeout(2000);
        const res = parseAdsHtml(await page.content());
        if (res && res.active === true && res.landing) { patch.ads_active = true; patch.ads_landing = res.landing; ativos++; }
        else if (res && res.active === false) { patch.ads_active = false; }
        else unknown++;
      } catch (e) {
        console.error(`[enrich:ads] erro ${r.id}: ${e.message}`);
        unknown++;
      }
      try {
        await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch });
        ok++;
      } catch (e) { console.error(`[enrich:ads] erro ${r.id}: ${e.message}`); }
      await sleep(2000);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(`[enrich:ads] concluído: ${ok} ok, ${ativos} com anúncio, ${unknown} unknown`);
}

if (require.main === module) main().catch((e) => { console.error('[enrich:ads]', e.message); process.exit(1); });
module.exports = { main };
