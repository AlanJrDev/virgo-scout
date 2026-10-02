// Testes da tela de login (utilitários de sessão do servidor)
const { test } = require('node:test');
const assert = require('node:assert');

const { checkCredentials, newSessionToken } = require('../../scripts/serve-web-auth');

test('credenciais padrão admin/virgo123 funcionam', () => {
  assert.strictEqual(checkCredentials('admin', 'virgo123'), true);
});

test('senha errada é rejeitada', () => {
  assert.strictEqual(checkCredentials('admin', 'errada'), false);
  assert.strictEqual(checkCredentials('outro', 'virgo123'), false);
  assert.strictEqual(checkCredentials('', ''), false);
});

test('credenciais customizadas via env', () => {
  process.env.LOGIN_USER = 'alan';
  process.env.LOGIN_PASS = 'df2026';
  assert.strictEqual(checkCredentials('alan', 'df2026'), true);
  assert.strictEqual(checkCredentials('admin', 'virgo123'), false);
  delete process.env.LOGIN_USER;
  delete process.env.LOGIN_PASS;
});

test('tokens de sessão são únicos e não vazios', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.ok(a.length >= 32);
  assert.notStrictEqual(a, b);
});
