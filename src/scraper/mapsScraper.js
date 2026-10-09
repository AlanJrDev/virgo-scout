const { chromium } = require('playwright');
const { normalizeLead } = require('../utils/leads');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchBrowser(opts = {}) {
  const wantHeadless = opts.headless ?? (process.env.HEADLESS !== 'false');
  // NOTA: headless-shell do Playwright quebra nesta máquina (spawn EFTYPE);
  // usa binário Chromium full com --headless=new (invisível e estável).
  const browser = await chromium.launch({
    headless: wantHeadless ? false : false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      ...(wantHeadless ? ['--headless=new'] : []),
    ],
  });
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  const page = await context.newPage();
  return { browser, context, page };
}

// Scroll do feed até exaustão: condição de parada = 3 stalls seguidos + teto maxScrolls
async function scrollFeedToEnd(page, { maxScrolls = 60, stallLimit = 4 } = {}) {
  const feedSel = 'div[role="feed"]';
  await page.waitForSelector(feedSel, { timeout: 20000 });
  let lastCount = 0;
  let stalls = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const count = await page.$$eval('a.hfpxzc', (els) => els.length).catch(() => 0);
    if (count > lastCount) {
      lastCount = count;
      stalls = 0;
    } else {
      stalls++;
    }
    if (stalls >= stallLimit && i > 8) break;
    await page.$eval(feedSel, (el) => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    }).catch(() => {});
    await sleep(1200);
    // tenta clicar fim da lista p/ forçar carregar mais
    await page.keyboard.press('End').catch(() => {});
    await sleep(400);
  }
  return lastCount;
}

async function extractCards(page, source) {
  return page.$$eval('a.hfpxzc', (anchors, src) => {
    const phoneRe = /(\+?55\s?)?(\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4})/;
    return anchors
      .map((a) => {
        const href = a.getAttribute('href') || '';
        // ignora âncoras de cabeçalho ("Resultados", voltar, etc.): só places reais
        if (!/\/maps\/place\//.test(href)) return null;
        const label = (a.getAttribute('aria-label') || '').trim();
        if (!label || /^resultados?$/i.test(label)) return null;
        const card = a.closest('div[class*="Nv2PK"]') || a.parentElement;
        const text = card ? card.innerText : '';
        let rating = null;
        let reviews = null;
        const m = text.match(/(\d[,.]\d)\s*\(([\d.]+)\)/);
        if (m) {
          rating = m[1];
          reviews = m[2];
        }
        // telefone quase sempre aparece no texto do card — captura aqui como hint
        let phoneHint = '';
        const pm = text.match(phoneRe);
        if (pm) phoneHint = pm[0].trim();
        return { name: label, rating, reviews, address: '', phone: '', website: '', source: src, _phoneHint: phoneHint };
      })
      .filter(Boolean);
  }, source).catch(() => []);
}

