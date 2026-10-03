// B1: estado vs evento da captura — 'done' persistente não pode recarregar a página (loop pós-login).
const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const modPath = path.join(__dirname, '..', '..', 'web', 'capture-state.js');
const CaptureState = require(modPath);

function fakeStorage(map) {
  const m = map || new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('done sem ter visto running ao vivo (estado persistente) → sem reload e sem toast', () => {
  const r = CaptureState.decide('done', { sawRunning: false, startedAt: 't1', storage: fakeStorage() });
  assert.strictEqual(r.render, 'done');
  assert.strictEqual(r.reload, false);
  assert.strictEqual(r.toast, false);
});

test('transição running→done ao vivo → recarrega 1× com toast e guarda no storage', () => {
  const storage = fakeStorage();
  const r = CaptureState.decide('done', { sawRunning: true, startedAt: 't1', storage });
  assert.strictEqual(r.reload, true);
  assert.strictEqual(r.toast, true);
  assert.strictEqual(storage.getItem('vs_reloaded_t1'), '1');
  // segunda avaliação (mesmo done) não recarrega de novo
  const r2 = CaptureState.decide('done', { sawRunning: true, startedAt: 't1', storage });
  assert.strictEqual(r2.reload, false);
  assert.strictEqual(r2.toast, false);
});

test('guarda por started_at: capturas diferentes recarregam cada uma uma vez', () => {
  const storage = fakeStorage();
  assert.strictEqual(CaptureState.decide('done', { sawRunning: true, startedAt: 'a', storage }).reload, true);
  storage.clear ? storage.clear() : null;
  const novo = fakeStorage(new Map([['vs_reloaded_a', '1']]));
  assert.strictEqual(CaptureState.decide('done', { sawRunning: true, startedAt: 'b', storage: novo }).reload, true);
});

test('storage que falha (modo privado) → não quebra e ainda recarrega na transição', () => {
  const boom = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
  const r = CaptureState.decide('done', { sawRunning: true, startedAt: 't1', storage: boom });
  assert.strictEqual(r.reload, true);
  assert.strictEqual(r.toast, true);
});

test('demais status nunca recarregam', () => {
  for (const st of ['idle', 'running', 'failed']) {
    const r = CaptureState.decide(st, { sawRunning: true, startedAt: 't1', storage: fakeStorage() });
    assert.strictEqual(r.reload, false, st);
    assert.strictEqual(r.toast, false, st);
    assert.strictEqual(r.render, st);
  }
});

test('sem startedAt usa chave estável (não recarrega em loop)', () => {
  const storage = fakeStorage();
  assert.strictEqual(CaptureState.decide('done', { sawRunning: true, storage }).reload, true);
  assert.strictEqual(CaptureState.decide('done', { sawRunning: true, storage }).reload, false);
});

after(() => {});
