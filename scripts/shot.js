const { chromium } = require('playwright');
(async () => {
  const [, , url, out, w, h] = process.argv;
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--headless=new'] });
  const page = await browser.newPage({ viewport: { width: +(w || 1536), height: +(h || 1024) } });
  await page.goto(url || 'http://localhost:8901', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: out || 'shot.png', fullPage: false });
  await browser.close();
  console.log('OK ' + (out || 'shot.png'));
})().catch((e) => { console.error(e.message); process.exit(1); });
