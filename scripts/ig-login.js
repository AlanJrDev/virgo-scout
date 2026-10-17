/* Login una vez por máquina no Instagram. npm run ig-login (ou node scripts/ig-login.js)
   Abre janela visível; detecta o login e salva a sessão em auth/ig-state.json. */
require('dotenv').config();
const { launchBrowser } = require('../src/scraper/mapsScraper');
const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, '..', 'auth', 'ig-state.json');

function _ensureAuthDir() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
}

async function detectarLogin(page) {
  return new Promise((resolve) => {
    const fim = Date.now() + 15 * 60 * 1000;
    let ocupado = false;
    const timer = setInterval(async () => {
      if (ocupado) return;
      if (Date.now() > fim) {
        clearInterval(timer);
        resolve(false);
        return;
      }
      ocupado = true;
      let achou = false;
      try {
        achou = await page.locator('svg[aria-label="Página inicial"]').first().isVisible();
      } catch (e) { achou = false; }
      if (!achou) {
        try {
          achou = (await page.locator('img[alt*="foto de perfil"], img[alt*="profile picture"]').count()) > 0;
        } catch (e) { achou = false; }
      }
      if (!achou) {
        try {
          const cookies = await context.cookies('https://www.instagram.com/');
          achou = cookies.some((c) => c.name === 'sessionid' && c.value && c.value.length > 10);
        } catch (e) { achou = false; }
        if (achou) {
          try {
            achou = (await page.locator('svg[aria-label="Página inicial"], img[alt*="foto de perfil"], img[alt*="profile picture"]').count()) > 0;
          } catch (e) { achou = false; }
        }
      }
      ocupado = false;
      if (achou) {
        clearInterval(timer);
        resolve(true);
      }
    }, 2000);
  });
}

async function main() {
  _ensureAuthDir();
  let browser, context, page;
  try {
    ({ browser, context, page } = await launchBrowser({ headless: false }));
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    console.log('[ig-login] faça o login na janela aberta; o script detecta e salva a sessão');
    const detectado = await detectarLogin(page);
    if (detectado) {
      const state = await context.storageState({ path: statePath });
      console.log('[ig-login] sessão salva em auth/ig-state.json');
    } else {
      console.error('[ig-login] tempo esgotado (15 min) sem detectar login');
    }
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) main().catch((e) => { console.error('[ig-login]', e); process.exit(1); });
module.exports = { main };
