/* Queries da categoria topografia — DF inteiro, uma query por RA (fonte: df-ra.js, 39 regiões) */
const { buildQueries } = require('../src/utils/df-ra');

const TERM_TOP = 'topografia';
const QUERIES_TOP = buildQueries(TERM_TOP);

module.exports = { QUERIES_TOP, TERM_TOP };
