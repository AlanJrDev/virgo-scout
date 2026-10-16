const { test } = require('node:test');
const assert = require('node:assert');
const { markOutcome, ALLOWED } = require('../utils/outcomes');

test('outcome invalido rejeita sem tocar no banco', async () => {
  await assert.rejects(() => markOutcome('abc123', 'zebra'), (e) => e.code === 'invalid_outcome');
});

test('id invalido rejeita', async () => {
  await assert.rejects(() => markOutcome('!!', 'respondeu'), (e) => e.code === 'invalid_id');
});

test('lista de outcomes esperada', () => {
  assert.deepStrictEqual(ALLOWED, ['novo', 'contatado', 'respondeu', 'reuniao', 'fechou', 'perdeu']);
});
