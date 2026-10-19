/* Enriquece leads COM site: analisa o site e grava sinais no Supabase.
   npm run enrich [limite]  — resumível (pula leads com enriched_at). */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { analyzeSite } = require('../src/enrich/site-analyzer');
const { waWriteFields } = require('../src/utils/wa-audit');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const rows = (await sbFetch(`leads?select=id,website,phone,address&website=not.is.null&enriched_at=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich] ${rows.length} leads com site a analisar`);
  let ok = 0, off = 0, fail = 0;
  for (const r of rows) {
    const s = await analyzeSite(r.website);
    if (s.ok === false) {
      off++;
      console.log(`[enrich] site morto ${r.id} (${r.website.slice(0, 40)}) — fica p/ próxima run`);
      await sleep(400);
      continue;
    }
    const patch = { enriched_at: new Date().toISOString() };
    if (s.email) patch.email = s.email;
    if (s.instagram) patch.instagram = s.instagram;
    if (s.facebook) patch.facebook = s.facebook;
    if (s.since_year) patch.since_year = s.since_year;
    if (s.title) patch.site_title = s.title;
    const wa = waWriteFields({ whatsapp: s.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: s.final_url || r.website });
    if (wa) Object.assign(patch, wa);
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: patch });
      ok++; console.log(`[enrich] ok ${r.website.slice(0, 40)} -> ${JSON.stringify({ e: s.email, ig: s.instagram, wa: !!s.whatsapp, yr: s.since_year })}`);
    } catch (e) {
      if (/wa_(source|status|evidence|checked_at)/.test(e.message)) {
        console.error('[enrich] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor');
        throw e;
      }
      fail++; console.error(`[enrich] erro ${r.id}: ${e.message}`);
    }
    await sleep(400);
  }
  console.log(`[enrich] concluído: ${ok} ok, ${off} sem site, ${fail} falhas`);
}

if (require.main === module) {
  main().catch((e) => { console.error('[enrich]', e.message); process.exit(1); });
}
module.exports = { main };
