const test = require('node:test');
const assert = require('node:assert');

const { waFits, waShortMessage, waLink, WA_URL_BUDGET } = require('../utils/wa');
const quote = require('../../web/wa-quote');

const T1 = (s) => '💸 Sou ' + s + ', da Virgo Tech. Posso te mostrar como dobrar seus clientes?';
const T2 = '💸 Sou da Virgo Tech. Posso te mostrar como dobrar seus clientes?';
const T3 = 'Olá! Posso te mostrar como dobrar seus clientes?';

const enc = (s) => encodeURIComponent(String(s)).length;
const textOf = (url) => decodeURIComponent(String(url).split('?text=')[1] || '');

test('WA_URL_BUDGET e t3 (hard floor) dentro de 130', () => {
  assert.strictEqual(WA_URL_BUDGET, 130);
  assert.ok(enc(T3) <= WA_URL_BUDGET);
  assert.ok(waFits(T3));
});

test('waFits: mede o encoded do texto', () => {
  assert.strictEqual(waFits('Olá, tudo bem?'), true);
  assert.strictEqual(waFits('Olá, tudo bem? Tenho uma ideia para o seu negocio.'), true);
  assert.strictEqual(waFits('X'.repeat(200)), false);
  assert.strictEqual(waFits(''), true);
  assert.strictEqual(waFits(null), true);
});

test('waShortMessage: todo socio fica dentro do budget (<= 130 encoded)', () => {
  ['', 'Alan', 'Dylan', 'Luiz Augusto', 'Miguel', 'X'.repeat(60)].forEach((socio) => {
    const msg = waShortMessage(socio);
    assert.ok(enc(msg) <= 130, 'encoded ' + enc(msg) + ' > 130 para socio ' + JSON.stringify(socio));
    assert.ok(waFits(msg));
  });
});

test('waShortMessage: t1 com o nome do socio quando couber', () => {
  ['Alan', 'Dylan', 'Luiz Augusto', 'Miguel'].forEach((socio) => {
    assert.ok(enc(T1(socio)) <= 130);
    assert.strictEqual(waShortMessage(socio), T1(socio));
  });
});

test('waShortMessage: sem socio e nome longo demais caem no t2', () => {
  assert.strictEqual(waShortMessage(''), T2);
  assert.strictEqual(waShortMessage('X'.repeat(60)), T2);
  assert.strictEqual(waShortMessage(null), T2);
  assert.strictEqual(waShortMessage('   '), T2);
});

test('waLink: mensagem longa decai para o tier curto do Alan', () => {
  const longo = 'Sua empresa pode estar perdendo clientes e dinheiro todos os dias para a concorrência! Olá, tudo bem? Sou Alan, da Virgo Tech, e tenho uma ideia para ajudar vocês a atrair mais clientes. Posso te mostrar? ';
  const completo = longo.repeat(4);
  assert.ok(enc(completo) > 300, 'fixture deve passar de 300 chars encoded');
  const link = waLink('(61) 99999-0000', completo);
  assert.ok(link.startsWith('https://wa.me/5561999990000?text='));
  assert.strictEqual(textOf(link), waShortMessage('Alan'));
  assert.ok(enc(textOf(link)) <= 130);
});

test('waLink: mensagem curta (~80 chars encoded) e usada como esta', () => {
  const curta = 'Olá, tudo bem? Tenho uma ideia para o seu negocio.';
  assert.ok(enc(curta) >= 70 && enc(curta) <= 90, 'fixture deve ter ~80 chars encoded');
  const link = waLink('(61) 99999-0000', curta);
  assert.strictEqual(textOf(link), curta);
});

test('waLink: sem mensagem cai nos tiers (default Alan)', () => {
  const link = waLink('(61) 99999-0000');
  assert.strictEqual(textOf(link), waShortMessage('Alan'));
});

test('paridade: web/wa-quote.js e src/utils/wa.js exponem o mesmo contrato', () => {
  assert.strictEqual(quote.WA_URL_BUDGET, WA_URL_BUDGET);
  const amostras = ['', 'Alan', 'Dylan', 'Luiz Augusto', 'Miguel', 'X'.repeat(60), null, undefined];
  amostras.forEach((s) => {
    assert.strictEqual(quote.waShortMessage(s), waShortMessage(s));
    assert.strictEqual(quote.waFits(s), waFits(s));
    assert.strictEqual(quote.waFits(T1('Alan')), waFits(T1('Alan')));
    assert.strictEqual(quote.waFits('X'.repeat(400)), waFits('X'.repeat(400)));
  });
});
