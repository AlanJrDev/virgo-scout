const CATEGORIES = {
  advogados: { tag: 'advogados', label: 'Advogado', script: 'capture-advogados-df.js', queriesModule: './queries', queriesExport: 'QUERIES', basename: null },
  arquitetura: { tag: 'arquitetura', label: 'Arquitetura', script: 'capture-arquitetura.js', queriesModule: './queries-arquitetura', queriesExport: 'QUERIES_ARQ', basename: 'arquitetura-df-max' },
  tapecaria: { tag: 'tapecaria', label: 'Tapeçaria', script: 'capture-tapecaria.js', queriesModule: './queries-tapecaria', queriesExport: 'QUERIES_TAP', basename: 'tapecaria-df-max' },
  estofado: { tag: 'estofado', label: 'Estofado', script: 'capture-estofado.js', queriesModule: './queries-estofado', queriesExport: 'QUERIES_EST', basename: 'estofado-df-max' },
  topografia: { tag: 'topografia', label: 'Topografia', script: 'capture-topografia.js', queriesModule: './queries-topografia', queriesExport: 'QUERIES_TOP', basename: 'topografia-df-max' },
};
const CAT_KEYS = Object.keys(CATEGORIES);
function tagOf(category) { return (CATEGORIES[category] || CATEGORIES.advogados).tag; }
function typeList(lead) {
  const raw = (lead && (lead.types || lead.source)) || 'advogados';
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}
function typeOfLead(lead) { return typeList(lead)[0] || 'advogados'; }
function matchesType(lead, type) { return type === 'all' || typeList(lead).includes(type); }
module.exports = { CATEGORIES, CAT_KEYS, tagOf, typeList, typeOfLead, matchesType };
