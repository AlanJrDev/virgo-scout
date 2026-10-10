// Classificador de área de atuação do lead — regras determinísticas (offline, sem custo).
// Normaliza acentos/caixa dos dois lados antes de casar palavras-chave.

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

// Categoria arquitetura/topografia/urbanismo — mesma mecânica, outro mapa
const AREAS_ARQ = ['Arquitetura', 'Urbanismo', 'Topografia'];

const RULES_ARQ = {
  Arquitetura: ['arquitet', 'projeto arquitetonico', 'design de interiores'],
  Urbanismo: ['urbanism', 'urbanist', 'planejamento urbano'],
  Topografia: ['topograf', 'geodes', 'cartograf', 'agrimens'],
};

const AREAS_TAP = ['Cortinas', 'Tapeçaria', 'Persianas'];

const RULES_TAP = {
  Tapeçaria: ['tapecaria', 'tapestaria', 'tapercaria', 'tapete'],
  Cortinas: ['cortina', 'cortineiro', 'voil'],
  Persianas: ['persiana'],
};

const AREAS_EST = ['Estofado', 'Sofás'];

const RULES_EST = {
  Estofado: ['estofado', 'impermeabiliz', 'reforma de sofa'],
  Sofás: ['sofa', 'poltron'],
};

function rulesFor(category) {
  if (category === 'arquitetura') return { areas: AREAS_ARQ, rules: RULES_ARQ, fallback: 'Outros' };
  if (category === 'tapestaria') return { areas: AREAS_TAP, rules: RULES_TAP, fallback: 'Geral' };
  if (category === 'estofado') return { areas: AREAS_EST, rules: RULES_EST, fallback: 'Geral' };
  return { areas: AREAS, rules: RULES, fallback: 'Geral' };
}

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function norm(s) {
  return stripAccents(s).toLowerCase();
}

// Retorna { area, confidence } — 0.95 categoria oficial, 0.9 nome, 0.7 origem, 0.6 título do site, 0.3 geral/outros
function classifyLead(lead = {}, category) {
  const { areas, rules, fallback } = rulesFor(category);
  // categoria oficial do Maps é o sinal mais forte
  const catText = norm(lead.category);
  if (catText) {
    for (const area of areas) {
      if (rules[area].some((kw) => catText.includes(kw))) return { area, confidence: 0.95 };
    }
  }
  const nameText = norm(lead.name);
  // origin = query original da captura; source virou tag de categoria ('arquitetura'|'advogados')
  const sourceText = norm(lead.origin || lead.source);
  for (const area of areas) {
    if (rules[area].some((kw) => nameText.includes(kw))) return { area, confidence: 0.9 };
  }
  for (const area of areas) {
    if (rules[area].some((kw) => sourceText.includes(kw))) return { area, confidence: 0.7 };
  }
  // título do site: quarta camada, só quando as anteriores não casaram
  const titleText = norm(lead.site_title);
  if (titleText) {
    for (const area of areas) {
      if (rules[area].some((kw) => titleText.includes(kw))) return { area, confidence: 0.6 };
    }
  }
  return { area: fallback, confidence: 0.3 };
}

const AREA_COLORS = ['#38BDF8', '#2E7CF6', '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#F472B6', '#94A3B8', '#2DD4BF', '#FB923C'];

// [{label, value, color}] ordenado desc
function areaDistribution(leads = [], category) {
  const counts = new Map();
  for (const l of leads) {
    const { area } = classifyLead(l, category);
    counts.set(area, (counts.get(area) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value], i) => ({ label, value, color: AREA_COLORS[i % AREA_COLORS.length] }))
    .sort((a, b) => b.value - a.value);
}

module.exports = { classifyLead, areaDistribution, AREAS, AREAS_ARQ };
