require('dotenv').config();
const { scrapeMany } = require('../src/scraper/mapsScraper');
const { dedupeLeads } = require('../src/utils/leads');
const { saveLeads } = require('../src/utils/spreadsheet');

const QUERIES = [
  'advogados Distrito Federal',
  'advogado Brasília DF',
  'escritório de advocacia Brasília',
  'advocacia Asa Sul Brasília',
  'advocacia Asa Norte Brasília',
  'advogado Taguatinga DF',
  'advogado Ceilândia DF',
  'advogado Águas Claras DF',
  'advogado trabalhista Brasília',
  'advogado criminal Brasília',
  'advogado civil Brasília',
  'advogado previdenciário Brasília',
  'advogado empresarial Brasília',
  'advogado família Brasília',
  'advogado Guará DF',
  'advogado Samambaia DF',
  'advogado Sobradinho DF',
  'advogado Gama DF',
  'advogado Santa Maria DF',
  'advogado Planaltina DF',
  'advogado tributário Brasília',
  'advogado imobiliário Brasília',
  'advogado consumidor Brasília',
  'advogado trânsito Brasília',
  'advogado previdência Brasília',
  'advogado inventário Brasília',
];

async function main() {
  const only = process.env.QUERIES ? process.env.QUERIES.split('|') : QUERIES;
  const maxDetails = parseInt(process.env.MAX_DETAILS || '80', 10);
  const maxScrolls = parseInt(process.env.MAX_SCROLLS || '40', 10);
  console.log(`[capture] ${only.length} buscas | maxDetails=${maxDetails} maxScrolls=${maxScrolls}`);
  const t0 = Date.now();
  const raw = await scrapeMany(only, { maxDetails, maxScrolls });
  const uniq = dedupeLeads(raw.map((l) => ({ ...l, name: l.name || '', address: l.address || '' })).filter((l) => l.name));
  const stamp = new Date().toISOString().slice(0, 10);
  const basename = process.env.BASENAME || `advogados-df-${stamp}`;
  const out = await saveLeads(uniq, { basename, outDir: './data', formats: ['csv', 'json', 'xlsx'] });
  console.log(`[capture] RAW=${raw.length} UNICOS=${uniq.length} em ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { QUERIES };
