// Testes do refill nominal (loop 100% stubado — sem banco e sem browser real)
const { test } = require('node:test');
const assert = require('node:assert');
const { toRow } = require('../../scripts/sync-supabase');

const PENDING = [
  { id: 'a1', name: 'Souza Advocacia', address: 'SCS Quadra 2, Asa Sul, Brasília - DF', website: null, source: 'advogados' },
  { id: 'b2', name: 'Ribeiro Advogados', address: null, website: null, source: 'advogados' },
  { id: 'c3', name: 'Carvalho e Associados', address: null, website: null, source: 'advogados' },
];

const LEAD_A1 = {
  name: 'Souza Advocacia',
  address: 'SCS Quadra 2, Asa Sul, Brasília - DF',
  phone: '+55 61 99999-0000',
  website: 'https://souzaadv.com.br',
  rating: '4,8',
  reviews: '120',
  category: 'Escritório de advocacia',
  plus_code: '3J8Q+X8',
  lat: '-15.79',
  lng: '-47.88',
  place_id: '0x1234:0x5678',
  claimed: true,
  hours: 'Aberto ⋅ Fecha 18:00',
  closed: false,
  photos: 10,
  instagram: 'https://instagram.com/souzaadv',
  facebook: '',
};

test('refill consulta pendentes, busca por nome+cidade e upserta só quem ganha fone/site', async () => {
  const { main } = require('../../scripts/capture-refill');
  const calls = [];
  const enrichCalls = [];
  let browserClosed = false;

  const fetchImpl = async (path, opts = {}) => {
    calls.push({ path, opts });
    if (!opts.method) return PENDING; // GET pendentes
    return null; // POST upsert
  };
  const enrichImpl = async (page, q) => {
    enrichCalls.push({ page, q });
    if (q.startsWith('Souza')) return LEAD_A1; // ganha fone + site
    if (q.startsWith('Ribeiro')) return { name: 'Ribeiro Advogados', phone: '', website: '' }; // sem fone/site → pular
    return null; // sem resultado → pular
  };
  const launchImpl = async () => ({ browser: { close: async () => { browserClosed = true; } }, page: {} });

  const result = await main({ fetchImpl, enrichImpl, launchImpl, limit: 3, sleep: async () => {} });

  // consulta de pendentes: filtros resumíveis + limit único na URL (lesson Batch C)
  assert.strictEqual(calls.length, 2, '1 GET + 1 POST');
  const getUrl = calls[0].path;
  assert.strictEqual(getUrl, 'leads?select=id,name,address,website,types,source&and=(phone.is.null,email.is.null,instagram.is.null)&order=id&limit=3');
  assert.strictEqual((getUrl.match(/limit=/g) || []).length, 1, 'um único limit na URL');

  // query gerada por lead: nome + última parte do address, ou 'Brasília DF' sem address
  assert.strictEqual(enrichCalls.length, 3);
  assert.strictEqual(enrichCalls[0].q, 'Souza Advocacia  Brasília - DF');
  assert.strictEqual(enrichCalls[1].q, 'Ribeiro Advogados Brasília DF');
  assert.strictEqual(enrichCalls[2].q, 'Carvalho e Associados Brasília DF');
  assert.ok(enrichCalls[0].page, 'enrich recebe a page do browser');

  // upsert apenas do lead que ganhou fone/site
  const upserts = calls.filter((c) => c.opts.method === 'POST');
  assert.strictEqual(upserts.length, 1);
  const up = upserts[0];
  assert.strictEqual(up.path, 'leads?on_conflict=id');
  assert.strictEqual(up.opts.headers.Prefer, 'resolution=merge-duplicates');
  assert.ok(Array.isArray(up.opts.body) && up.opts.body.length === 1, 'body é array de 1 linha');
  const row = up.opts.body[0];
  const expected = toRow({ ...PENDING[0], ...LEAD_A1, source: PENDING[0].source });
  expected.id = 'a1'; // id do banco é preservado: upsert por cima da linha existente
  assert.deepStrictEqual(row, expected);
  assert.strictEqual(row.id, 'a1');
  assert.strictEqual(row.phone, '61999990000');
  assert.strictEqual(row.website, 'https://souzaadv.com.br');
  assert.strictEqual(row.source, 'advogados');

  assert.ok(browserClosed, 'browser sempre fechado');
  assert.deepStrictEqual(result, { saved: 1, total: 3 });
});

test('refill sem pendentes não abre browser', async () => {
  const { main } = require('../../scripts/capture-refill');
  let launched = false;
  const result = await main({
    fetchImpl: async () => [],
    launchImpl: async () => { launched = true; return { browser: { close: async () => {} }, page: {} }; },
    limit: 40,
    sleep: async () => {},
  });
  assert.strictEqual(launched, false);
  assert.deepStrictEqual(result, { saved: 0, total: 0 });
});

test('refill com fetchImpl default e sem SUPABASE_URL → fail-closed claro', async () => {
  delete process.env.SUPABASE_URL;
  const { main } = require('../../scripts/capture-refill');
  await assert.rejects(() => main({ limit: 5 }), /supabase_not_configured/);
});
