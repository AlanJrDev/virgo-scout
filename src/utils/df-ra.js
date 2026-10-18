/* Cidades/Regiões Administrativas do DF — reconhecimento por prompt (PT-BR, com/sem acento) */
/* RAs oficiais do DF (37, SEGOV/Wikipédia jul-2026) + Asa Sul/Norte como termos de busca
   (fazem parte do Plano Piloto, mas no Maps rendem mais por serem áreas menores) */
const RAS = [
  'Brasília', 'Asa Sul', 'Asa Norte',
  'Gama', 'Ponte Alta', 'Taguatinga', 'Brazlândia', 'Sobradinho', 'Planaltina',
  'Arapoanga', 'Paranoá', 'Núcleo Bandeirante', 'Ceilândia', 'Guará', 'Cruzeiro',
  'Sudoeste/Octogonal',
  'Águas Claras', 'Arniqueira', 'Candangolândia', 'Fercal', 'Itapoã',
  'Jardim Botânico', 'Lago Norte', 'Lago Sul', 'Park Way', 'Riacho Fundo',
  'Riacho Fundo II', 'Recanto das Emas', 'Água Quente', 'Samambaia',
  'Santa Maria', 'São Sebastião', 'Sobradinho II', '26 de Setembro',
  'Sol Nascente', 'Estrutural', 'Varjão', 'Vicente Pires', 'SIA',
];

const RAS_TIER1 = ['Brasília', 'Lago Sul', 'Lago Norte', 'Asa Sul', 'Asa Norte', 'Águas Claras', 'Cruzeiro', 'Park Way', 'Jardim Botânico', 'Guará'];
const RAS_TIER2 = RAS.filter((r) => !RAS_TIER1.includes(r));

function raName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

const byName = new Map(RAS.map((r) => [raName(r), r]));
/* ordem de matching do findRA: RA específico VENCE a menção genérica 'Brasília DF'
   (suffixo presente em TODAS as queries de captura) — itera todo mundo EXCETO
   Brasília primeiro e só depois Brasília. */
const byNameSpecificFirst = [...byName].sort((a, b) => (a[0] === 'brasilia') - (b[0] === 'brasilia'));

const ALIAS = new Map([
  ['plano piloto', 'Brasília'],
  ['bda', 'Brasília'],
  ['ceilandia', 'Ceilândia'],
  ['vila estrutural', 'Estrutural'],
  ['scia', 'Estrutural'],
  ['sudoeste', 'Sudoeste/Octogonal'],
  ['octogonal', 'Sudoeste/Octogonal'],
  ['por do sol', 'Sol Nascente'],
  ['sol nascente e por do sol', 'Sol Nascente'],
  ['rural do planalto central', 'Planaltina'],
]);

/* reconhece o RA/cidade dentro de um texto; raType: 'ra' | 'df' | null
   RA específico vence menção genérica a DF; sem nenhum → null */
function findRA(prompt) {
  const p = raName(prompt);
  if (!p) return null;
  for (const [key, ra] of byNameSpecificFirst) {
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

/* plano de captura: [{ra, query}] — Brasília é o DF inteiro: não duplica o termo */
function buildPlan(term, opts = {}) {
  const scope = opts.ra ? [opts.ra] : RAS;
  const seen = new Set();
  const out = [];
  for (const ra of scope) {
    const query = ra === 'Brasília' ? `${term} Brasília DF` : `${term} ${ra} Brasília DF`;
    if (seen.has(query)) continue;
    seen.add(query);
    out.push({ ra, query });
  }
  return out;
}
function buildQueries(term, opts = {}) {
  return buildPlan(term, opts).map((p) => p.query);
}

module.exports = { RAS, RAS_TIER1, RAS_TIER2, findRA, buildPlan, buildQueries, raName };
