/* Dedupe do banco de leads. npm run dedupe [-- --apply]
   Sem --apply: só mostra plano (quantos grupos/deletions). */
require('dotenv').config();
const { sbEnabled } = require('../src/utils/sb');
const { dedupeLeads } = require('../src/utils/dedupe');

(async () => {
  if (!sbEnabled()) { console.error('[dedupe] Supabase desligado'); process.exit(1); }
  const apply = process.argv.includes('--apply');
  const r = await dedupeLeads({ apply });
  console.log(`[dedupe] ${r.rows} leads no banco | ${r.groups.length} grupos duplicados | ${r.removed} removidos${apply ? '' : ' (dry-run, use --apply p/ executar)'}`);
  for (const g of r.groups) {
    console.log(` - canônica ${g.canonical_id} | deleta: ${g.deletes.join(', ')}`);
    if (Object.keys(g.patch || {}).length) console.log(`   patch: ${JSON.stringify(g.patch)}`);
  }
  if (apply) console.log('[dedupe] aplicado.');
})().catch((e) => { console.error('[dedupe]', e.message); process.exit(1); });
