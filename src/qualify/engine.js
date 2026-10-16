// Motor de qualificação — puro, sem I/O. Pesos em ./weights.
const W = require('./weights');
const { hasWa, waDigits } = require('../utils/wa');

const cap = (n, max) => Math.max(0, Math.min(max, n));
const year = () => new Date().getFullYear();

// porte por volume de avaliações (log): 10→~4, 100→~7, 1e6→10
function reviewsScore(reviews) {
  const n = Math.max(0, Number(reviews) || 0);
  return Math.min(W.capacidade.reviewsMax, Math.round(Math.log10(n + 1) * 3.5));
}

function siteIsBad(a) { return !!(a && a.ruim === true); }

function accessScore(l) {
  let s = 0;
  if (hasWa(l)) s += W.acesso.whatsappValidado;
  else if (String(waDigits(l.phone)).length >= 13) s += W.acesso.celular;
  if (l.email) s += W.acesso.email;
  if (l.instagram) s += W.acesso.instagram;
  return cap(s, W.acesso.max);
}

function icpOf(l, siteBad) {
  const out = [];
  if (!l.website || siteBad) out.push('site');
  const escala = (Number(l.reviews) || 0) >= W.sistema.minReviews;
  if (l.website && escala) out.push('sistema');
  return out;
}

function whyNow(l) {
  if (l.ads_active === true) return 'anunciando agora';
  if (l.since_year && year() - l.since_year <= 1) return 'recém-aberto';
  const d = Date.parse(l.ig_last_post);
  if (Number.isFinite(d) && Date.now() - d <= W.intencao.igRecenteDias * 86400000) return 'Instagram ativo recente';
  return null;
}

function qualify(lead) {
  const l = lead || {};
  if (l.closed) return { fit: 0, reach: 0, icp: [], reasons: ['fechado'], why_now: null };
  const siteBad = siteIsBad(l.site_audit);
  const reasons = [];

  // Oportunidade
  let op = 0;
  if (!l.website) { op += W.oportunidade.semSite; reasons.push('sem site'); }
  else if (siteBad) { op += W.oportunidade.siteRuim; reasons.push('site desatualizado'); }
  if (!l.website && l.instagram) { op += W.oportunidade.semSiteComIg; reasons.push('sem site, com Instagram'); }
  if (l.claimed === false) { op += W.oportunidade.naoReclamado; reasons.push('perfil não reclamado'); }
  op = cap(op, W.oportunidade.max);

  // Capacidade
  let cp = reviewsScore(l.reviews);
  if (l.ads_active === true) { cp += W.capacidade.adsAtivo; reasons.push('anúncio ativo'); }
  if (l.claimed === true) cp += W.capacidade.claimed;
  if (l.since_year && year() - l.since_year >= W.capacidade.desdeAnos) { cp += W.capacidade.estavel; reasons.push('negócio estabelecido'); }
  cp = cap(cp, W.capacidade.max);

  // Intenção
  let it = 0;
  if (l.ads_active === true) it += W.intencao.adsAtivo;
  const d = Date.parse(l.ig_last_post);
  if (Number.isFinite(d) && Date.now() - d <= W.intencao.igRecenteDias * 86400000) { it += W.intencao.igRecente; reasons.push('Instagram ativo'); }
  if (l.claimed === true) it += W.intencao.claimed;
  it = cap(it, W.intencao.max);

  // Acesso
  const reach = accessScore(l);
  if (hasWa(l)) reasons.push('WhatsApp validado');
  else if (reach >= W.acesso.celular) reasons.push('celular');

  const fit = cap(op + cp + it + reach, 100);
  const icp = fit > 0 ? icpOf(l, siteBad) : [];
  return { fit, reach, icp, reasons: [...new Set(reasons)], why_now: whyNow(l) };
}

module.exports = { qualify, accessScore, reviewsScore, icpOf, whyNow };
