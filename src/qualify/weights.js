// Pesos do motor de qualificação. Ajustar APENAS aqui (não no engine).
// Bump `version` a cada recalibração para rastrear qual rodada gerou um fit.
module.exports = {
  version: 1,
  oportunidade: { semSite: 15, siteRuim: 12, semSiteComIg: 10, naoReclamado: 3, max: 30 },
  capacidade: { reviewsMax: 10, adsAtivo: 15, claimed: 5, desdeAnos: 2, estavel: 5, max: 30 },
  intencao: { adsAtivo: 15, igRecente: 10, igRecenteDias: 45, claimed: 5, max: 25 },
  acesso: { whatsappValidado: 10, celular: 5, email: 3, instagram: 3, max: 15 },
  sistema: { minReviews: 50 },
};
