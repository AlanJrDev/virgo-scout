/* Queries da categoria arquitetura/topografia/urbanismo — DF e cidades satélites */
const CITIES_ARQ = [
  'Brasília DF',
  'Ceilândia',
  'Taguatinga',
  'Águas Claras',
  'Samambaia',
  'Guará',
  'Sobradinho',
  'Planaltina',
  'Gama',
  'Santa Maria',
  'Brazlândia',
  'Cidade Ocidental',
  'Novo Gama',
];

const TERMS_ARQ = ['escritório de arquitetura', 'topografia', 'urbanismo'];

const QUERIES_ARQ = CITIES_ARQ.flatMap((c) => TERMS_ARQ.map((t) => `${t} ${c}`));

module.exports = { QUERIES_ARQ, CITIES_ARQ, TERMS_ARQ };
