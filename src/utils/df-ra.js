/* Cidades/Regiões Administrativas do DF — reconhecimento por prompt (PT-BR, com/sem acento) */
const RAS = [
  'Brasília', 'Gama', 'Taguatinga', 'Brazlândia', 'Sobradinho', 'Planaltina',
  'Paranoá', 'Núcleo Bandeirante', 'Ceilândia', 'Guará', 'Cruzeiro',
  'Águas Claras', 'Arniqueira', 'Candangolândia', 'Fercal', 'Itapoã',
  'Jardim Botânico', 'Lago Norte', 'Lago Sul', 'Park Way', 'Riacho Fundo',
  'Riacho Fundo II', 'Recanto das Emas', 'Samambaia', 'Santa Maria',
  'São Sebastião', 'Sobradinho II', 'Sol Nascente', 'Estrutural',
  'Varjão', 'Vicente Pires', 'SIA', 'Asa Norte', 'Asa Sul',
];

const RAS_TIER1 = ['Brasília', 'Lago Sul', 'Lago Norte', 'Asa Sul', 'Asa Norte', 'Águas Claras', 'Cruzeiro', 'Park Way', 'Jardim Botânico', 'Guará'];
const RAS_TIER2 = RAS.filter((r) => !RAS_TIER1.includes(r));

function raName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

const byName = new Map(RAS.map((r) => [raName(r), r]));

const ALIAS = new Map([
  ['plano piloto', 'Brasília'],
  ['bda', 'Brasília'],
  ['ceilandia', 'Ceilândia'],
  ['vila estrutural', 'Estrutural'],
  ['sol nascente e por do sol', 'Sol Nascente'],
  ['por do sol', 'Sol Nascente'],
  ['rural do planalto central', 'Planaltina'],
]);

/* reconhece o RA/cidade dentro de um texto; raType: 'ra' | 'df' | null
   RA específico vence menção genérica a DF; sem nenhum → null */
function findRA(prompt) {
  const p = raName(prompt);
  if (!p) return null;
  for (const [key, ra] of byName) {
    const re = new RegExp(`(^|[^\\p{L}])${key}(s)?([^\\p{L}]|$)`, 'u');
    if (re.test(p)) return { ra, raType: 'ra' };
  }
  for (const [alias, ra] of ALIAS) {
    const re = new RegExp(`(^|[^\\p{L}])${raName(alias)}(s)?([^\\p{L}]|$)`, 'u');
    if (re.test(p)) return { ra, raType: 'ra' };
  }
  if (/\bdf\b|\bbrasil ?ia\b|distrito federal|todas as cidades|toda a regiao|regiao inteira|df inteiro/.test(p)) {
    return { ra: null, raType: 'df' };
  }
  return null;
}

/* queries de captura do nicho, uma por RA ("de uma em uma") */
function buildQueries(term, opts = {}) {
  const scope = opts.ra ? [opts.ra] : RAS_TIER1.concat(RAS_TIER2);
  return scope.map((ra) => `${term} ${ra} Brasília DF`);
}

module.exports = { RAS, RAS_TIER1, RAS_TIER2, findRA, buildQueries, raName };
