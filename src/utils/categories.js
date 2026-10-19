const CATEGORIES = {
  advogados: { tag: 'advogados', label: 'Advogado', script: 'capture-advogados-df.js', queriesModule: './queries', queriesExport: 'QUERIES', basename: null, terms: ['advogado', 'advocacia', 'escritório de advocacia', 'advogado trabalhista', 'advogado imobiliário', 'advogado cível', 'advogado previdenciário'] },
  arquitetura: { tag: 'arquitetura', label: 'Arquitetura', script: 'capture-arquitetura.js', queriesModule: './queries-arquitetura', queriesExport: 'QUERIES_ARQ', basename: 'arquitetura-df-max', terms: ['arquitetura', 'arquiteto', 'arquiteta', 'projeto arquitetônico'] },
  tapecaria: { tag: 'tapecaria', label: 'Tapeçaria', script: 'capture-tapecaria.js', queriesModule: './queries-tapecaria', queriesExport: 'QUERIES_TAP', basename: 'tapecaria-df-max', terms: ['tapeçaria', 'tapiçaria', 'arroz de tapete', 'tapetes', 'cortinas', 'persianas', 'papel de parede'] },
  estofado: { tag: 'estofado', label: 'Estofado', script: 'capture-estofado.js', queriesModule: './queries-estofado', queriesExport: 'QUERIES_EST', basename: 'estofado-df-max', terms: ['estofados', 'limpeza de estofados', 'tapetes', 'higienização de estofados', 'conserto de estofados', 'encapamento de estofados'] },
  topografia: { tag: 'topografia', label: 'Topografia', script: 'capture-topografia.js', queriesModule: './queries-topografia', queriesExport: 'QUERIES_TOP', basename: 'topografia-df-max', terms: ['topografia', 'topógrafo', 'levantamento topográfico', 'georreferenciamento'] },
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
  topografia: ['topograf', 'geod', 'georref', 'terraplena', 'alinhamento', 'geo', 'agronom'],
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
function relevanceScore(row, category) {
  const roots = rootsFor(category);
  if (!roots) return { score: 0, verdict: 'ambiguo' };
  const name = normText(row && row.name);
  const cat = normText(row && row.category);
  const nameHit = roots.some((re) => re.test(name));
  const catHit = roots.some((re) => re.test(cat));
  if (nameHit && catHit) return { score: 2, verdict: 'match' };
  if (nameHit) return { score: 1, verdict: 'match' };
  if (!cat) return { score: 1, verdict: 'match' }; // sem categoria: mantém (comportamento do filtro de sync)
  if (catHit) return { score: 1, verdict: 'match' };
  return { score: 0, verdict: 'reject' };
}
function termsOfCategory(category) {
  const c = CATEGORIES[category];
  return c && Array.isArray(c.terms) && c.terms.length ? c.terms.slice() : [category];
}
module.exports = { CATEGORIES, CAT_KEYS, tagOf, typeList, typeOfLead, matchesType, rootsFor, relevanceFilter, relevanceScore, termsOfCategory };