// Abre cada card p/ detalhe e extrai telefone/site/endereço — otimizado p/ máximo com timeout curto
async function enrichWithDetails(page, leads, { maxDetails = 120, perLeadTimeoutMs = 9000 } = {}) {
  const enriched = [];
  const cards = await page.$$('a.hfpxzc');
  const total = Math.min(cards.length, leads.length, maxDetails);
  for (let i = 0; i < total; i++) {
    const base = leads[i];
    try {
      const card = await page.$$(`a.hfpxzc`).then((els) => els[i]).catch(() => null);
      if (!card) {
        enriched.push(base);
        continue;
      }
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.click({ timeout: 5000 }).catch(() => {});
      // espera painel de detalhe: h1 com nome
      await page.waitForSelector('h1', { timeout: 6000 }).catch(() => {});
      await sleep(900);
      const detail = await page.evaluate(() => {
        const txt = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
        const name = txt('h1.DUwDvf') || txt('h1');
        // endereço: botão data-item-id=address
        let address = '';
        const addrBtn = document.querySelector('button[data-item-id="address"]');
        if (addrBtn) address = (addrBtn.querySelector('.Io6YTe')?.innerText || addrBtn.innerText).trim();
        // telefone: usa o href tel: (innerText costuma ser só o glifo do ícone)
        let phone = '';
        const telA = document.querySelector('a[href^="tel:"]');
        if (telA) phone = (telA.getAttribute('href') || '').replace(/^tel:/, '').trim();
        if (!phone) {
          const telBtn = document.querySelector('button[data-item-id^="tel:"]');
          if (telBtn) phone = (telBtn.querySelector('.Io6YTe')?.innerText || telBtn.innerText).trim();
        }
        // site
        let website = '';
        const siteA = document.querySelector('a[data-item-id="authority"]');
        if (siteA) website = siteA.getAttribute('href') || '';
        // rating no detalhe
        let rating = '';
        let reviews = '';
        const bodyText = document.body.innerText.slice(0, 20000);
        const m = bodyText.match(/(\d[,.]\d)\s*[\n ]+([\d.]+)\s*avalia/);
        if (m) {
          rating = m[1];
          reviews = m[2];
        }
        // categoria: botão após o h1 (fallback: jsaction category)
        let category = '';
        const catBtn = document.querySelector('button.DkEaL') || document.querySelector('button[jsaction*="category"]');
        if (catBtn) category = catBtn.innerText.trim();
        // plus code: mesmo padrão do endereço
        let plus_code = '';
        const olocBtn = document.querySelector('button[data-item-id="oloc"]');
        if (olocBtn) plus_code = (olocBtn.querySelector('.Io6YTe')?.innerText || olocBtn.innerText).trim();
        // redes sociais: âncoras externas além do authority
        let instagram = '';
        let facebook = '';
        document.querySelectorAll('a[data-item-id^="http"], a[href*="instagram.com"], a[href*="facebook.com"]').forEach((a) => {
          const h = a.getAttribute('href') || '';
          if (/instagram\.com\//.test(h) && !instagram) instagram = h;
          if (/facebook\.com\//.test(h) && !facebook) facebook = h;
        });
        // texto do painel para sinais (não-reclamado primeiro: "claim this business" contém "claim")
        // Perfis reclamados não exibem mais "Perfil reclamado" — sinais de dono (resposta/foto do
        // proprietário) são o marcador atual de perfil reclamado; sem sinal algum → null (desconhecido)
        const panel = bodyText;
        let claimed = null;
        if (/reivindicar este perfil|reivindique este perfil|claim this business/i.test(panel)) claimed = false;
        else if (/perfil reclamado|perfil propriedade do titular|resposta do proprietário|do proprietário|\bclaimed\b/i.test(panel)) claimed = true;
        const closed = /fechado (definitivamente|permanentemente)|encerrado/i.test(panel);
        let hours = '';
        const hm = panel.match(/aberto[^\n]{0,40}fecha[^\n\d]{0,10}(\d{1,2}:\d{2})/i);
        if (hm) hours = 'Aberto ⋅ Fecha ' + hm[1];
        let photos = null;
        const gal = document.querySelector('button[aria-label*="Fotos"], button[aria-label*="photos" i]');
        if (gal) { const pm = (gal.getAttribute('aria-label') || '').match(/(\d+)/); if (pm) photos = parseInt(pm[1], 10); }
        // geo + place_id vêm da própria URL do painel
        const mUrl = (location.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || []);
        const pId = (location.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/) || [])[1] || '';
        const lat = mUrl[1] || '';
        const lng = mUrl[2] || '';
        return { name, address, phone, website, rating, reviews, category, plus_code, instagram, facebook, claimed, closed, hours, photos, lat, lng, place_id: pId };
      });
      enriched.push(
        normalizeLead({
          name: detail.name || base.name,
          rating: detail.rating || base.rating,
          reviews: detail.reviews || base.reviews,
          address: detail.address || base.address,
          phone: detail.phone || base._phoneHint || '',
          website: detail.website || '',
          source: base.source,
          category: detail.category || base.category || '',
          plus_code: detail.plus_code || base.plus_code || '',
          lat: detail.lat || base.lat || '',
          lng: detail.lng || base.lng || '',
          place_id: detail.place_id || base.place_id || '',
          claimed: detail.claimed !== undefined && detail.claimed !== null ? detail.claimed : (base.claimed ?? null),
          hours: detail.hours || base.hours || '',
          closed: detail.closed || base.closed || false,
          photos: detail.photos !== undefined && detail.photos !== null ? detail.photos : (base.photos ?? null),
          instagram: detail.instagram || base.instagram || '',
          facebook: detail.facebook || base.facebook || '',
        })
      );
      // volta p/ lista
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
      await sleep(700);
    } catch (e) {
      enriched.push(normalizeLead(base));
    }
    if ((i + 1) % 10 === 0) await sleep(800);
  }
  // se sobraram leads além do maxDetails, inclui sem detalhe
  for (let i = total; i < leads.length; i++) enriched.push(normalizeLead(leads[i]));
  return enriched;
}

async function scrapeQuery(page, query, opts = {}) {
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // aceita consent se aparecer
  await page.getByRole('button', { name: /aceitar|accept|concordo/i }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForSelector('a.hfpxzc, div[role="feed"]', { timeout: 20000 });
  await sleep(1500);
  const found = await scrollFeedToEnd(page, { maxScrolls: opts.maxScrolls ?? 60 });
  const cards = await extractCards(page, query);
  const enriched = await enrichWithDetails(page, cards, { maxDetails: opts.maxDetails ?? 120 });
  return { query, foundCards: found, leads: enriched };
}

async function scrapeMany(queries, opts = {}) {
  const { browser, page } = await launchBrowser(opts);
  const all = [];
  try {
    for (const q of queries) {
      try {
        console.log(`[scraper] buscando: ${q}`);
        const r = await scrapeQuery(page, q, opts);
        console.log(`[scraper] "${q}" -> ${r.leads.length} leads (cards: ${r.foundCards})`);
        all.push(...r.leads);
        await sleep(2000);
      } catch (e) {
        console.error(`[scraper] falha em "${q}": ${e.message}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return all;
}

module.exports = { launchBrowser, scrapeQuery, scrapeMany, scrollFeedToEnd };
