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

// Mensagem de primeira abordagem — personalizada com o que a base já sabe
// (nota, área e a ausência de site, que é a oportunidade do produto).
// Aceita string (compat) ou o objeto do lead.
function waMessage(lead) {
  const l = typeof lead === 'string' ? { name: lead } : lead || {};
  const quem = String(l.name || '').trim() || 'seu escritório';
  const area = String(l.area || '');
  const arq = ['Arquitetura', 'Urbanismo', 'Topografia', 'Outros'].includes(area);
  const segmento = arq ? 'arquitetura e topografia' : 'advocacia';
  const nota = typeof l.rating === 'number' && isFinite(l.rating) ? String(l.rating).replace('.', ',') : '';
  const parts = ['Olá! Sou Alan, da Virgo Tech.'];
  if (nota) parts.push(`Vi ${quem} no Google Maps — nota ${nota}★, parabéns!`);
  else parts.push(`Encontrei ${quem} no Google Maps.`);
  if (!l.website) {
    parts.push(`Notei que vocês ainda não têm site próprio — isso costuma custar clientes. Posso te mandar 2 exemplos rápidos de sites para ${segmento}?`);
  } else {
    parts.push(`Trabalho com presença digital para ${segmento} no DF. Posso te mandar 2 exemplos rápidos?`);
  }
  return parts.join(' ');
}

module.exports = { waDigits, waLink, waMessage };
