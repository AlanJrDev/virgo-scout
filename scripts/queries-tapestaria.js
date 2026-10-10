/* Queries da categoria tapeçaria — DF inteiro, priorizando alto poder aquisitivo */
const RAS_TIER1 = [
  'Lago Sul', 'Lago Norte', 'Asa Sul', 'Asa Norte', 'Plano Piloto',
  'Águas Claras', 'Cruzeiro', 'Park Way', 'Jardim Botânico',
];

const RAS_TIER2 = [
  'Guará', 'Sobradinho', 'Sobradinho II', 'Paranoá', 'Núcleo Bandeirante',
  'Santa Maria', 'Samambaia', 'Taguatinga', 'Ceilândia', 'Gama',
  'Brazlândia', 'Itapoã', 'Estrutural', 'Sol Nascente',
];

const TERM_TAP = 'tapeçaria';

const QUERIES_TAP = [...RAS_TIER1, ...RAS_TIER2].map((ra) => `${TERM_TAP} ${ra} Brasília DF`);

module.exports = { QUERIES_TAP, RAS_TIER1, RAS_TIER2 };
