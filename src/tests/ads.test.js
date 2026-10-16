const { test } = require('node:test');
const assert = require('node:assert');
const { parseAdsHtml, checkAds } = require('../qualify/ads');

test('pagina vazia => sem anuncio ativo', () => {
  const r = parseAdsHtml('<html><body>Nenhum anúncio encontrado</body></html>');
  assert.strictEqual(r.active, false);
  assert.strictEqual(r.landing, null);
});

test('pagina com card de anuncio e landing => ativo', () => {
  const html = '<html><body>3 anúncios <a href="https://clinicax.com.br/orcamento">Ver</a></body></html>';
  const r = parseAdsHtml(html);
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.landing, 'clinicax.com.br');
});

test('checkAds devolve null quando fetch falha', async () => {
  const r = await checkAds('Clínica X', { fetchImpl: async () => { throw new Error('boom'); } });
  assert.strictEqual(r, null);
});
