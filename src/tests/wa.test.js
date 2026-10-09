const { test } = require('node:test');
const assert = require('node:assert');

const { waDigits, waLink, waMessage } = require('../utils/wa');

test('celular BR com DDD vira 55 + DDD + numero', () => {
  assert.strictEqual(waDigits('(61) 99999-0000'), '5561999990000');
});

test('numero que ja tem 55 nao ganha 55 duplo', () => {
  assert.strictEqual(waDigits('+55 61 99999-0000'), '5561999990000');
});

test('fixo com 0 de longa local perde o 0 e ganha 55', () => {
  assert.strictEqual(waDigits('061 3333-4444'), '556133334444');
});

test('numero curto/lixo vira null', () => {
  assert.strictEqual(waDigits('12345'), '');
  assert.strictEqual(waDigits(''), '');
  assert.strictEqual(waDigits(null), '');
});

test('waLink monta URL com texto codificado', () => {
  const link = waLink('(61) 99999-0000', 'Olá, tudo bem?');
  assert.strictEqual(link, 'https://wa.me/5561999990000?text=Ol%C3%A1%2C%20tudo%20bem%3F');
});

test('waLink sem numero utilizavel retorna null', () => {
  assert.strictEqual(waLink(''), null);
  assert.strictEqual(waLink('12'), null);
});

test('waMessage cita o nome do lead', () => {
  assert.ok(waMessage('Silva Advogados').includes('Silva Advogados'));
  assert.ok(waMessage('') .includes('seu escritório'));
});

test('waMessage personalizada usa o lead completo (objeto)', () => {
  const sem = waMessage({ name: 'Silva Advogados', area: 'Criminal', rating: 4.8, reviews: 30, website: null });
  assert.ok(sem.includes('Silva Advogados'));
  assert.ok(sem.includes('Virgo Tech'));
  assert.ok(sem.includes('4,8'));
  assert.ok(sem.includes('não têm site'));
  assert.ok(sem.includes('advocacia'));
  const com = waMessage({ name: 'Studio X', area: 'Arquitetura', rating: 4.5, reviews: 2, website: 'https://x.com' });
  assert.ok(!com.includes('não têm site'));
  assert.ok(com.includes('arquitetura e topografia'));
});
