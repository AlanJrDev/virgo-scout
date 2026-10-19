// Testes do site-analyzer (fetch stubado, HTML fixture inline)
const { test } = require('node:test');
const assert = require('node:assert');
const { analyzeSite, extractSignals } = require('../enrich/site-analyzer');
const HTML = `<html><head><title>Souza Advocacia Trabalhista — Brasília</title></head>
  <body><a href="mailto:contato@souzadv.com.br">contato</a>
  <a href="https://instagram.com/souzadv">IG</a>
  <a href="https://wa.me/5561999990000">Zap</a>
  <footer>© 2013 Souza Advocacia. Todos os direitos reservados.</footer></body></html>`;

test('extrai email, instagram, whatsapp e ano de fundação', async () => {
  const s = await analyzeSite('https://souzadv.com.br', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => HTML }) });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.email, 'contato@souzadv.com.br');
  assert.ok(s.instagram.includes('souzadv'));
  assert.strictEqual(s.whatsapp, '5561999990000');
  assert.strictEqual(s.since_year, 2013);
  assert.ok(s.title.includes('Trabalhista'));
  assert.strictEqual(s.final_url, 'https://souzadv.com.br');
  assert.strictEqual(s.whatsapp_hint, true); // link declarado também é presença de padrão
});

test('url sem esquema ganha https; erro de rede vira ok:false', async () => {
  const bad = await analyzeSite('souzadv.com.br', { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.email, null);
  assert.strictEqual(bad.final_url, null);
});

test('descarta emails falsos-positivos comuns', () => {
  const s = extractSignals('<a href="mailto:sentry@example.com">x</a> @fontes png@2x.png');
  assert.strictEqual(s.email, null);
});

test('segmentos reservados só contam com igualdade exata (handles com p/tr sobrevivem)', () => {
  const s = extractSignals(
    '<a href="https://instagram.com/paulo.adv">IG</a>' +
    '<a href="https://facebook.com/travel.adv">FB</a>' +
    '<a href="https://instagram.com/p/ABC123/">post</a>' +
    '<a href="https://facebook.com/sharer.php?u=x">share</a>'
  );
  assert.strictEqual(s.instagram, 'paulo.adv');
  assert.strictEqual(s.facebook, 'travel.adv');
  const r = extractSignals(
    '<a href="https://instagram.com/explore/tags/advocacia">explore</a>' +
    '<a href="https://facebook.com/sharer.php?u=x">share</a>'
  );
  assert.strictEqual(r.instagram, null);
  assert.strictEqual(r.facebook, null);
});

test('wa declarado: atributo href wa.me e api.whatsapp com & e aspas simples', () => {
  const dupla = `<a href="https://wa.me/5561999990000">z</a>`;
  const api = `<a href="https://api.whatsapp.com/send?phone=5561987654321&text=oi">z</a>`;
  const simples = `<a href='https://wa.me/61999990000'>z</a>`;
  const r1 = extractSignals(dupla);
  assert.strictEqual(r1.whatsapp, '5561999990000');
  const r2 = extractSignals(api);
  assert.strictEqual(r2.whatsapp, '5561987654321');
  const r3 = extractSignals(simples);
  assert.strictEqual(r3.whatsapp, '61999990000');
  assert.strictEqual(r1.whatsapp_hint, true);
});

test('texto corrido com wa.me vira whatsapp_hint, NUNCA whatsapp', () => {
  const s = extractSignals('<p>Fale com a gente no wa.me/5561999990000 ou ligue 61 3272-4904</p>');
  assert.strictEqual(s.whatsapp, null);
  assert.strictEqual(s.whatsapp_hint, true);
});

const HOME_SEM_ZAP = '<html><head><title>Escritorio Silva</title></head><body><a href="/contato">Fale conosco</a></body></html>';
const CONTATO_ZAP = '<html><head><title>Contato</title></head><body><a href="https://wa.me/5561999888000">Zap</a></body></html>';

// stub: home na 1ª chamada; páginas com 'contato' na URL recebem CONTATO_ZAP
function stubV2(home, contatoHtml) {
  return async (url) => ({
    url,
    ok: true,
    status: 200,
    text: async () => (String(url).includes('contato') ? (contatoHtml || CONTATO_ZAP) : home),
  });
}

test('v2: home sem zap visita /contato e traz zap com wa_evidence_url da interna', async () => {
  const s = await analyzeSite('https://silva.com', { fetchImpl: stubV2(HOME_SEM_ZAP) });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.whatsapp, '5561999888000');
  assert.strictEqual(s.wa_evidence_url, 'https://silva.com/contato');
  assert.strictEqual(s.whatsapp_hint, true);
  assert.strictEqual(s.pages_visited, 1);
});

test('v2: href relativo (contato.html) resolve contra a final_url da home', async () => {
  const urls = [];
  const s = await analyzeSite('https://silva.com/inicio', {
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { url, ok: true, status: 200, text: async () => (urls.length === 1 ? '<a href="contato.html">Contato</a>' : CONTATO_ZAP) };
    },
  });
  assert.strictEqual(urls[1], 'https://silva.com/contato.html');
  assert.strictEqual(s.whatsapp, '5561999888000');
});

test('v2: wa em texto corrido NUNCA vira whatsapp; só o declarado da interna grava', async () => {
  const s = await analyzeSite('https://serra.com', {
    fetchImpl: async (url) => (String(url).endsWith('/fale')
      ? { url, ok: true, status: 200, text: async () => CONTATO_ZAP }
      : { url, ok: true, status: 200, text: async () => '<p>Chame no wa.me/556177770000 agora mesmo</p><a href="/fale">Fale conosco</a>' }),
  });
  assert.strictEqual(s.whatsapp, '5561999888000');
  assert.strictEqual(s.wa_evidence_url, 'https://serra.com/fale');
  assert.strictEqual(s.whatsapp_hint, true);
});

test('v2: home com zap declarado não visita nada (pages_visited 0)', async () => {
  const urls = [];
  const s = await analyzeSite('https://souzadv.com.br', {
    fetchImpl: async (url) => { urls.push(String(url)); return { url, ok: true, status: 200, text: async () => HTML }; },
  });
  assert.strictEqual(s.whatsapp, '5561999990000');
  assert.strictEqual(s.pages_visited, 0);
  assert.strictEqual(s.wa_evidence_url, null);
  assert.strictEqual(urls.length, 1, 'só a homepage');
});

test('v2: budget curto com reserva de 2s reduz a zero as visitas internas', async () => {
  const urls = [];
  const s = await analyzeSite('https://silva.com', {
    budgetMs: 300,
    fetchImpl: async (url) => { urls.push(String(url)); return { url, ok: true, status: 200, text: async () => (urls.length === 1 ? HOME_SEM_ZAP : CONTATO_ZAP) }; },
  });
  assert.strictEqual(urls.length, 1);
  assert.strictEqual(s.pages_visited, 0);
  assert.strictEqual(s.whatsapp, null);
  assert.strictEqual(s.ok, true);
});

test('v2: text() lança depois de res.ok => ok:false (amendment sem re-throw no caller)', async () => {
  const s = await analyzeSite('https://quebrada.com', {
    fetchImpl: async (url) => ({
      url,
      ok: true,
      status: 200,
      text: async () => { throw new TypeError('body stream errored'); },
    }),
  });
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.status, 200);
  assert.strictEqual(s.final_url, 'https://quebrada.com');
  assert.strictEqual(s.whatsapp, null);
  assert.strictEqual(s.whatsapp_hint, false);
  assert.strictEqual(s.wa_evidence_url, null);
  assert.strictEqual(s.pages_visited, 0);
});
