// Classificador de área de atuação do lead — regras determinísticas (offline, sem custo).
// Normaliza acentos/caixa dos dois lados antes de casar palavras-chave.

const { CATEGORIES, typeOfLead } = require('./categories');

const AREAS = [
  'Trabalhista',
  'Criminal',
  'Família',
  'Civil',
  'Previdenciário',
  'Tributário',
  'Empresarial',
  'Imobiliário',
  'Consumidor',
];

// palavras-chave SEM acento, em caixa baixa (casam contra texto já normalizado)
const RULES = {
  Trabalhista: ['trabalhista', 'trabalho', 'clt', 'reclamacao', 'rescisao', 'sindicato'],
  Criminal: ['criminal', 'penal', 'prisao', 'habeas', 'defesa legal'],
  Família: ['familia', 'divorcio', 'guarda', 'pensao', 'aliment', 'uniao estavel'],
  Civil: ['civil', 'indeniza', 'contrato', 'responsabilidade civil'],
  Previdenciário: ['previdenci', 'inss', 'aposentadoria', 'auxilio'],
  Tributário: ['tribut', 'fiscal', 'imposto', 'contencioso'],
  Empresarial: ['empresarial', 'societari', 'contrato social', 'comercial', 'recuperacao judicial'],
  Imobiliário: ['imobili', 'loteamento', 'constru', 'locacao', 'condominio'],
  Consumidor: ['consumidor', 'cdc'],
};

// Categoria arquitetura/urbanismo — mesma mecânica, outro mapa (topografia tem schema próprio)
const AREAS_ARQ = ['Arquitetura', 'Urbanismo', 'Topografia'];

const RULES_ARQ = {
  Arquitetura: ['arquitet', 'projeto arquitetonico', 'design de interiores'],
  Urbanismo: ['urbanism', 'urbanist', 'planejamento urbano'],
  Topografia: ['topograf', 'geodes', 'cartograf', 'agrimens'],
};

const AREAS_TAP = ['Cortinas', 'Tapeçaria', 'Persianas'];

const RULES_TAP = {
  Tapeçaria: ['tapecaria', 'tapercaria', 'tapete'],
  Cortinas: ['cortina', 'cortineiro', 'voil'],
  Persianas: ['persiana'],
};

const AREAS_EST = ['Estofado', 'Sofás'];

const RULES_EST = {
  Estofado: ['estofado', 'impermeabiliz', 'reforma de sofa'],
  Sofás: ['sofa', 'poltron'],
};

// AREAS_TOP do schema próprio (antigamente saíam nas AREAS numéricas dos advogados — chips estáticos)
const AREAS_TOP = ['Levantamento', 'Georreferenciamento', 'Topografia', 'Outros'];

const RULES_TOP = {
  Levantamento: ['levantamento topografico', 'levantamento', 'mapeamento'],
  Georreferenciamento: ['georreferenc', 'georeferenc', 'geoprocessament', 'geodes', 'agro'],
  // 'topo' genérico por último — 'topografo/topografia' já casa com 'topograf' antes,
  // e 'levantamento topografico' casa com Levantamento pela ordem das áreas
  Topografia: ['topograf', 'topografo', 'topo'],
};

// REGISTRY por categoria — cada nicho traz o próprio schema de áreas/rules/fallback.
// Categorias.js pode sobrescrever via CATEGORIES[tag].areasRules (mesma forma do schema).
const AREA_SCHEMA = {
  advogados: { areas: AREAS, rules: RULES, fallback: 'Geral' },
  arquitetura: { areas: AREAS_ARQ, rules: RULES_ARQ, fallback: 'Outros' },
  tapecaria: { areas: AREAS_TAP, rules: RULES_TAP, fallback: 'Geral' },
  estofado: { areas: AREAS_EST, rules: RULES_EST, fallback: 'Geral' },
  topografia: { areas: AREAS_TOP, rules: RULES_TOP, fallback: 'Outros' },
};

// categoria fora do registry → sem área alguma (não cai nas dos advogados)
const UNKNOWN_SCHEMA = { areas: ['Outros'], rules: {}, fallback: 'Outros' };

function rulesFor(category) {
  const cfg = CATEGORIES[category];
  if (cfg && cfg.areasRules) return cfg.areasRules;
  if (category != null && category !== '' && category !== 'all' && AREA_SCHEMA[category]) return AREA_SCHEMA[category];
  if (!category || category === 'all') return AREA_SCHEMA.advogados;
  return UNKNOWN_SCHEMA;
}

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function norm(s) {
  return stripAccents(s).toLowerCase();
}

// primeira área cujas keywords casam — rules podem faltar (schema desconhecido)
function hit(text, areas, rules) {
  for (const area of areas) {
    const kws = rules[area] || [];
    if (kws.some((kw) => text.includes(kw))) return area;
  }
  return null;
}

// Retorna { area, confidence } — 0.95 categoria oficial, 0.9 nome, 0.7 origem, 0.6 título do site, 0.3 geral/outros
function classifyLead(lead = {}, category) {
  const { areas, rules, fallback } = rulesFor(category);
  // categoria oficial do Maps é o sinal mais forte
  const catText = norm(lead.category);
  if (catText) {
    const a = hit(catText, areas, rules);
    if (a) return { area: a, confidence: 0.95 };
  }
  const nameText = norm(lead.name);
  // origin = query original da captura; source virou tag de categoria ('arquitetura'|'advogados')
  const sourceText = norm(lead.origin || lead.source);
  let a = hit(nameText, areas, rules);
  if (a) return { area: a, confidence: 0.9 };
  a = hit(sourceText, areas, rules);
  if (a) return { area: a, confidence: 0.7 };
  // título do site: quarta camada, só quando as anteriores não casaram
  const titleText = norm(lead.site_title);
  if (titleText) {
    a = hit(titleText, areas, rules);
    if (a) return { area: a, confidence: 0.6 };
  }
  return { area: fallback, confidence: 0.3 };
}

const AREA_COLORS = ['#38BDF8', '#2E7CF6', '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#F472B6', '#94A3B8', '#2DD4BF', '#FB923C'];

// [{label, value, color}] ordenado desc
function areaDistribution(leads = [], category) {
  const counts = new Map();
  for (const l of leads) {
    const { area } = classifyLead(l, category === 'all' ? typeOfLead(l) : category);
    counts.set(area, (counts.get(area) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value], i) => ({ label, value, color: AREA_COLORS[i % AREA_COLORS.length] }))
    .sort((a, b) => b.value - a.value);
}

module.exports = { classifyLead, areaDistribution, AREAS, AREAS_ARQ, AREAS_TOP, AREA_SCHEMA, UNKNOWN_SCHEMA };
