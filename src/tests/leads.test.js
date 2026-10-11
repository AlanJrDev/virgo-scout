const { test } = require('node:test');
const assert = require('node:assert');

const { normalizeLead, toCSV } = require('../utils/leads');

test('normalizeLead passthrough de whatsapp (dígitos) e null sem valor', () => {
  assert.strictEqual(normalizeLead({ name: 'X', whatsapp: '5561999990000' }).whatsapp, '5561999990000');
  assert.strictEqual(normalizeLead({ name: 'X' }).whatsapp, null);
});

test('normalizeLead remove formatação do whatsapp', () => {
  assert.strictEqual(normalizeLead({ name: 'X', whatsapp: '+55 (61) 99863-8116' }).whatsapp, '5561998638116');
});

test('toCSV inclui whatsapp na última coluna (header e linha alinhados)', () => {
  const csv = toCSV([{ name: 'X', whatsapp: '5561999990000' }]);
  const [header, row] = csv.split('\n');
  const cols = header.split(';');
  assert.strictEqual(cols[cols.length - 1], 'whatsapp');
  assert.strictEqual(row.split(';').length, cols.length);
  assert.strictEqual(row.split(';')[cols.length - 1], '5561999990000');
});
