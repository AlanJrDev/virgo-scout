// QA visual interativo: login, desktop, busca com resultados e chat IA respondendo
require('dotenv').config();
const { chromium } = require('playwright');

const QA_USER = process.env.QA_USER;
const QA_PASS = process.env.QA_PASS;
if (!QA_USER || !QA_PASS) { console.error('QA_USER/QA_PASS não definidos no .env'); process.exit(1); }

(async () => {
  const base = process.env.BASE || 'http://localhost:8901';
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--headless=new'] });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });

  // login
  await page.goto(base + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'docs/qa/login-desktop.png' });
  await page.fill('#loginUser', QA_USER);
  await page.fill('#loginPass', QA_PASS);
  await page.click('#loginSubmit');
  await page.waitForURL(base + '/', { timeout: 10000 });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: 'docs/qa/ui-desktop.png' });

  // mapa MapLibre: marcadores + tiles
  const bubbles = await page.locator('.map-bubble').count();
  const tiles = await page.locator('.maplibregl-canvas').count();
  console.log('map bubbles:', bubbles, '| canvas:', tiles);
  await page.locator('.map-card').screenshot({ path: 'docs/qa/ui-map.png' });

  // botões WhatsApp nos destaques
  const waOn = await page.locator('.wa-btn:not(.disabled)').count();
  const waOff = await page.locator('.wa-btn.disabled').count();
  const waHref = await page.locator('.wa-btn:not(.disabled)').first().getAttribute('href').catch(() => null);
  console.log('wa ativos:', waOn, '| sem telefone:', waOff, '| href:', waHref);

  // gráfico em abas
  await page.locator('#chartTabs .chip[data-chart="regioes"]').click();
  await page.waitForTimeout(800);
  const regRows = await page.locator('.bar-row').count();
  console.log('barras regiões:', regRows);
  await page.locator('.row-3 .card').first().screenshot({ path: 'docs/qa/ui-chart.png' });
  await page.locator('#chartTabs .chip[data-chart="areas"]').click();
  await page.waitForTimeout(400);

  // busca
  await page.click('#globalSearch');
  await page.type('#globalSearch', 'cri', { delay: 60 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'docs/qa/ui-search.png' });
  const hits = await page.locator('.sr-item').count();
  console.log('search hits:', hits);

  // tela Base de Leads (nav da sidebar)
  await page.keyboard.press('Escape');
  await page.locator('.nav-item[data-view="leads"]').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'docs/qa/ui-leads.png' });
  const rows = await page.locator('#tblBody tr').count();
  console.log('tabela leads — linhas visíveis:', rows);
  await page.locator('.nav-item[data-view="dashboard"]').click();
  await page.waitForTimeout(400);

  // chat IA
  await page.keyboard.press('Escape');
  await page.fill('#aiInput', 'quantos trabalhistas temos?');
  await page.click('#aiSend');
  await page.waitForTimeout(900);
  await page.fill('#aiInput', 'sem site');
  await page.click('#aiSend');
  await page.waitForTimeout(900);
  const last = await page.locator('#chatLog .msg.assistant').last().innerText();
  console.log('chat answer:', last.slice(0, 120));
  await page.locator('.ia').screenshot({ path: 'docs/qa/ui-chat.png' });

  await browser.close();
  console.log('OK ui-desktop/ui-search/ui-chat');
})().catch((e) => { console.error(e.message); process.exit(1); });
