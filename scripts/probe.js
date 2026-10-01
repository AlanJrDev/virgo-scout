const { chromium } = require('playwright');
(async () => {
  const mode = process.env.PROBE_HEADLESS === 'false' ? false : true;
  console.log('[probe] headless=', mode);
  const browser = await chromium.launch({ headless: mode, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://example.com', { timeout: 20000 });
  console.log('[probe] title=', await page.title());
  await browser.close();
  console.log('[probe] OK');
})().catch((e) => { console.error('[probe] FAIL', e.message); process.exit(1); });
