const { test, after } = require('node:test');
const assert = require('node:assert');

const nativeFetch = global.fetch;
after(() => { global.fetch = nativeFetch; });

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

const { waWriteFields } = require('../utils/wa-audit');

test('waWriteFields rejeita whatsapp invalid (sem forma utilizavel)', () => {
  assert.strictEqual(waWriteFields({ whatsapp: '123', source: 'site' }), null);
});

test('waWriteFields rejeita invalid_ddd na escrita', () => {
  assert.strictEqual(waWriteFields({ whatsapp: '5508999990000', source: 'site' }), null);
});

test('waWriteFields grava suspect com marcacao (ddd_off_region)', () => {
  const out = waWriteFields({ whatsapp: '5555999793397', address: 'Águas Claras, DF', hint: true, source: 'site', evidence: 'https://x.com' });
  assert.strictEqual(out.wa_status, 'suspect');
  assert.strictEqual(out.whatsapp, '5555999793397');
  assert.strictEqual(out.whatsapp_hint, true);
  assert.strictEqual(out.wa_source, 'site');
  assert.strictEqual(out.wa_evidence, 'https://x.com');
});

test('waWriteFields declared: differs_phone nao é motivo de exclusão', () => {
  const out = waWriteFields({ whatsapp: '5561982638116', phone: '6132724904', address: 'Brasília DF', source: 'site' });
  assert.strictEqual(out.wa_status, 'declared');
});

test('waWriteFields sem whatsapp => null (não marca nada de wa_*)', () => {
  assert.strictEqual(waWriteFields({}), null);
  assert.strictEqual(waWriteFields({ whatsapp: '', source: 'site' }), null);
});

// Case 1: persist PATCHa por id e ignora rows sem id; corpo mínimo (nunca mexe em whatsapp)
test('audit:wa persistWaStatus grava wa_status/wa_checked_at por id', async () => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  const { persistWaStatus } = require('../../scripts/audit-wa');
  const rows = [
    { id: 'a1', status: 'suspect' },
    { id: null, status: 'invalid' }, // local sem id: pula
    { id: 'b2', status: 'declared' },
  ];
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return { ok: true, status: 204, text: async () => '' };
  };
  const writes = await persistWaStatus(rows);
  assert.strictEqual(writes, 2);
  const patches = calls.filter((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patches.length, 2);
  assert.ok(patches[0].url.includes('leads?id=eq.a1'));
  const body = JSON.parse(patches[0].opts.body);
  assert.deepStrictEqual(Object.keys(body).sort(), ['wa_checked_at', 'wa_status']);
  assert.ok(typeof body.wa_checked_at === 'string');
});

// Case 2: degrade — colunas ausentes não derrubam o script nem dão throw
test('audit:wa persistWaStatus degrada em 400 de coluna wa_ ausente', async () => {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  const { persistWaStatus } = require('../../scripts/audit-wa');
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return { ok: false, status: 400, text: async () => JSON.stringify({ message: "Could not find the 'wa_status' column of 'leads' in the schema cache" }) };
  };
  const writes = await persistWaStatus([{ id: 'a1', status: 'suspect' }, { id: 'b2', status: 'declared' }]);
  assert.strictEqual(writes, 0);
  assert.strictEqual(calls.length, 1, 'primeiro 400 aborta o resto');
});
