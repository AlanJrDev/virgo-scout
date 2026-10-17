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

/* Raízes de relevância por nicho (nome+categoria do card do Maps). Visa o ruído
   que o Google mistura quando o nicho é escasso na RA (residenciais, jardins,
   limpeza, etc.). Raízes curtas (<=4) exigem início de palavra (aceita 2GEO). */
const NICHE_ROOTS = {
  advogados: ['advogad', 'advocac', 'procurador', 'juridic'],
  arquitetura: ['arquitet', 'urbanis'],
  tapecaria: ['tapec', 'tapet', 'carpet', 'cortina', 'persiana'],
  estofado: ['estofad', 'tapic', 'poltron', 'colchon', 'sofa', 'impermeabiliz'],
  topografia: ['topograf', 'geod', 'georref', 'terraplena', 'alinhamento', 'geo'],
};
const SHORT_MAX = 4;
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function rootsFor(category) {
  const roots = NICHE_ROOTS[category];
  if (!roots) return null;
  return [...new Set(roots.map((r) => normText(r)))].map((r) => (r.length <= SHORT_MAX
    ? new RegExp(`(?<![\\p{L}])${escapeRe(r)}`, 'iu')
    : new RegExp(escapeRe(r), 'iu')));
}
function normText(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function relevantRow(row, roots) {
  if (!roots) return true;
  const hasCategory = !!(row && row.category);
  const hay = `${normText(row && row.name)} ${normText(row && row.category)}`;
  if (roots.some((re) => re.test(hay))) return true;
  // sem categoria (legado/JSON simples) não temos como julgar: mantém
  return !hasCategory;
}
function relevanceFilter(rows, category) {
  const roots = rootsFor(category);
  if (!roots) return { kept: rows || [], dropped: 0 };
  const kept = [];
  let dropped = 0;
  for (const row of rows || []) {
    if (relevantRow(row, roots)) kept.push(row);
    else dropped += 1;
  }
  return { kept, dropped };
}
module.exports = { CATEGORIES, CAT_KEYS, tagOf, typeList, typeOfLead, matchesType, rootsFor, relevanceFilter };
