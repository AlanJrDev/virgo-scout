const { test } = require('node:test');
const assert = require('node:assert');

const { waDigits, waLink, waMessage, hasWa, waShortMessage } = require('../utils/wa');

test('celular BR com DDD vira 55 + DDD + numero', () => {
  assert.strictEqual(waDigits('(61) 99999-0000'), '5561999990000');
});

test('numero que ja tem 55 nao ganha 55 duplo', () => {
  assert.strictEqual(waDigits('+55 61 99999-0000'), '5561999990000');
});

test('fixo com 0 de longa local perde o 0 e ganha 55', () => {
  assert.strictEqual(waDigits('061 3333-4444'), '556133334444');
});

test('DDD 55 (RS) de 13 digitos NAO e destruido', () => {
  assert.strictEqual(waDigits('5555999793397'), '5555999793397');
});

test('pais duplicado (55 55 + DDD) perde o 55 extra', () => {
  assert.strictEqual(waDigits('555561999990000'), '5561999990000');
});

test('numero de servico 0800 nao vira link de zap', () => {
  assert.strictEqual(waDigits('5508008830113'), '');
  assert.strictEqual(waDigits('08008830113'), '');
});

test('hasWa so true quando o link e montavel', () => {
  assert.strictEqual(hasWa({ whatsapp: '5555999793397' }), true);
  assert.strictEqual(hasWa({ whatsapp: '12345' }), false);
  assert.strictEqual(hasWa({}), false);
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

test('waMessage usa Alan por padrao e aceita socio explicito', () => {
  assert.ok(waMessage({ name: 'Silva Advogados' }).includes('Sou Alan, da Virgo Tech'));
  assert.ok(waMessage({ name: 'Silva Advogados' }, 'Dylan').includes('Sou Dylan, da Virgo Tech'));
  assert.ok(waMessage({ name: 'X' }, '   ').includes('Sou Alan'));
});

test('waMessage formato novo: gancho, abertura e fechamento', () => {
  const msg = waMessage({ name: 'Silva Advogados' });
  assert.ok(msg.includes('💸'));
  assert.ok(msg.includes('Olá, tudo bem?'));
  assert.ok(msg.includes('Posso te mostrar?'));
  assert.ok(msg.startsWith('💸 Sua empresa pode estar perdendo clientes'));
});

test('waLink sem texto usa a mensagem padrao do socio', () => {
  const link = waLink('(61) 99999-0000');
  assert.ok(link.startsWith('https://wa.me/5561999990000?text='));
  const decoded = decodeURIComponent(link.split('?text=')[1]);
  assert.strictEqual(decoded, waShortMessage('Alan'));
  assert.ok(encodeURIComponent(decoded).length <= 130);
});
