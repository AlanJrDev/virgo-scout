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

// null quando não há número utilizável
function waLink(phone, message) {
  const d = waDigits(phone);
  if (!d) return null;
  const text = message ? '?text=' + encodeURIComponent(message) : '';
  return `https://wa.me/${d}${text}`;
}

// Fonte de verdade de "tem zap contatável": só quando o link é montável.
// Um whatsapp cru malformado (ex.: lixo no regex do site) NÃO conta.
function hasWa(lead) {
  return !!waLink(lead && lead.whatsapp);
}

function segmentOf(lead) {
  const l = typeof lead === 'string' ? { name: lead } : lead || {};
  if (['Arquitetura', 'Urbanismo', 'Topografia', 'Outros'].includes(l.area)) return 'arquitetura e topografia';
  const txt = `${l.area || ''} ${l.category || ''} ${l.source || ''}`.toLowerCase();
  if (/topograf|agrimens/.test(txt)) return 'topografia';
  if (/arquit/.test(txt)) return 'arquitetura e topografia';
  if (/tapec|tapet|cortina/.test(txt)) return 'tapeçaria';
  if (/estofad|sofa|colch/.test(txt)) return 'estofados';
  return 'advocacia';
}

// Mensagem de primeira abordagem — personalizada, curta e focada no gancho de perda de clientes/dinheiro
function waMessage(lead) {
  const l = typeof lead === 'string' ? { name: lead } : lead || {};
  const quem = String(l.name || '').trim() || 'seu escritório';
  const segmento = segmentOf(l);
  const nota = typeof l.rating === 'number' && isFinite(l.rating) ? String(l.rating).replace('.', ',') : '';
  
  const intro = nota
    ? `Olá! Sou Alan, da Virgo Tech. Vi ${quem} no Google Maps — nota ${nota}★, parabéns!`
    : `Olá! Sou Alan, da Virgo Tech. Encontrei ${quem} no Google Maps.`;

  if (!l.website) {
    return `${intro} Notei que vocês ainda não têm site próprio — hoje estão perdendo clientes e contratos todos os dias para outros de ${segmento} no DF. Posso te mandar 2 referências rápidas de sites que trazem resultados?`;
  } else {
    return `${intro} Analisei a presença de vocês em ${segmento} no DF e notei pontos onde estão deixando dinheiro na mesa para a concorrência. Posso te mandar 2 ideias rápidas para dobrar seus contatos?`;
  }
}

module.exports = { waDigits, waLink, waMessage, hasWa, segmentOf };
