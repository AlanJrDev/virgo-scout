// Geração de link WhatsApp (wa.me) a partir do telefone do lead.
// Regra do produto: usar o número disponível na base mesmo quando não foi
// marcado como WhatsApp — a ausência de um número indicado direto não é motivo
// para descartar o contato.

function waDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return '';
  // remove 00 internacional
  if (d.startsWith('00')) d = d.slice(2);
  // remove 0 de longa local (061...)
  if (d.startsWith('0') && d.length <= 12) d = d.slice(1);
  // adiciona BR quando faltar
  if (!d.startsWith('55') && d.length <= 11) d = '55' + d;
  // evita 55 duplo (5555...)
  if (d.startsWith('5555')) d = d.slice(2);
  if (d.length < 12) return '';
  return d;
}

// null quando não há número utilizável
function waLink(phone, message) {
  const d = waDigits(phone);
  if (!d) return null;
  const text = message ? '?text=' + encodeURIComponent(message) : '';
  return `https://wa.me/${d}${text}`;
}

function waMessage(leadName) {
  const name = String(leadName || '').trim();
  return name
    ? `Olá! Encontrei ${name} no Google Maps e gostaria de conversar.`
    : 'Olá! Encontrei seu escritório no Google Maps e gostaria de conversar.';
}

module.exports = { waDigits, waLink, waMessage };
