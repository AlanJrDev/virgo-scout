/* Backfill do WhatsApp com descoberta profunda (analyzer v2), fila de recuperação
   (cooldown 7d + cap 6 via 0011) e fallback DOM opt-in (Playwright).
   npm run enrich:wa [limite] [fallback] */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { analyzeSite, extractSignals } = require('../src/enrich/site-analyzer');
const { waWriteFields } = require('../src/utils/wa-audit');
const { renderSite } = require('../src/enrich/site-renderer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WARN_0011 = '[enrich:wa] colunas de retry ausentes — aplique supabase/migrations/0011 no SQL Editor';
const WARN_0010 = '[enrich:wa] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor';

async function main({ renderImpl = renderSite, fallbackLimit, sleep: pause = sleep } = {}) {
  const limit = parseInt(process.argv[2] || '50', 10);
  const fbLimit = fallbackLimit ?? parseInt(process.argv[3] || '0', 10); // fallback DOM é opt-in (decisão C)
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(); // cooldown 7d (decisão I F1)
  let rows;
  try {
    rows = (await sbFetch(`leads?select=id,website,phone,address,wa_attempts&website=not.is.null&whatsapp=is.null&wa_attempts=lt.6&or=(wa_last_try.is.null,wa_last_try.lte.${cutoff})&order=id&limit=${limit}`)) || [];
  } catch (e) {
    if (/wa_(attempts|last_try)/.test(e.message)) console.error(WARN_0011);
    throw e;
  }
  console.log(`[enrich:wa] ${rows.length} leads p/ backfill de whatsapp`);
  let analisados = 0, comZap = 0, descartados = 0, soHint = 0, paginas = 0, fail = 0;
  const filaHint = [], filaMorta = []; // fila de fallback: hint-ok primeiro, site morto depois (decisão D)
  for (const r of rows) {
    analisados++;
    const s = await analyzeSite(r.website).catch(() => null);
    const patch = { wa_attempts: (r.wa_attempts || 0) + 1, wa_last_try: new Date().toISOString() }; // PATCH incondicional (decisão J F1)
    if (!s) {
      console.error(`[enrich:wa] analyzer morreu em ${r.id}: seguindo`); // s===null: não entra em fila nenhuma (decisão D)
    } else if (s.ok) {
      paginas += s.pages_visited || 0;
      if (s.whatsapp) {
        const wa = waWriteFields({ whatsapp: s.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: s.wa_evidence_url || s.final_url || r.website });
        if (wa) {
          Object.assign(patch, wa);
          comZap++;
          console.log(`[enrich:wa] ok ${r.website.slice(0, 40)} -> ${s.whatsapp}`);
        } else {
          descartados++; // rejeitado pelo classificador fora da fila (decisão D)
        }
      } else if (s.whatsapp_hint) {
        patch.whatsapp_hint = true; // hint-only (decisão G F1)
        soHint++;
        filaHint.push(r);
      }
    } else {
      filaMorta.push(r); // s.ok === false: fetch estático falhou, Chrome pode conseguir (decisão D)
    }
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } });
    } catch (e) {
      if (/wa_(attempts|last_try)/.test(e.message)) { console.error(WARN_0011); throw e; }
      if (/wa_(source|status|evidence|checked_at)/.test(e.message)) { console.error(WARN_0010); throw e; }
      fail++;
      console.error(`[enrich:wa] erro ${r.id}: ${e.message}`);
    }
    await pause(400);
  }
  console.log(`[enrich:wa] concluído: ${analisados} analisados, ${comZap} com zap novo, ${descartados} descartados, ${soHint} só hint, ${paginas} páginas extras, ${fail} falhas`);
  // Fase 2: fallback DOM opt-in (decisões B/C/D/E) — PULO quando fbLimit=0
  const fbFila = filaHint.concat(filaMorta).slice(0, fbLimit); // hint-ok primeiro, morta depois, cap no arg
  if (fbFila.length) {
    console.log(`[enrich:wa] fallback DOM: ${fbFila.length} lead(s) p/ render com Chromium`);
    let fbZap = 0, fbNada = 0, fbFail = 0;
    for (const r of fbFila) {
      try {
        const rend = await renderImpl(r.website, { timeoutMs: 15000 });
        const dom = rend && rend.ok && rend.html ? extractSignals(rend.html) : null;
        if (dom && dom.whatsapp) {
          const wa = waWriteFields({ whatsapp: dom.whatsapp, phone: r.phone, address: r.address, hint: true, source: 'site', evidence: rend.finalUrl || r.website });
          if (wa) {
            await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: wa, headers: { Prefer: 'return=minimal' } }); // SEM tracking: attempts já somou na estática (decisão E)
            fbZap++;
            console.log(`[enrich:wa] fallback ok ${r.website.slice(0, 40)} -> ${dom.whatsapp}`);
          } else {
            fbNada++; // zap do DOM rejeitado no judge: nenhuma escrita, nem hint
          }
        } else if (dom && dom.whatsapp_hint) {
          await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: { whatsapp_hint: true }, headers: { Prefer: 'return=minimal' } });
          fbNada++;
        } else {
          fbNada++; // render morto ou DOM sem zap: tenta próximo da fila
        }
      } catch (e) {
        if (/wa_(attempts|last_try)/.test(e.message)) { console.error(WARN_0011); throw e; }
        if (/wa_(source|status|evidence|checked_at)/.test(e.message)) { console.error(WARN_0010); throw e; }
        fbFail++;
        console.error(`[enrich:wa] fallback erro ${r.id}: ${e.message}`);
      }
      await pause(400);
    }
    console.log(`[enrich:wa] fallback DOM concluído: ${fbFila.length} tentado(s), ${fbZap} com zap novo, ${fbNada} ainda sem, ${fbFail} falhas`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('[enrich:wa]', e.message); process.exit(1); });
}
module.exports = { main };
