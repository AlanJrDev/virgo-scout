// Testes das funções Vercel (fake req/res, store local em TMP, sessões em memória)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-api-'));
process.env.USERS_FILE = path.join(TMP, 'users.json');

const { addUser } = require('../../src/utils/user-store');
const loginH = require('../../api/login');
const logoutH = require('../../api/logout');
const meH = require('../../api/me');
const leadsH = require('../../api/leads');
const insightH = require('../../api/insight');
const captureH = require('../../api/capture');
const queriesH = require('../../api/queries');

before(() => addUser('landevbrasil.ia@gmail.com', 'founder', 'iloveTI@26'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function fakeReq({ method = 'GET', cookie, body, ip = '10.0.0.1', url = '/' } = {}) {
  return { method, url, headers: { ...(cookie ? { cookie } : {}), 'x-forwarded-for': ip }, body, socket: { remoteAddress: ip } };
}
function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = String(v); },
    writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, h); },
    end(b) { this.body = b ? JSON.parse(b) : null; },
  };
}
function cookieDe(res) { return (res.headers['Set-Cookie'] || '').split(';')[0]; }

test('login: 405 em GET; 401 com senha errada; 200 + cookie HttpOnly com sucesso; depois me responde', async () => {
  const r1 = fakeRes();
  await loginH(fakeReq({ method: 'GET' }), r1);
  assert.strictEqual(r1.statusCode, 405);

  const r2 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'errada' }, ip: 'api-a' }), r2);
  assert.strictEqual(r2.statusCode, 401);

  const r3 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-b' }), r3);
  assert.strictEqual(r3.statusCode, 200);
  assert.strictEqual(r3.body.role, 'founder');
  const ck = cookieDe(r3);
  assert.ok(ck.startsWith('vs_auth='));
  assert.ok(r3.headers['Set-Cookie'].includes('HttpOnly'));

  const r4 = fakeRes();
  await meH(fakeReq({ cookie: ck }), r4);
  assert.strictEqual(r4.statusCode, 200);
  assert.deepStrictEqual(r4.body, { user: 'landevbrasil.ia@gmail.com', role: 'founder' });

  const r5 = fakeRes();
  await logoutH(fakeReq({ method: 'POST', cookie: ck }), r5);
  assert.strictEqual(r5.statusCode, 200);
  assert.ok(r5.headers['Set-Cookie'].includes('Max-Age=0'));
  const r6 = fakeRes();
  await meH(fakeReq({ cookie: ck }), r6);
  assert.strictEqual(r6.statusCode, 401);
});

test('endpoints exigem sessão: me/leads/insight/capture/queries sem cookie → 401', async () => {
  for (const h of [meH, leadsH, insightH, captureH, queriesH]) {
    const r = fakeRes();
    await h(fakeReq({ method: 'POST', body: { q: 'x' } }), r);
    assert.strictEqual(r.statusCode, 401, h.name);
  }
});

test('leads sem SUPABASE configurado → 503 supabase_down (fail-closed)', async () => {
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-c' }), r0);
  const r = fakeRes();
  await leadsH(fakeReq({ cookie: cookieDe(r0) }), r);
  assert.strictEqual(r.statusCode, 503);
  assert.strictEqual(r.body.error, 'supabase_down');
});

test('capture: GET com sessão sem SUPABASE → 503; POST → 503 local-only', async () => {
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-d' }), r0);
  const ck = cookieDe(r0);
  const rGet = fakeRes();
  await captureH(fakeReq({ cookie: ck }), rGet);
  assert.strictEqual(rGet.statusCode, 503);
  const rPost = fakeRes();
  await captureH(fakeReq({ method: 'POST', cookie: ck }), rPost);
  assert.strictEqual(rPost.statusCode, 503);
  assert.strictEqual(rPost.body.error, 'local-only');
});

test('capture GET com fetch stubado devolve idle (nunca done, p/ não gerar reload em loop)', async () => {
  // 1) login PRIMEIRO em modo local (sessão em memória); 2) só então liga o Supabase p/ a chamada GET
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-e' }), r0);
  const ck = cookieDe(r0);
  const nativeFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  global.fetch = async (url) => {
    if (url.includes('/sessions?')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ token_hash: 'h', email: 'landevbrasil.ia@gmail.com', role: 'founder', exp: new Date(Date.now() + 60000).toISOString() }]) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify([{ status: 'done', finished_at: '2026-10-01T00:00:00Z', leads_count: 10, queries: 5 }]) };
  };
  try {
    const r = fakeRes();
    await captureH(fakeReq({ cookie: ck }), r);
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.body.status, 'idle');
    assert.strictEqual(r.body.last.leads_count, 10);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    global.fetch = nativeFetch;
  }
});

test('insight: 400 em q vazia; queries devolve a lista de 26', async () => {
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-f' }), r0);
  const ck = cookieDe(r0);
  const r1 = fakeRes();
  await insightH(fakeReq({ method: 'POST', cookie: ck, body: { q: '' } }), r1);
  assert.strictEqual(r1.statusCode, 400);
  const r2 = fakeRes();
  await queriesH(fakeReq({ cookie: ck }), r2);
  assert.strictEqual(r2.statusCode, 200);
  assert.strictEqual(r2.body.queries.length, 26);
});

test('leads filtra por categoria no banco (eq/neq arquitetura) e no payload', async () => {
  const r0 = fakeRes();
  await loginH(fakeReq({ method: 'POST', body: { user: 'landevbrasil.ia@gmail.com', pass: 'iloveTI@26' }, ip: 'api-g' }), r0);
  const ck = cookieDe(r0);
  const nativeFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_t';
  process.env.GROQ_API_KEY = 'gsk_test';
  const urls = [];
  global.fetch = async (url, opts) => {
    urls.push(String(url));
    if (String(url).includes('/sessions?')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ token_hash: 'h', email: 'landevbrasil.ia@gmail.com', role: 'founder', exp: new Date(Date.now() + 60000).toISOString() }]) };
    }
    if (String(url).includes('api.groq.com')) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'X', source: 'topografia Gama', address: 'Gama' }]) };
  };
  try {
    const r1 = fakeRes();
    await leadsH(fakeReq({ cookie: ck, url: '/api/leads?category=arquitetura' }), r1);
    assert.strictEqual(r1.statusCode, 200);
    const leadUrl = urls.find((u) => u.includes('/leads'));
    assert.ok(leadUrl.includes('source=eq.arquitetura'), `url: ${leadUrl}`);
    assert.strictEqual(r1.body.areas[0].label, 'Topografia');

    urls.length = 0;
    const r2 = fakeRes();
    await leadsH(fakeReq({ cookie: ck, url: '/api/leads' }), r2);
    const leadUrl2 = urls.find((u) => u.includes('/leads'));
    assert.ok(leadUrl2.includes('source=neq.arquitetura'), `url: ${leadUrl2}`);

    urls.length = 0;
    const r3 = fakeRes();
    await insightH(fakeReq({ method: 'POST', cookie: ck, body: { q: 'topo', category: 'arquitetura' } }), r3);
    assert.strictEqual(r3.statusCode, 200);
    const insightLeadUrl = urls.find((u) => u.includes('/leads'));
    assert.ok(insightLeadUrl.includes('source=eq.arquitetura'), `url: ${insightLeadUrl}`);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.GROQ_API_KEY;
    global.fetch = nativeFetch;
  }
});
