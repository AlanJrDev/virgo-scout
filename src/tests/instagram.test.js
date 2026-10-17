const { test } = require('node:test');
const assert = require('node:assert');
const { parseIgProfile, handleFrom } = require('../enrich/instagram');

test('extrai seguidores e posts do og:description', () => {
  const html = '<meta property="og:description" content="1,234 Followers, 12 Following, 88 Posts - Clínica X">';
  const r = parseIgProfile(html);
  assert.strictEqual(r.blocked, false);
  assert.strictEqual(r.followers, 1234);
  assert.strictEqual(r.posts, 88);
});

test('muro de login => blocked', () => {
  const r = parseIgProfile('<html><body>Faça login para continuar</body></html>');
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.followers, null);
});

test('handleFrom normaliza URL ou @handle', () => {
  assert.strictEqual(handleFrom('https://instagram.com/clinicax/'), 'clinicax');
  assert.strictEqual(handleFrom('@clinicax'), 'clinicax');
  assert.strictEqual(handleFrom('clinicax'), 'clinicax');
  assert.strictEqual(handleFrom(''), null);
});

test('handleFrom rejeita handles reservados (páginas internas do IG)', () => {
  assert.strictEqual(handleFrom('https://instagram.com/p/ABC123/'), null);
  assert.strictEqual(handleFrom('https://instagram.com/reel/XYZ/'), null);
  assert.strictEqual(handleFrom('https://www.instagram.com/stories/alguem/'), null);
  assert.strictEqual(handleFrom('https://instagram.com/explore/tags/advocacia'), null);
  assert.strictEqual(handleFrom('p'), null);
  assert.strictEqual(handleFrom('https://instagram.com/arteecoresdf/'), 'arteecoresdf');
});
