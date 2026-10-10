/* Queries da categoria estofado — DF inteiro, priorizando alto poder aquisitivo */
const RAS_TIER1 = [
  'Lago Sul', 'Lago Norte', 'Asa Sul', 'Asa Norte', 'Plano Piloto',
  'Águas Claras', 'Cruzeiro', 'Park Way', 'Jardim Botânico',
];

const RAS_TIER2 = [
  'Guará', 'Sobradinho', 'Sobradinho II', 'Paranoá', 'Núcleo Bandeirante',
  'Santa Maria', 'Samambaia', 'Taguatinga', 'Ceilândia', 'Gama',
  'Brazlândia', 'Itapoã', 'Estrutural', 'Sol Nascente',
];

const TERM_EST = 'estofado';

const QUERIES_EST = [...RAS_TIER1, ...RAS_TIER2].map((ra) => `${TERM_EST} ${ra} Brasília DF`);

module.exports = { QUERIES_EST, RAS_TIER1, RAS_TIER2 };
