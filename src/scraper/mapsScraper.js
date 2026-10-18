const { chromium } = require('playwright');
const { normalizeLead } = require('../utils/leads');
const { buildDetailQueue } = require('../utils/queue-util');

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
      .map((a, elIdx) => {
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
        // _elIdx: índice do âncora na lista DOM (antes do filtro) — enrichWithDetailsV2
        // usa p/ clicar no card certo mesmo com cabeçalhos filtrados
        return { name: label, rating, reviews, address: '', phone: '', website: '', source: src, _phoneHint: phoneHint, _elIdx: elIdx };
      })
      .filter(Boolean);
  }, source).catch(() => []);
}

// Extrai o painel de detalhe do lugar (página place ou card aberto)
async function readPlaceDetail(page) {
  const d = await page.evaluate(() => {
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
    // redes sociais: apenas âncoras formalmente vinculadas ao place (data-item-id URL).
    // O seletor genérico a[href*="instagram.com"] pegava cards patrocinados/sugeridos
    // (ex.: "Arte e Cores DF"Injected em 14 leads de tapeçaria que não têm essa conta).
    let instagram = '';
    let facebook = '';
    const SOCIAL_RE = /instagram\.com\/([A-Za-z0-9_.]+)/i;
    const SOCIAL_RESERVED = /^(p|reel|reels|explore|stories|accounts|tv|directory)\/?$/i;
    document.querySelectorAll('a[data-item-id^="http"]').forEach((a) => {
      const h = a.getAttribute('href') || '';
      const im = h.match(SOCIAL_RE);
      if (im && !SOCIAL_RESERVED.test(im[1]) && !instagram) instagram = h;
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
    const action_hrefs = [...document.querySelectorAll('a[data-item-id^="action:"], a[href*="wa.me"], a[href*="api.whatsapp"]')].map((a) => a.getAttribute('href') || '');
    return { name, address, phone, website, rating, reviews, category, plus_code, instagram, facebook, claimed, closed, hours, photos, lat, lng, place_id: pId, action_hrefs };
  });
  d.whatsapp = (d.action_hrefs || []).map(waFromHref).find(Boolean) || '';
  delete d.action_hrefs;
  return d;
}

/* Detail otimizado: card el via _elIdx (índice DOM do âncora, sobrevive ao filtro
   de cabeçalhos do extractCards); reconsulta os âncoras a cada lead — o goBack
   destrói os element handles antigos; fora do limite inclui sem detail */
async function enrichWithDetailsV2(page, queue, { maxDetails = 120 } = {}) {
  const enriched = [];
  const limit = Math.min(queue.length, maxDetails);
  for (let i = 0; i < limit; i++) {
    const base = queue[i];
    try {
      const els = await page.$$('a.hfpxzc').catch(() => []);
      const card = els[base._elIdx ?? base._cardIndex] || null;
      if (!card) { enriched.push(pushLead(base, false)); continue; }
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.click({ timeout: 5000 }).catch(() => {});
      // espera painel de detalhe: h1 com nome
      await page.waitForSelector('h1', { timeout: 6000 }).catch(() => {});
      await sleep(900);
      const detail = await readPlaceDetail(page);
      enriched.push(pushLead(base, true, detail));
      // volta p/ lista
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
      await sleep(700);
    } catch (e) {
      enriched.push(pushLead(base, false));
    }
    if ((i + 1) % 10 === 0) await sleep(800);
  }
  // se sobraram leads além do maxDetails, inclui sem detalhe
  for (let i = limit; i < queue.length; i++) enriched.push(pushLead(queue[i], false));
  return enriched;
}

/* Mescla card (base) + detail (d): detail vence, _phoneHint do card resgata
   telefone quando o painel não traz; marca ambiguo/details_done */
function pushLead(base, detailed, d) {
  const n = normalizeLead(d ? {
    name: d.name || base.name, rating: d.rating || base.rating, reviews: d.reviews || base.reviews,
    address: d.address || base.address, phone: d.phone || base._phoneHint || '', website: d.website || '',
    source: base.source, category: d.category || base.category || '', plus_code: d.plus_code || base.plus_code || '',
    lat: d.lat || base.lat || '', lng: d.lng || base.lng || '', place_id: d.place_id || base.place_id || '',
    claimed: d.claimed ?? base.claimed ?? null, hours: d.hours || base.hours || '', closed: d.closed || base.closed || false,
    photos: d.photos ?? base.photos ?? null, instagram: d.instagram || base.instagram || '',
    facebook: d.facebook || base.facebook || '', whatsapp: d.whatsapp || '',
  } : { ...base });
  if (base._ambiguo) n.ambiguo = true;
  n.details_done = !!detailed;
  return n;
}

async function scrapeQuery(page, query, opts = {}) {
  const t0 = Date.now();
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // aceita consent se aparecer ("Concordar"/"Concordo"/"Accept"/"I agree")
  await page.getByRole('button', { name: /aceitar|accept|concord|agree/i }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForSelector('a.hfpxzc, div[role="feed"]', { timeout: 20000 });
  await sleep(1500);
  const found = await scrollFeedToEnd(page, { maxScrolls: opts.maxScrolls ?? 60 });
  const cards = await extractCards(page, query);
  // fase 2: gate de relevância → fila ordenada (match primeiro, ambiguo ao final)
  const relevance = opts.relevance || null; // { category, skipPlaceIds, skipNames }
  const queue = relevance
    ? buildDetailQueue(cards, relevance.category, { skipPlaceIds: relevance.skipPlaceIds, skipNames: relevance.skipNames })
    : cards.map((c, i) => ({ ...c, _cardIndex: i }));
  const relevant = queue.filter((c) => !c._ambiguo).length;
  const ambiguous = queue.filter((c) => c._ambiguo).length;
  const dropped = cards.length - queue.length;
  const enriched = await enrichWithDetailsV2(page, queue, { maxDetails: opts.maxDetails ?? 120 });
  return {
    query,
    foundCards: found,
    leads: enriched,
    telemetry: { cards: cards.length, relevant, ambiguous, dropped, details: Math.min(queue.length, opts.maxDetails ?? 120), seconds: Math.round((Date.now() - t0) / 1000) },
  };
}

/* Refill nominal: busca um lead pelo nome e devolve o detalhe do primeiro card */
async function enrichOneByQuery(page, query, opts = {}) {
  // Busca nominal que casa um place único cai direto na página do lugar (sem feed/cards) —
  // detecta e extrai do painel; senão, caminho normal de feed (scrapeQuery).
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('button', { name: /aceitar|accept|concord|agree/i }).click({ timeout: 3000 }).catch(() => {});
  await sleep(1500);
  const feed = await page.$('div[role="feed"]').catch(() => null);
  const cards = await page.$$('a.hfpxzc').then((els) => els.length).catch(() => 0);
  const hasH1 = await page.$('h1').then((el) => !!el).catch(() => false);
  if (!feed && cards === 0 && hasH1) {
    const d = await readPlaceDetail(page);
    if (d.name) {
      return normalizeLead({
        name: d.name,
        rating: d.rating,
        reviews: d.reviews,
        address: d.address,
        phone: d.phone,
        website: d.website,
        source: query,
        category: d.category || '',
        plus_code: d.plus_code || '',
        lat: d.lat || '',
        lng: d.lng || '',
        place_id: d.place_id || '',
        claimed: d.claimed ?? null,
        hours: d.hours || '',
        closed: d.closed || false,
        photos: d.photos ?? null,
        instagram: d.instagram || '',
        facebook: d.facebook || '',
        whatsapp: d.whatsapp || '',
      });
    }
  }
  const r = await scrapeQuery(page, query, { ...opts, maxDetails: 1 });
  return r.leads[0] || null;
}

async function scrapeMany(queries, opts = {}) {
  const { browser, page } = await launchBrowser(opts);
  const leads = [];
  const telemetry = [];
  try {
    for (const q of queries) {
      try {
        console.log(`[scraper] buscando: ${q}`);
        const r = await scrapeQuery(page, q, opts);
        console.log(`[scraper] "${q}" -> ${r.leads.length} leads (cards: ${r.foundCards}, rel: ${r.telemetry.relevant}, desc: ${r.telemetry.dropped})`);
        leads.push(...r.leads);
        telemetry.push({ query: q, ...r.telemetry });
      } catch (e) {
        console.error(`[scraper] falha em "${q}": ${e.message}`);
        telemetry.push({ query: q, cards: 0, relevant: 0, ambiguous: 0, dropped: 0, details: 0, seconds: 0, failed: true });
      }
      // jitter entre queries: respiro anti-rate-limit do Maps
      await sleep(8000 + Math.floor(Math.random() * 7000));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { leads, telemetry };
}

function waFromHref(href) {
  const h = String(href || '');
  if (!/wa\.me\/|api\.whatsapp\.com/.test(h)) return '';
  const m = h.match(/(?:phone=|wa\.me\/)(\+?\d{6,15})/);
  return m ? m[1].replace('+', '') : '';
}

module.exports = { launchBrowser, scrapeQuery, scrapeMany, scrollFeedToEnd, enrichOneByQuery, waFromHref };
