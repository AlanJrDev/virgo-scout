/* Backfill do WhatsApp com descoberta profunda (analyzer v2) e fila de recuperação
   (cooldown 7d + cap 6 tentativas via 0011). npm run enrich:wa [limite]. */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { analyzeSite } = require('../src/enrich/site-analyzer');
const { waWriteFields } = require('../src/utils/wa-audit');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WARN_0011 = '[enrich:wa] colunas de retry ausentes — aplique supabase/migrations/0011 no SQL Editor';
const WARN_0010 = '[enrich:wa] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor';

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(); // cooldown 7d (decisão I)
  let rows;
  try {
    rows = (await sbFetch(`leads?select=id,website,phone,address,wa_attempts&website=not.is.null&whatsapp=is.null&wa_attempts=lt.6&or=(wa_last_try.is.null,wa_last_try.lte.${cutoff})&order=id&limit=${limit}`)) || [];
  } catch (e) {
    if (/wa_(attempts|last_try)/.test(e.message)) console.error(WARN_0011);
    throw e;
  }
  console.log(`[enrich:wa] ${rows.length} leads p/ backfill de whatsapp`);
  let analisados = 0, comZap = 0, descartados = 0, soHint = 0, paginas = 0, fail = 0;
  for (const r of rows) {
    analisados++;
    const s = await analyzeSite(r.website).catch(() => null);
    const patch = { wa_attempts: (r.wa_attempts || 0) + 1, wa_last_try: new Date().toISOString() }; // PATCH incondicional de tracking (decisão J)
    if (s && s.ok) {
      paginas += s.pages_visited || 0;
      if (s.whatsapp) {
        const wa = waWriteFields({ whatsapp: s.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: s.wa_evidence_url || s.final_url || r.website });
        if (wa) {
          Object.assign(patch, wa);
          comZap++;
          console.log(`[enrich:wa] ok ${r.website.slice(0, 40)} -> ${s.whatsapp}`);
        } else {
          descartados++; // declarado, mas rejeitado pelo classificador → nem hint (decisão G)
        }
      } else if (s.whatsapp_hint) {
        patch.whatsapp_hint = true; // hint-only (decisão G)
        soHint++;
      }
    }
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } });
    } catch (e) {
      if (/wa_(attempts|last_try)/.test(e.message)) { console.error(WARN_0011); throw e; }
      if (/wa_(source|status|evidence|checked_at)/.test(e.message)) { console.error(WARN_0010); throw e; }
      fail++;
      console.error(`[enrich:wa] erro ${r.id}: ${e.message}`);
    }
    await sleep(400);
  }
  console.log(`[enrich:wa] concluído: ${analisados} analisados, ${comZap} com zap novo, ${descartados} descartados, ${soHint} só hint, ${paginas} páginas extras, ${fail} falhas`);
}

if (require.main === module) {
  main().catch((e) => { console.error('[enrich:wa]', e.message); process.exit(1); });
}
module.exports = { main };
