// Testes do módulo de CPF
const { test } = require('node:test');
const assert = require('node:assert');
const { normCpf, isValidCpf, maskCpf } = require('../../src/utils/cpf');

test('normCpf mantém apenas dígitos', () => {
  assert.strictEqual(normCpf('529.982.247-25'), '52998224725');
  assert.strictEqual(normCpf(' 52998224725 '), '52998224725');
  assert.strictEqual(normCpf(null), '');
  assert.strictEqual(normCpf(undefined), '');
  assert.strictEqual(normCpf('abc-def'), '');
});

test('isValidCpf aceita CPFs válidos conhecidos', () => {
  assert.strictEqual(isValidCpf('52998224725'), true);
  assert.strictEqual(isValidCpf('11144477735'), true);
  assert.strictEqual(isValidCpf('529.982.247-25'), true);
});

test('isValidCpf rejeita inválidos', () => {
  assert.strictEqual(isValidCpf('11111111111'), false);
  assert.strictEqual(isValidCpf('22222222222'), false);
  assert.strictEqual(isValidCpf('12345678900'), false);
  assert.strictEqual(isValidCpf('123456789'), false);
  assert.strictEqual(isValidCpf(''), false);
  assert.strictEqual(isValidCpf(null), false);
  assert.strictEqual(isValidCpf(undefined), false);
  assert.strictEqual(isValidCpf('52998224726'), false);
  assert.strictEqual(isValidCpf('52998224724'), false);
});

test('maskCpf expõe só os 2 últimos dígitos', () => {
  assert.strictEqual(maskCpf('52998224725'), '***.***.***-25');
  assert.strictEqual(maskCpf('52998224725'), '***.***.***-25');
  assert.strictEqual(maskCpf(''), '');
  assert.strictEqual(maskCpf(null), '');
});
