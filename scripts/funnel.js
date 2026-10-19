/* Funil da base leads — leitura PURA (sem PATCH): métricas impressas e salvas em
   data/funnel-<data>.json. Degrade de select pega quando 0010/0011 pendentes.
   npm run funnel */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sbFetchAll } = require('../src/utils/sb');
const { funnelSummary } = require('../src/utils/funnel');

// select completo: tudo que funnelSummary lê + telemetria das Fases 0/1
const COLS = 'id,phone,whatsapp,website,email,instagram,claimed,rating,reviews,types,captured_at,whatsapp_hint,wa_source,wa_status,wa_evidence,wa_attempts';

async function fetchBase() {
  try {
    return (await sbFetchAll(`leads?select=${COLS}&order=id`)) || [];
  } catch (e) {
    if (!/wa_(source|status|evidence|attempts)|whatsapp_hint/.test(e.message)) throw e;
    console.warn('[funnel] colunas de telemetria ausentes — refetch sem elas (aplique 0010/0011 no SQL Editor)');
    return (await sbFetchAll('leads?select=id,phone,whatsapp,website,email,instagram,claimed,rating,reviews,types,captured_at&order=id')) || [];
  }
}

async function main() {
  const rows = await fetchBase();
  const s = funnelSummary(rows);
  console.log(`[funnel] total=${s.total} comSite=${s.comSite} comPhone=${s.comPhone}`);
  console.log(`[funnel] zap: ${s.comZap} leads (${s.zapsUnicos} únicos), hint=${s.comHint}, descoberta=${s.descobertaPct}% de ${s.comSite} com site`);
  console.log(`[funnel] wa_status: declared=${s.waStatus.declared} suspect=${s.waStatus.suspect} invalid=${s.waStatus.invalid} outro=${s.waStatus.outro}`);
  console.log(`[funnel] wa_source: maps=${s.waSource.maps} site=${s.waSource.site} instagram=${s.waSource.instagram} desconhecido=${s.waSource.desconhecido}`);
  console.log(`[funnel] evidência preenchida: ${s.comEvidence}/${s.comZap} (${s.evidencePct}%)`);
  console.log(`[funnel] sem site: ${s.semSites.total} (tierA=${s.semSites.tierA}, tierB=${s.semSites.tierB})`);
  const file = path.join('data', `funnel-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  console.log(`[funnel] salvo em ${file}`);
}

if (require.main === module) main().catch((e) => { console.error('[funnel]', e.message); process.exit(1); });
module.exports = { main };
