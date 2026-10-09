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
});

test('url sem esquema ganha https; erro de rede vira ok:false', async () => {
  const bad = await analyzeSite('souzadv.com.br', { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.email, null);
});

test('descarta emails falsos-positivos comuns', () => {
  const s = extractSignals('<a href="mailto:sentry@example.com">x</a> @fontes png@2x.png');
  assert.strictEqual(s.email, null);
});
