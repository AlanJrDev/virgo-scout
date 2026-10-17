// WhatsApp na bio do Instagram: links wa.me + telefone com palavra-chave no texto
const { test } = require('node:test');
const assert = require('node:assert');
const { waFromBio, digitsBR } = require('../enrich/ig-bio');

test('digitsBR aceita celular 11 dígitos e elimina fixo/lixo', () => {
  assert.strictEqual(digitsBR('5561999990000'), '61999990000');
  assert.strictEqual(digitsBR('(61) 99999-0000'), '61999990000');
  assert.strictEqual(digitsBR('61 3222 1234'), null, 'fixo não vira WA');
  assert.strictEqual(digitsBR('123'), null);
  assert.strictEqual(digitsBR('011999990000'), '11999990000');
  assert.strictEqual(digitsBR('55619999900001'), null, '11 dígitos após 55 é lixo');
});

test('waFromBio: link wa.me na bio vence', () => {
  const r = waFromBio({ links: ['https://l.instagram.com/?u=https%3A%2F%2Fwa.me%2F5561977772222'], html: '<p>decorações</p>' });
  assert.deepStrictEqual(r, { digits: '61977772222', via: 'link' });
});

test('waFromBio: api.whatsapp com phone param', () => {
  const r = waFromBio({ hrefsText: 'https://api.whatsapp.com/send?phone=5561988887777&text=oi', html: '' });
  assert.deepStrictEqual(r, { digits: '61988887777', via: 'link' });
});

test('waFromBio: telefone no texto apenas com palavra-chave próxima', () => {
  const ok = waFromBio({ html: '<p>Orçamentos zap (61) 99999-1234</p>' });
  assert.strictEqual(ok && ok.digits, '61999991234');
  const noHint = waFromBio({ html: '<p>Endereço nº 99999-1234 Asa Sul</p>' });
  assert.strictEqual(noHint, null, 'número sem contexto de zap é descartado');
});

test('waFromBio: vazio => null', () => {
  assert.strictEqual(waFromBio({}), null);
  assert.strictEqual(waFromBio({ html: '<p>sem contato</p>' }), null);
});
