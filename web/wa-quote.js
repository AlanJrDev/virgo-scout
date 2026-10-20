/* Virgo Tech — orçamento e saudação curta do wa.me (mesmo contrato de src/utils/wa.js).
   Carregada antes de table.js; também require-ável no node para o teste de paridade. */
(function () {
  'use strict';

  var WA_URL_BUDGET = 130;

  function waFits(t) {
    return encodeURIComponent(String(t == null ? '' : t)).length <= WA_URL_BUDGET;
  }

  function waShortMessage(socio) {
    var nome = String(socio == null ? '' : socio).trim();
    var tiers = nome
      ? ['💸 Perdendo clientes para a concorrência! Sou ' + nome + ', da Virgo Tech. Posso te mostrar?',
        '💸 Perdendo clientes para a concorrência! Sou da Virgo Tech. Posso te mostrar?']
      : ['💸 Perdendo clientes para a concorrência! Sou da Virgo Tech. Posso te mostrar?'];
    tiers.push('💸 Perdendo clientes p/ concorrência! Posso te mostrar?'); // hard floor
    var i;
    for (i = 0; i < tiers.length; i++) {
      if (waFits(tiers[i])) return tiers[i];
    }
    return tiers[tiers.length - 1];
  }

  var api = { WA_URL_BUDGET: WA_URL_BUDGET, waFits: waFits, waShortMessage: waShortMessage };

  if (typeof window !== 'undefined') window.WA_QUOTE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
