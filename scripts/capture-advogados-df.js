require('dotenv').config();
const { scrapeMany } = require('../src/scraper/mapsScraper');
const { dedupeLeads } = require('../src/utils/leads');
const { saveLeads } = require('../src/utils/spreadsheet');
const { QUERIES } = require('./queries');
const { sbEnabled } = require('../src/utils/sb');
const { syncLeads } = require('./sync-supabase');

async function main() {
  const category = process.env.CAPTURE_CATEGORY || 'advogados';
  const only = process.env.QUERIES ? process.env.QUERIES.split('|') : QUERIES;
  const maxDetails = parseInt(process.env.MAX_DETAILS || '80', 10);
  const maxScrolls = parseInt(process.env.MAX_SCROLLS || '40', 10);
  console.log(`[capture] ${only.length} buscas | maxDetails=${maxDetails} maxScrolls=${maxScrolls}`);
  const t0 = Date.now();
  const { leads: raw, telemetry } = await scrapeMany(only, { maxDetails, maxScrolls });
  const agg = (telemetry || []).reduce(
    (a, t) => ({ cards: a.cards + (t.cards || 0), relevant: a.relevant + (t.relevant || 0), dropped: a.dropped + (t.dropped || 0), failed: a.failed + (t.failed ? 1 : 0) }),
    { cards: 0, relevant: 0, dropped: 0, failed: 0 }
  );
  console.log(`[capture] telemetria: cards=${agg.cards} rel=${agg.relevant} desc=${agg.dropped} falhas=${agg.failed}`);
  const uniq = dedupeLeads(raw.map((l) => ({ ...l, name: l.name || '', address: l.address || '' })).filter((l) => l.name));
  const stamp = new Date().toISOString().slice(0, 10);
  const basename = process.env.BASENAME || `advogados-df-${stamp}`;
  const out = await saveLeads(uniq, { basename, outDir: './data', formats: ['csv', 'json', 'xlsx'] });
  console.log(`[capture] RAW=${raw.length} UNICOS=${uniq.length} em ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(JSON.stringify(out, null, 2));
  if (sbEnabled()) {
    try {
      const s = await syncLeads({ category, runBuild: true });
      console.log(`[sync] ${s.synced} leads → Supabase (${s.file})`);
    } catch (e) {
      console.error('[sync] falhou (captura salva localmente):', e.message);
    }
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { QUERIES, main };
