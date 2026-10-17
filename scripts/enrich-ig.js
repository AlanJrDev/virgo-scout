/* Instagram em batch. npm run enrich:ig [limite]
   Resumível por ig_checked_at. Muro de login => grava só ig_checked_at.
   Com auth/ig-state.json usa Playwright com sessão (headful); sem state, fetch cru. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sbFetch } = require('../src/utils/sb');
const { fetchIg, parseIgProfile, handleFrom } = require('../src/enrich/instagram');
const { launchBrowser } = require('../src/scraper/mapsScraper');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const statePath = path.join(__dirname, '..', 'auth', 'ig-state.json');

async function main() {
  const limit = parseInt(process.argv[2] || '40', 10);
  const rows = (await sbFetch(`leads?select=id,instagram&instagram=not.is.null&ig_checked_at=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:ig] ${rows.length} perfis a checar`);
  let ok = 0, dados = 0, blocked = 0;
  if (fs.existsSync(statePath)) {
    let browser, context, page;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      ({ browser, context, page } = await launchBrowser({ headless: false }));
      await context.addCookies(state.cookies);
      for (const r of rows) {
        const handle = handleFrom(r.instagram);
        let info = null;
        if (handle) {
          try {
            await page.goto('https://www.instagram.com/' + encodeURIComponent(handle) + '/', { waitUntil: 'domcontentloaded' });
          } catch (e) { console.error(`[enrich:ig] goto ${handle}: ${e.message}`); }
          await page.waitForTimeout(2500);
          info = parseIgProfile(await page.content());
        }
        const patch = { ig_checked_at: new Date().toISOString() };
        if (info && !info.blocked) {
          if (info.followers != null) patch.ig_followers = info.followers;
          if (info.posts != null) patch.ig_posts = info.posts;
          if (info.last_post) patch.ig_last_post = info.last_post;
          dados++;
        } else blocked++;
        try {
          await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch });
          ok++;
        } catch (e) { console.error(`[enrich:ig] erro ${r.id}: ${e.message}`); }
        await sleep(3000);
      }
    } finally {
      if (browser) await browser.close();
    }
  } else {
    for (const r of rows) {
      const res = await fetchIg(r.instagram);
      const patch = { ig_checked_at: new Date().toISOString() };
      if (res && !res.blocked) {
        if (res.followers != null) patch.ig_followers = res.followers;
        if (res.posts != null) patch.ig_posts = res.posts;
        if (res.last_post) patch.ig_last_post = res.last_post;
        dados++;
      } else blocked++;
      try {
        await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch });
        ok++;
      } catch (e) { console.error(`[enrich:ig] erro ${r.id}: ${e.message}`); }
      await sleep(1200);
    }
  }
  console.log(`[enrich:ig] concluído: ${ok} ok, ${dados} com dados, ${blocked} blocked`);
}

if (require.main === module) main().catch((e) => { console.error('[enrich:ig]', e.message); process.exit(1); });
module.exports = { main };
