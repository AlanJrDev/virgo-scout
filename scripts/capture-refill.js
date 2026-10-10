/* Refill: re-processa leads sem telefone/canal via busca nominal no Maps.
   npm run capture:refill [limite] — resumível (só pega lead sem phone/email/instagram). */
require('dotenv').config();
const { launchBrowser, enrichOneByQuery } = require('../src/scraper/mapsScraper');
const { sbFetch } = require('../src/utils/sb');
const { toRow } = require('./sync-supabase');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main({ fetchImpl = sbFetch, enrichImpl = enrichOneByQuery, launchImpl = launchBrowser, limit, sleep: pause = sleep } = {}) {
  const lim = limit ?? parseInt(process.argv[2] || '40', 10);
  // sbFetch DIRETO (não sbFetchAll): limit já está na URL — duplicar o param quebra o PostgREST
  const rows = (await fetchImpl(
    `leads?select=id,name,address,website,types,source&and=(phone.is.null,email.is.null,instagram.is.null)&order=id&limit=${lim}`
  )) || [];
  if (!rows.length) { console.log('[refill] nenhum lead pendente'); return { saved: 0, total: 0 }; }
  const { browser, page } = await launchImpl({ headless: true });
  let saved = 0;
  try {
    for (const r of rows) {
      const q = `${r.name} ${String(r.address || '').split(',').slice(-1)[0] || 'Brasília DF'}`;
      try {
        const lead = await enrichImpl(page, q);
        if (!lead || !lead.name) continue;
        if (lead.phone || lead.website) {
          const row = toRow({ ...r, ...lead, source: r.source });
          row.id = r.id; // preserva o id da linha do banco: upsert por cima do lead existente
          await fetchImpl('leads?on_conflict=id', { method: 'POST', body: [row], headers: { Prefer: 'resolution=merge-duplicates' } });
          saved++;
          console.log(`[refill] ${r.name} -> fone=${lead.phone ? 'sim' : 'não'} site=${lead.website ? 'sim' : 'não'}`);
        }
      } catch (e) { console.error(`[refill] falha "${q}": ${e.message}`); }
      await pause(2500);
    }
  } finally { await browser.close().catch(() => {}); }
  console.log(`[refill] ${saved}/${rows.length} leads atualizados`);
  return { saved, total: rows.length };
}

if (require.main === module) {
  main().catch((e) => { console.error('[refill]', e.message); process.exit(1); });
}
module.exports = { main };
