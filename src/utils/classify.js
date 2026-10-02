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

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function norm(s) {
  return stripAccents(s).toLowerCase();
}

// Retorna { area, confidence } — 0.9 nome, 0.7 origem, 0.3 geral
function classifyLead(lead = {}) {
  const nameText = norm(lead.name);
  const sourceText = norm(lead.source);
  for (const area of AREAS) {
    if (RULES[area].some((kw) => nameText.includes(kw))) return { area, confidence: 0.9 };
  }
  for (const area of AREAS) {
    if (RULES[area].some((kw) => sourceText.includes(kw))) return { area, confidence: 0.7 };
  }
  return { area: 'Geral', confidence: 0.3 };
}

const AREA_COLORS = ['#38BDF8', '#2E7CF6', '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#F472B6', '#94A3B8', '#2DD4BF', '#FB923C'];

// [{label, value, color}] ordenado desc
function areaDistribution(leads = []) {
  const counts = new Map();
  for (const l of leads) {
    const { area } = classifyLead(l);
    counts.set(area, (counts.get(area) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value], i) => ({ label, value, color: AREA_COLORS[i % AREA_COLORS.length] }))
    .sort((a, b) => b.value - a.value);
}

module.exports = { classifyLead, areaDistribution, AREAS };
