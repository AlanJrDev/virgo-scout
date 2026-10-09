const { test } = require('node:test');
const assert = require('node:assert');

const { normalizeLead, dedupeLeads, toCSVRow } = require('../utils/leads');
const { saveLeads } = require('../utils/spreadsheet');

test('normalizeLead limpa e padroniza lead do Maps', () => {
  const raw = {
    name: '  Escritório Silva Advocacia  ',
    rating: '4,8',
    reviews: '(1.234)',
    address: 'Asa Sul, Brasília - DF',
    phone: '(61) 99999-0000',
    website: 'https://exemplo.com/',
    source: 'advogados Distrito Federal',
  };
  const lead = normalizeLead(raw);
  assert.strictEqual(lead.name, 'Escritório Silva Advocacia');
  assert.strictEqual(lead.rating, 4.8);
  assert.strictEqual(lead.reviews, 1234);
  assert.ok(lead.phone.includes('61'));
  assert.ok(lead.captured_at);
});

test('normalizeLead preserva novos campos do enriquecimento', () => {
  const l = normalizeLead({ name: 'X', category: 'Advogado trabalhista', plus_code: 'Q5J3+WC Brasília',
    lat: '-15.79', lng: '-47.88', place_id: '0x935a3b:0x1', claimed: false, hours: 'Aberto ⋅ Fecha 18:00',
    closed: false, photos: 12, instagram: 'https://instagram.com/xadv', facebook: null, phone: '', website: '', source: 'q' });
  assert.strictEqual(l.category, 'Advogado trabalhista');
  assert.strictEqual(l.plus_code, 'Q5J3+WC Brasília');
  assert.strictEqual(l.lat, -15.79);
  assert.strictEqual(l.lng, -47.88);
  assert.strictEqual(l.place_id, '0x935a3b:0x1');
  assert.strictEqual(l.claimed, false);
  assert.strictEqual(l.hours, 'Aberto ⋅ Fecha 18:00');
  assert.strictEqual(l.closed, false);
  assert.strictEqual(l.photos, 12);
  assert.strictEqual(l.instagram, 'https://instagram.com/xadv');
  assert.strictEqual(l.facebook, null);
});

test('normalizeLead descarta telefone sem digitos (glifo de icone)', () => {
  const lead = normalizeLead({ name: 'X', phone: ' ', address: '', source: 't' });
  assert.strictEqual(lead.phone, '');
});

test('normalizeLead limpa endereco com icone e sufixo duplicado', () => {
  const lead = normalizeLead({
    name: 'X',
    address: ' SCN Quadra 4, Brasília - DF - Asa Sul, Brasília - DF',
    source: 't',
  });
  assert.ok(!/^[^\p{L}\d]/u.test(lead.address), `prefixo sujo: ${lead.address}`);
  assert.strictEqual(lead.address, 'SCN Quadra 4, Brasília - DF - Asa Sul');
});

test('dedupeLeads remove duplicados por nome+endereco', () => {
  const leads = [
    { name: 'A', address: 'Rua 1' },
    { name: 'a ', address: 'rua 1 ' },
    { name: 'B', address: 'Rua 2' },
  ];
  const uniq = dedupeLeads(leads);
  assert.strictEqual(uniq.length, 2);
});

test('toCSVRow escapa ponto-e-virgula e aspas', () => {
  const row = toCSVRow({ name: 'Silva; "Adv"', rating: 5 });
  assert.ok(row.includes('"Silva; ""Adv""'));
});

test('saveLeads grava CSV e JSON e retorna caminhos', async () => {
  const leads = [{ name: 'Teste', rating: 5, reviews: 10, address: 'DF', phone: '', website: '', source: 'test', captured_at: new Date().toISOString() }];
  const out = await saveLeads(leads, { basename: 'test-backend-validacao', outDir: './data', formats: ['csv', 'json'] });
  assert.ok(out.csv);
  assert.ok(out.json);
});
