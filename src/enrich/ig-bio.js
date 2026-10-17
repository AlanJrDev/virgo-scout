/* WhatsApp descoberto na bio do Instagram: wa.me/whatsapp links + telefone BR no texto
   (só aceita número com palavra-chave próxima — zap/wpp/contato/orçamento — p/ evitar falso positivo) */
const ZAP_HINT = /(?:\bzap\b|\bwpp\b|\bwhats(?:app)?\b|\bcontato\b|\bor(?:c|ç)ament\w*\b|\boloja\b|\bcompras?\b)/i;

function digitsBR(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.startsWith('0') && d.length <= 12) d = d.slice(1);
  // celular BR válido: DDD (2) + 9 + 8 = 11 dígitos; fixo (12) sem 9 no meio não é WhatsApp
  if (d.length === 11) return /^[1-9][0-9]9\d{8}$/.test(d) ? d : null;
  if (d.length === 10) return null;
  return null;
}

function extractDigits(u) {
  const tries = [u, decodeURIComponent(u).replace(/%2F/gi, '/')];
  for (const t of tries) {
    const m = t.match(/wa\.me\/(\d{8,15})/) || t.match(/whatsapp\.com\/send\?[^"'\s]*phone=(\d{8,15})/i);
    if (m) {
      const d = digitsBR(m[1]);
      if (d) return d;
    }
  }
  return null;
}

function waFromBio({ html = '', links = [], hrefsText = '' } = {}) {
  for (const u of String(hrefsText || '').split(' ')) {
    const d = extractDigits(u);
    if (d) return { digits: d, via: 'link' };
  }
  for (const raw of Array.isArray(links) ? links : []) {
    const d = extractDigits(String(raw || ''));
    if (d) return { digits: d, via: 'link' };
  }
  const text = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!ZAP_HINT.test(text)) return null;
  const re = /(?:\+|00)?(?:55[\s.-]?)?\(?(\d{2})\)?[\s.-]?9?(\d{4})[\s.-]?(\d{4})/g;
  let m;
  while ((m = re.exec(text))) {
    const at = m.index;
    const before = text.slice(Math.max(0, at - 40), at).toLowerCase();
    const sc = text.slice(at, at + 60).toLowerCase();
    const near = ZAP_HINT.test(before) || ZAP_HINT.test(sc);
    if (!near) continue;
    const d = digitsBR(m[0].replace(/[\s().-]/g, ''));
    if (d) return { digits: d, via: 'bio' };
  }
  return null;
}

module.exports = { digitsBR, waFromBio, ZAP_HINT };
