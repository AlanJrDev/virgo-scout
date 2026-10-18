// Testes das partes puras do pipeline V2 (fila) sem browser
const { test } = require('node:test');
const assert = require('node:assert');
const { buildDetailQueue } = require('../utils/queue-util');

test('buildDetailQueue ordena match antes de ambiguo e respeita skip de place_id fresco', () => {
  const rows = [
    { name: 'B', category: 'Jardim botânico', place_id: '0xskip' },
    { name: 'TOPOGRAFIA X', category: 'Serviço de topógrafo' },
    { name: 'Sem categoria', category: null },
    { name: '2GEO', category: null, place_id: '0xkeep' },
  ];
  const q = buildDetailQueue(rows, 'topografia', { skipPlaceIds: new Set(['0xskip']) });
  assert.strictEqual(q.length, 3); // 0xskip fora
  assert.strictEqual(q[0].name, 'TOPOGRAFIA X');
  assert.strictEqual(q[0]._cardIndex, 1);
  assert.strictEqual(q[1].name, 'Sem categoria'); // ambiguo ao final
  assert.strictEqual(q[1]._ambiguo, true);
  assert.strictEqual(q[2].name, '2GEO');
});

test('buildDetailQueue respeita skipNames (recaptura incremental pela base)', () => {
  const rows = [
    { name: 'Topografia Silva', category: 'Serviço de topógrafo' },
    { name: 'TOPOGRAFIA NORTE', category: 'Serviço de topógrafo' },
  ];
  const q = buildDetailQueue(rows, 'topografia', { skipNames: new Set(['topográfia   silva']) });
  assert.strictEqual(q.length, 1); // skip normaliza acento/caixa/espaço
  assert.strictEqual(q[0].name, 'TOPOGRAFIA NORTE');
  assert.strictEqual(q[0]._cardIndex, 1);
});
