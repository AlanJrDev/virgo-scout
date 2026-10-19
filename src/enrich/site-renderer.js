/* Renderiza uma URL em Chromium headless (Playwright, local-only) e devolve o
   DOM pós-JS. Um browser por chamada, fechado no finally — NUNCA coberto pela
   suíte (browser real): chamadores injetam renderImpl stub nos testes. */
const { launchBrowser } = require('../scraper/mapsScraper');

async function renderSite(rawUrl, { timeoutMs = 15000 } = {}) {
  const { browser, page } = await launchBrowser({ headless: true }); // launchBrowser resolve headless=interno (--headless=new)
  try {
    let url = String(rawUrl || '').trim();
    if (!url) return { ok: false, status: null, html: '', links: [], finalUrl: null };
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url; // mesma normalização do analyzer
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => null);
    if (!resp) return { ok: false, status: null, html: '', links: [], finalUrl: null };
    await page.waitForTimeout(2000); // settle de rede/DOM (networkidle nunca dispara em site vivo)
    const html = await page.content();
    const links = await page.$$eval('a[href]', (els) => els.map((e) => e.getAttribute('href'))).catch(() => []);
    return { ok: true, status: resp.status(), html, links, finalUrl: page.url() };
  } finally {
    await browser.close().catch(() => {}); // browser INTEIRO: resource é por domínio/lead
  }
}

module.exports = { renderSite };
