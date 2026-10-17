/* WhatsApp pela bio do Instagram (batch). npm run enrich:ig-wa [limite]
   Só leads SEM whatsapp e COM instagram. Resumível por igw_checked_at (migration 0008).
   Abre o perfil com a sessão salva (auth/ig-state.json; npm run ig-login primeiro). */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sbFetch } = require('../src/utils/sb');
const { handleFrom } = require('../src/enrich/instagram');
const { waFromBio } = require('../src/enrich/ig-bio');
const { launchBrowser } = require('../src/scraper/mapsScraper');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const statePath = path.join(__dirname, '..', 'auth', 'ig-state.json');

async function main() {
  const limit = parseInt(process.argv[2] || '30', 10);
  const rows = (await sbFetch(`leads?select=id,name,instagram&instagram=not.is.null&whatsapp=is.null&igw_checked_at=is.null&order=id&limit=${limit}`)) || [];
  if (!rows.length) { console.log('[enrich:ig-wa] nada a checar (todos verificados ou sem instagram)'); return; }
  console.log(`[enrich:ig-wa] ${rows.length} perfis a checar`);
  if (!fs.existsSync(statePath)) { console.error('[enrich:ig-wa] sem auth/ig-state.json — rode npm run ig-login antes'); process.exit(1); }

  let browser, context, page;
  let achados = 0, ok = 0;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    ({ browser, context, page } = await launchBrowser({ headless: false }));
    await context.addCookies(state.cookies);
    for (const r of rows) {
      const handle = handleFrom(r.instagram);
      const patch = { igw_checked_at: new Date().toISOString() };
      if (!handle) {
        console.log(`[enrich:ig-wa] ${r.name} — instagram inválido (${r.instagram})`);
      } else {
        try {
          await page.goto('https://www.instagram.com/' + encodeURIComponent(handle) + '/', { waitUntil: 'domcontentloaded' });
        } catch (e) { console.error(`[enrich:ig-wa] goto ${handle}: ${e.message}`); }
        await page.waitForTimeout(2200);
        try {
          const hrefsText = await page.evaluate(() => {
            const raw = Array.from(document.querySelectorAll('a[href]')).map((a) => a.href || '').join(' ');
            return raw.length > 60000 ? raw.slice(0, 60000) : raw;
          }).catch(() => '');
          const html = await page.content();
          const got = waFromBio({ html, links: [], hrefsText }) || waFromBio({ html });
          if (got) {
            patch.whatsapp = got.digits;
            achados++;
            console.log(`[enrich:ig-wa] ${r.name} — WA ${got.digits} (via ${got.via}, @${handle})`);
          } else {
            console.log(`[enrich:ig-wa] ${r.name} — sem WA na bio (@${handle})`);
          }
        } catch (e) {
          console.error(`[enrich:ig-wa] leitura ${handle}: ${e.message}`);
        }
      }
      try {
        await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch });
        ok++;
      } catch (e) {
        if (/igw_checked_at/.test(e.message)) {
          console.error('[enrich:ig-wa] coluna igw_checked_at ausente — aplique supabase/migrations/0008 no SQL Editor'); process.exit(1);
        }
        console.error(`[enrich:ig-wa] erro ${r.id}: ${e.message}`);
      }
      await sleep(3000);
    }
  } finally {
    if (browser) await browser.close();
  }
  console.log(`[enrich:ig-wa] concluído: ${ok}/${rows.length} verificados, ${achados} com WA na bio`);
}

if (require.main === module) main().catch((e) => { console.error('[enrich:ig-wa]', e.message); process.exit(1); });
module.exports = { main };
