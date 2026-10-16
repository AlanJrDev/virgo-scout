const { test } = require('node:test');
const assert = require('node:assert');

const { classifyWaNumber, isDfRegion } = require('../utils/wa-audit');

test('numero sem forma utilizavel e invalid', () => {
  const r = classifyWaNumber({ whatsapp: '123' });
  assert.strictEqual(r.status, 'invalid');
  assert.deepStrictEqual(r.reasons, ['unparseable']);
});

test('celular DF valido que casa com o telefone e declared', () => {
  const r = classifyWaNumber({ whatsapp: '5561999990000', phone: '61999990000', address: 'Taguatinga DF' });
  assert.strictEqual(r.status, 'declared');
  assert.strictEqual(r.ddd, '61');
  assert.strictEqual(r.mobile, true);
  assert.ok(r.reasons.includes('matches_phone'));
});

test('DDD inexistente marca suspect', () => {
  const r = classifyWaNumber({ whatsapp: '5508999990000' });
  assert.strictEqual(r.status, 'suspect');
  assert.ok(r.reasons.includes('invalid_ddd'));
});

test('numero de fora do DF quando o endereco e DF marca suspect', () => {
  const r = classifyWaNumber({ whatsapp: '5555999793397', address: 'Águas Claras DF' });
  assert.strictEqual(r.ddd, '55');
  assert.strictEqual(r.status, 'suspect');
  assert.ok(r.reasons.includes('ddd_off_region'));
});

test('zap diferente do telefone nao e motivo de suspeita sozinho', () => {
  const r = classifyWaNumber({ whatsapp: '5561982638116', phone: '6132724904', address: 'Brasília DF' });
  assert.strictEqual(r.status, 'declared');
  assert.ok(r.reasons.includes('differs_phone'));
});

test('fixo de 10 digitos validado como nao-movel', () => {
  const r = classifyWaNumber({ whatsapp: '556133334444' });
  assert.strictEqual(r.mobile, false);
  assert.strictEqual(r.status, 'declared');
});

test('isDfRegion reconhece RA e sigla', () => {
  assert.strictEqual(isDfRegion('QS 1, Águas Claras - DF'), true);
  assert.strictEqual(isDfRegion('São Paulo SP'), false);
});
