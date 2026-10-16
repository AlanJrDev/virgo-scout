const { test } = require('node:test');
const assert = require('node:assert');
const { qualify, reviewsScore, accessScore } = require('../qualify/engine');

test('lead sem site com WhatsApp validado vira ICP site com motivos', () => {
  const q = qualify({ name: 'X', reviews: 40, rating: 4.8, whatsapp: '5561999990000', claimed: true });
  assert.ok(q.icp.includes('site'));
  assert.ok(q.reasons.includes('sem site'));
  assert.ok(q.fit > 40);
  assert.strictEqual(q.reach, 10);
});

test('lead fechado qualifica 0', () => {
  const q = qualify({ name: 'X', closed: true, whatsapp: '5561999990000', reviews: 300 });
  assert.strictEqual(q.fit, 0);
  assert.deepStrictEqual(q.icp, []);
});

test('anuncio ativo soma capacidade e intencao e define why_now', () => {
  const base = qualify({ name: 'X', website: 'https://x.com', reviews: 80, whatsapp: '5561999990000' });
  const comAds = qualify({ name: 'X', website: 'https://x.com', reviews: 80, whatsapp: '5561999990000', ads_active: true });
  assert.ok(comAds.fit > base.fit);
  assert.strictEqual(comAds.why_now, 'anunciando agora');
  assert.ok(comAds.reasons.includes('anúncio ativo'));
});

test('negocio com site e escala vira ICP sistema', () => {
  const q = qualify({ name: 'X', website: 'https://x.com', reviews: 120, whatsapp: '5561999990000' });
  assert.ok(q.icp.includes('sistema'));
});

test('multi_unidade nao conta como escala para ICP sistema', () => {
  const q = qualify({ name: 'X', website: 'https://x.com', reviews: 10, multi_unidade: true, whatsapp: '5561999990000' });
  assert.ok(!q.icp.includes('sistema'));
});

test('site ruim (auditoria) conta como oportunidade', () => {
  const q = qualify({ name: 'X', website: 'https://x.com', site_audit: { ruim: true }, whatsapp: '5561999990000' });
  assert.ok(q.reasons.includes('site desatualizado'));
  assert.ok(q.icp.includes('site'));
});

test('reviewsScore e log e satura em 10', () => {
  assert.strictEqual(reviewsScore(0), 0);
  assert.ok(reviewsScore(100) > reviewsScore(10));
  assert.strictEqual(reviewsScore(1e6), 10);
});

test('accessScore soma canais e satura em 15', () => {
  assert.strictEqual(accessScore({ whatsapp: '5561999990000', email: 'a@b.c', instagram: 'x' }), 15);
  assert.strictEqual(accessScore({}), 0);
});
