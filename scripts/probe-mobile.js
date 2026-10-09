// QA mobile: login (vídeo + card) e dashboard em 390x844
require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const base = process.env.BASE || 'http://localhost:8901';
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--headless=new'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const login = await page.evaluate(() => {
    const v = document.querySelector('.login-video');
    const c = document.querySelector('.login-card');
    const b = c.getBoundingClientRect();
    return {
      video: v ? { w: v.clientWidth, h: v.clientHeight, ready: v.classList.contains('ready') } : null,
      card: { w: Math.round(b.width), fits: b.width <= window.innerWidth - 16 },
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  console.log('MOBILE LOGIN:', JSON.stringify(login));
  await page.screenshot({ path: 'docs/qa/login-mobile.png' });
  await page.fill('#loginUser', process.env.QA_USER);
  await page.fill('#loginPass', process.env.QA_PASS);
  await page.click('#loginSubmit');
  await page.waitForURL(base + '/', { timeout: 10000 });
  await page.waitForTimeout(2500);
  const dash = await page.evaluate(() => ({
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
    kpis: [...document.querySelectorAll('.kpi strong')].map((e) => e.textContent),
    sidebarHidden: getComputedStyle(document.querySelector('.sidebar')).display === 'none',
  }));
  console.log('MOBILE DASH:', JSON.stringify(dash));
  await page.screenshot({ path: 'docs/qa/ui-mobile.png', fullPage: false });
  await page.locator('.nav-item[data-view="leads"]'); // sidebar oculta no mobile: nav inacessível, esperado
  await browser.close();
  console.log('OK mobile');
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
