// Geração de link WhatsApp. O botão de zap usa apenas o número DECLARADO no site
// do lead (coluna whatsapp); o phone do Maps vira fallback só como link na coluna
// Telefone (wa.me p/ celular, tel: p/ fixo).

function waDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return '';
  // remove 00 internacional
  if (d.startsWith('00')) d = d.slice(2);
  // remove 0 de longa local (061...)
  if (d.startsWith('0') && d.length <= 12) d = d.slice(1);
  // já tem país: 55 + DDD + (9)?numero. DDD 55 (RS) também começa com 5555 — não destruir.
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    if (/^0?(800|300|900)/.test(d.slice(2))) return ''; // 0800/0300/0900 não têm WhatsApp
    return d;
  }
  // país duplicado (55 55 + DDD...): remove um 55
  if (d.startsWith('5555')) d = d.slice(2);
  // adiciona BR quando faltar
  if (!d.startsWith('55') && d.length <= 11) d = '55' + d;
  if (d.length < 12) return '';
  if (/^0?(800|300|900)/.test(d.slice(2))) return '';
  return d;
}

// Orçamento do ?text= do wa.me (URL truncada em ~140 chars encoded)
const WA_URL_BUDGET = 130;

function waFits(t) {
  return encodeURIComponent(String(t == null ? '' : t)).length <= WA_URL_BUDGET;
}

// Saudação curta em tiers: o primeiro que couvir no orçamento vence.
function waShortMessage(socio) {
  const nome = String(socio == null ? '' : socio).trim();
  const tiers = nome
    ? ['💸 Perdendo clientes p/ concorrência! Sou ' + nome + ', da Virgo Tech. Posso te mostrar?',
      '💸 Perdendo clientes p/ concorrência! Sou da Virgo Tech. Posso te mostrar?']
    : ['💸 Perdendo clientes p/ concorrência! Sou da Virgo Tech. Posso te mostrar?'];
  tiers.push('💸 Perdendo clientes p/ concorrência! Posso te mostrar?'); // hard floor
  for (let i = 0; i < tiers.length; i++) {
    if (waFits(tiers[i])) return tiers[i];
  }
  return tiers[tiers.length - 1];
}

// null quando não há número utilizável
function waLink(phone, message) {
  const d = waDigits(phone);
  if (!d) return null;
  const texto = message && waFits(message) ? String(message) : waShortMessage('Alan');
  const text = '?text=' + encodeURIComponent(texto);
  return `https://wa.me/${d}${text}`;
}

// Fonte de verdade de "tem zap contatável": só quando o link é montável.
// Um whatsapp cru malformado (ex.: lixo no regex do site) NÃO conta.
function hasWa(lead) {
  return !!waLink(lead && lead.whatsapp);
}

// Mensagem de primeira abordagem — gancho de perda de clientes + ideia da Virgo Tech
function waMessage(lead, socio) {
  const nome = String(socio || '').trim() || 'Alan';
  return '💸 Sua empresa pode estar perdendo clientes e dinheiro todos os dias para a concorrência!\n\nOlá, tudo bem? Sou ' + nome + ', da Virgo Tech, e tenho uma ideia para ajudar vocês a atrair mais clientes. Posso te mostrar?';
}

module.exports = { waDigits, waLink, waMessage, hasWa, waFits, waShortMessage, WA_URL_BUDGET };
