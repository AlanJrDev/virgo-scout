/* Funil da base leads — computação PURA (sem I/O). Scripts só trazem rows e
   imprimem/salvam; testes rodam em memória. "Zap" = hasWa (canônico de wa.js). */
const { hasWa, waDigits } = require('./wa');

const WA_KEYS = ['declared', 'suspect', 'invalid']; // null/lixo cai em 'outro'
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function funnelSummary(rows) {
  const rs = Array.isArray(rows) ? rows : [];
  const comSite = rs.filter((r) => r && r.website).length;
  const comPhone = rs.filter((r) => r && r.phone).length;
  const comZap = rs.filter(hasWa);
  const zapsUnicos = new Set(comZap.map((r) => waDigits(r.whatsapp))).size;
  const comHint = rs.filter((r) => r && r.whatsapp_hint && !hasWa(r)).length;
  const waStatus = { declared: 0, suspect: 0, invalid: 0, outro: 0 };
  const waSource = { maps: 0, site: 0, instagram: 0, desconhecido: 0 };
  for (const r of rs) {
    waStatus[r && WA_KEYS.includes(r.wa_status) ? r.wa_status : 'outro']++;
    waSource[r && ['maps', 'site', 'instagram'].includes(r.wa_source) ? r.wa_source : 'desconhecido']++;
  }
  const comEvidence = comZap.filter((r) => r.wa_evidence_url || r.wa_evidence).length; // coluna analítica OU DB
  const semSite = rs.filter((r) => r && !r.website && !r.closed); // ICP snapshot (decisão J)
  const isTierA = (r) => r.claimed === true && r.rating >= 4.0 && r.reviews >= 100;
  const tierA = semSite.filter(isTierA).length;
  const tierB = semSite.filter((r) => !isTierA(r) && (r.rating >= 3.5 || r.reviews >= 20)).length;
  return {
    total: rs.length, comSite, comPhone,
    comZap: comZap.length, zapsUnicos, comHint,
    comEvidence, evidencePct: pct(comEvidence, comZap.length),
    descobertaPct: pct(comZap.filter((r) => r && r.website).length, comSite), // wa declarado / leads COM site (decisão J)
    waStatus, waSource,
    semSites: { total: semSite.length, tierA, tierB },
  };
}

module.exports = { funnelSummary };
