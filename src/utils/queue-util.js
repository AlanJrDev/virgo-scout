/* Fila de detail do Capture V2: match primeiro, ambiguo ao final.
   skipPlaceIds descarta lead já detalhado nos últimos 30 dias (runner passa o Set).
   ATENÇÃO: cards da fase 1 vêm SEM place_id (place_id só existe após o detail) —
   o skip por place_id só tem efeito quando a fila recebe rows com place_id
   preenchido (flows de recaptura/detalhe re-run). Para recaptura incremental a
   partir da base existente use skipNames: Set de nomes normalizados
   (normalizeName; o runner passa os nomes frescos da base). */
const { relevanceScore } = require('./categories');

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDetailQueue(rows, category, opts = {}) {
  const skip = opts.skipPlaceIds || null;
  // normaliza os membros do Set: o runner pode passar nomes com acento/caixa original
  const skipNames = opts.skipNames ? new Set([...opts.skipNames].map(normalizeName)) : null;
  const queue = [];
  rows.forEach((row, idx) => {
    const r = relevanceScore(row, category);
    if (r.verdict === 'reject') return;
    if (skip && row.place_id && skip.has(row.place_id)) return;
    if (skipNames && skipNames.has(normalizeName(row && row.name))) return;
    // sem categoria no card → ambiguo: entra ao final da fila (pode receber detail se sobrar orçamento)
    const isAmbiguo = r.verdict === 'ambiguo' || !row.category;
    queue.push({ ...row, _cardIndex: idx, ...(isAmbiguo ? { _ambiguo: true } : {}) });
  });
  const rank = (x) => (x._ambiguo ? 1 : 0);
  return queue.sort((a, b) => rank(a) - rank(b) || relevanceScore(a, category).score - relevanceScore(b, category).score);
}

module.exports = { buildDetailQueue, normalizeName };
