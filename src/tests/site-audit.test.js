const { test } = require('node:test');
const assert = require('node:assert');
const { auditSite, auditUrl } = require('../enrich/site-audit');

test('site https com viewport e WordPress nao e ruim', () => {
  const a = auditSite('<html><head><meta name="viewport" content="width=device-width"><link href="/wp-content/x.css"></head><body><form></form></body></html>', 'https://x.com');
  assert.strictEqual(a.https, true);
  assert.strictEqual(a.mobile, true);
  assert.strictEqual(a.platform, 'wordpress');
  assert.strictEqual(a.ruim, false);
});

test('http sem viewport, builder, copyright antigo => ruim', () => {
  const a = auditSite('<html><head></head><body>wixstatic © 2013</body></html>', 'http://x.com');
  assert.strictEqual(a.mobile, false);
  assert.strictEqual(a.platform, 'wix');
  assert.strictEqual(a.copyright_year, 2013);
  assert.strictEqual(a.ruim, true);
});

test('formulario e agendamento detectados', () => {
  const a = auditSite('<form></form> agende seu horario', 'https://x.com');
  assert.strictEqual(a.has_form, true);
  assert.strictEqual(a.has_booking, true);
});

test('auditUrl devolve null quando fetch falha', async () => {
  const r = await auditUrl('https://x.com', { fetchImpl: async () => { throw new Error('boom'); } });
  assert.strictEqual(r, null);
});
