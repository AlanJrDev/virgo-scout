/* Detecta anúncio ativo por lead (Adstransparency do Google via Playwright).
   npm run enrich:ads [limite] — Resumível por ads_checked_at. Falha => grava só ads_checked_at (unknown). */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { parseAdsHtml } = require('../src/enrich/ads');
const { launchBrowser } = require('../src/scraper/mapsScraper');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const domainOf = (site) => {
  let d = String(site || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const m = d.match(/^([a-z0-9-]+\.)+[a-z]{2,}/i);
  return m ? m[0].replace(/\/.*$/, '') : null;
};

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const rows = (await sbFetch(`leads?select=id,website&website=not.is.null&ads_checked_at=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:ads] ${rows.length} leads a checar`);
  let ativos = 0, unknown = 0, ok = 0;
  const { browser, page } = await launchBrowser({ headless: true });
  try {
    for (const r of rows) {
      const d = domainOf(r.website);
      const patch = { ads_checked_at: new Date().toISOString() };
      if (!d) { console.log(`[enrich:ads] sem domínio ${r.id}`); }
      else {
        try {
          await page.goto(`https://adstransparency.google.com/?region=BR&domain=${encodeURIComponent(d)}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(6000);
          const res = parseAdsHtml(await page.content());
          if (res && res.active === true) { patch.ads_active = true; if (res.landing) patch.ads_landing = res.landing; ativos++; }
          else if (res && res.active === false) { patch.ads_active = false; }
          else unknown++;
        } catch (e) {
          console.error(`[enrich:ads] erro ${r.id}: ${e.message}`);
          unknown++;
        }
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
