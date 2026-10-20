const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SHARE_DOC = require('../../web/share-doc');

const NL = String.fromCharCode(10);

const payload = () => [{
  name: 'Studio Exemplo',
  msg: 'Sou Alan, da Virgo Tech, e tenho uma ideia para ajudar vocês a atrair mais clientes.',
  bloco: '⭐ Nota: 4,8★ (120 avaliações)' + NL +
    '🌐 Site: exemplo.com.br' + NL +
    '📸 Instagram: @exemplo' + NL +
    '📱 WhatsApp: (61) 99999-0000 ✅ Confirmado',
  waUrl: 'https://wa.me/5561999990000?text=Oi'
}];

test('buildDocHtml: título, cabeçalho, lead, msg, bloco, href e rodapé presentes', () => {
  const h = SHARE_DOC.buildDocHtml(payload(), 'Alta Oportunidade', 'Alan', 'Topografia');
  assert.ok(h.includes('VIRGO TECH — LISTA DE LEADS'));
  assert.ok(h.includes('🎯 Nicho: Topografia'));
  assert.ok(h.includes('Total: 1 leads (Alta Oportunidade)'));
  assert.ok(h.includes('Studio Exemplo'));
  assert.ok(h.includes('Sou Alan, da Virgo Tech'));
  assert.ok(h.includes('⭐ Nota: 4,8★ (120 avaliações)'));
  assert.ok(h.includes('🌐 Site: exemplo.com.br'));
  assert.ok(h.includes('📸 Instagram: @exemplo'));
  assert.ok(h.includes('📱 WhatsApp: (61) 99999-0000'));
  assert.ok(h.includes('href="' + 'https://wa.me/5561999990000?text=Oi'));
  assert.ok(h.includes('🔗 Abrir Zap'));
  assert.ok(h.includes('Virgo Tech Scout — Automação de Prospecção'));
  assert.ok(h.startsWith('<html xmlns:w="urn:schemas-microsoft-com:office:word">'));
});

test('buildDocHtml: escapa nome com <b> e aspas (nenhum HTML vivo)', () => {
  const leads = [{ name: '<b>olá</b> Studio', msg: 'btco "aspas"', bloco: 'x', waUrl: '' }];
  const h = SHARE_DOC.buildDocHtml(leads, 'T', 'Alan', '');
  assert.strictEqual(h.includes('<b>'), false);
  assert.ok(h.includes('lt;b') && h.includes('gt;'));
  assert.ok(h.includes('quot;aspa'));
  assert.ok(h.includes('Enviado por: Alan'));
});

test('buildDocHtml: múltiplos leads separados por hr, sem waUrl não gera link', () => {
  const leads = payload().concat([{ name: 'B2', msg: 'm2', bloco: '📱 WhatsApp: não', waUrl: '' }]);
  const h = SHARE_DOC.buildDocHtml(leads, 'Todos', 'Alan', 'Topografia');
  assert.ok((h.match(/<hr>/g) || []).length >= 3);
  assert.ok(h.includes('B2'));
});

test('buildDocFileName: data fixa gera leads-virgo-AAAA-MM-DD.doc', () => {
  assert.strictEqual(SHARE_DOC.buildDocFileName(null, new Date(2026, 9, 20)), 'leads-virgo-2026-10-20.doc');
  assert.strictEqual(SHARE_DOC.buildDocFileName(undefined, new Date(2025, 0, 2)), 'leads-virgo-2025-01-02.doc');
  assert.strictEqual(SHARE_DOC.buildDocFileName('topografia', new Date(2026, 9, 20)), 'leads-virgo-topografia-2026-10-20.doc');
});

test('buildDocFileName: hoje por padrão segue o formato', () => {
  assert.match(SHARE_DOC.buildDocFileName(), /^leads-virgo-\d{4}-\d{2}-\d{2}\.doc$/);
});

test('share-doc.test.js está listado no script test do package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.test.includes('src/tests/share-doc.test.js'));
});
