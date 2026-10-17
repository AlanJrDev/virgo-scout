// dedupePlan: mesma empresa (nome+endereço) com place_ids distintos vira 1 canônica
const { test } = require('node:test');
const assert = require('node:assert');
const { dedupePlan } = require('../utils/dedupe');

const A = { id: '0xaaa:0x111', name: 'Tapeçaria Brasília', address: 'QR 2, Brasília - DF', phone: '61', website: null, instagram: null };
const B = { id: '0xaaa:0x222', name: 'Tapecaria Brasilia', address: 'QR 2, Brasília - DF', phone: null, website: 'dl.com', instagram: 'x' };
const C = { id: 'sha1hash2', name: 'DL Tapeçaria', address: 'Outra rua 10 - Gama', website: 'dl.com' };

test('dupes reúnem e o canônico é a row mais preenchida', () => {
  const plan = dedupePlan([A, B, C]);
  assert.strictEqual(plan.groups.length, 1);
  const g = plan.groups[0];
  assert.strictEqual(g.canonical_id, '0xaaa:0x222', 'B tem site+ig+phone preenchidos');
  assert.deepStrictEqual(g.deletes, ['0xaaa:0x111']);
  assert.deepStrictEqual(g.patch, { phone: '61' });
  assert.strictEqual(plan.removed, 1);
});

test('endereços distintos de mesmo nome NÃO são dupes (filiais reais)', () => {
  const plan = dedupePlan([A, C]);
  assert.strictEqual(plan.groups.length, 0);
  assert.strictEqual(plan.removed, 0);
});

test('base vazia ou sem dupes => zero operações', () => {
  assert.deepStrictEqual(dedupePlan([]), { groups: [], removed: 0 });
  assert.deepStrictEqual(dedupePlan([A]).groups, []);
});
