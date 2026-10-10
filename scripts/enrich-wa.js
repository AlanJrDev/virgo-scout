/* Backfill do WhatsApp real: re-analisa sites de leads sem whatsapp gravado.
   npm run enrich:wa [limite] — reprocessa quem ainda não tem zap (consulta whatsapp=is.null). */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { analyzeSite } = require('../src/enrich/site-analyzer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const rows = (await sbFetch(`leads?select=id,website&website=not.is.null&whatsapp=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:wa] ${rows.length} leads p/ backfill de whatsapp`);
  let ok = 0, fail = 0, found = 0;
  for (const r of rows) {
    const s = await analyzeSite(r.website).catch(() => ({}));
    if (s && s.whatsapp) {
      try {
        await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: { whatsapp: s.whatsapp, whatsapp_hint: true } });
        ok++; found++;
        console.log(`[enrich:wa] ok ${r.website.slice(0, 40)} -> ${s.whatsapp}`);
      } catch (e) { fail++; console.error(`[enrich:wa] erro ${r.id}: ${e.message}`); }
    } else {
      ok++;
    }
    await sleep(400);
  }
  console.log(`[enrich:wa] concluído: ${ok} ok (${found} com zap), ${fail} falhas`);
}

if (require.main === module) {
  main().catch((e) => { console.error('[enrich:wa]', e.message); process.exit(1); });
}
module.exports = { main };
