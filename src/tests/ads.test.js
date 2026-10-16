const { test } = require('node:test');
const assert = require('node:assert');
const { parseAdsHtml, checkAds } = require('../enrich/ads');

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

test('shell do google com chrome i18n e sem card => unknown', () => {
  const html = '<html><head><title>Central de transparência de anúncios</title></head><body>Central de transparência de anúncios</body></html>';
  assert.strictEqual(parseAdsHtml(html), null);
});

test('card real "3 anuncios" com landing => ativo', () => {
  const html = '<html><body><h2>3 anúncios</h2><a href="https://vendor.com/ads">ver</a></body></html>';
  const r = parseAdsHtml(html);
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.landing, 'vendor.com');
});

test('texto de vazio "nao encontramos nada" => inativo', () => {
  const r = parseAdsHtml('<html><body>Não encontramos nada para essa busca</body></html>');
  assert.strictEqual(r.active, false);
  assert.strictEqual(r.landing, null);
});

test('checkAds devolve null quando fetch falha', async () => {
  const r = await checkAds('Clínica X', { fetchImpl: async () => { throw new Error('boom'); } });
  assert.strictEqual(r, null);
});
