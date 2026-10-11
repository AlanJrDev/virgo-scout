const { test } = require('node:test');
const assert = require('node:assert');
const { waFromHref } = require('../scraper/mapsScraper');

test('waFromHref extrai número do action do Maps (api.whatsapp.com/send)', () => {
  assert.strictEqual(waFromHref('https://api.whatsapp.com/send?1=pt_BR&phone=5561982638116'), '5561982638116');
  assert.strictEqual(waFromHref('https://api.whatsapp.com/send?phone=5561984944475&text=Ol%C3%A1'), '5561984944475');
});

test('waFromHref aceita wa.me e remove +', () => {
  assert.strictEqual(waFromHref('https://wa.me/+5561999990000'), '5561999990000');
  assert.strictEqual(waFromHref('https://wa.me/5561999990000?text=x'), '5561999990000');
});

test('waFromHref ignora actions que não são whatsapp', () => {
  assert.strictEqual(waFromHref('https://example.com/agendar?phone=123'), '');
  assert.strictEqual(waFromHref('https://api.whatsapp.com/send'), '');
  assert.strictEqual(waFromHref(''), '');
});
