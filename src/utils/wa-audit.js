// Auditoria da qualidade do WhatsApp captado. Classificador puro (sem rede):
// responde "o número declarado é um WhatsApp BR plausível e coerente com o lead?".
// O probe online (wa.me) é aplicado por cima, no scripts/audit-wa.js.
const { waDigits } = require('./wa');

// DDDs válidos no Brasil (Anatel)
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

const DF_RE = /(\bDF\b|Bras[íi]lia|Taguatinga|Ceil[âa]ndia|Águas Claras|Aguas Claras|Samambaia|Guar[áa]\b|Gama|Sobradinho|Planaltina|Santa Maria|Riacho Fundo|N[úu]cleo Bandeirante|Lago Sul|Lago Norte|Asa Sul|Asa Norte|Park Way|Vicente Pires|Cruzeiro|Octogonal|Sudoeste|Noroeste)/i;

function isDfRegion(address) {
  return DF_RE.test(String(address || ''));
}

// número já normalizado (com 55) → parte local + DDD
function splitLocal(digits) {
  const w = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  return { local: w, ddd: w.slice(0, 2), len: w.length };
}

const SUSPECT_REASONS = ['unparseable', 'invalid_ddd', 'too_short', 'ddd_off_region'];

// { whatsapp, phone, address } → { status, digits, ddd, mobile, reasons[] }
// status: 'invalid' (sem link) | 'suspect' (link existe mas algo não fecha) | 'declared'
function classifyWaNumber({ whatsapp, phone, address } = {}) {
  const digits = waDigits(whatsapp);
  if (!digits) return { status: 'invalid', digits: null, ddd: null, mobile: false, reasons: ['unparseable'] };

  const { local, ddd, len } = splitLocal(digits);
  const reasons = [];
  if (!VALID_DDD.has(parseInt(ddd, 10))) reasons.push('invalid_ddd');
  if (len < 10) reasons.push('too_short');
  const mobile = len === 11 && local[2] === '9';

  const pdig = waDigits(phone);
  if (pdig) reasons.push(pdig === digits ? 'matches_phone' : 'differs_phone');

  if (isDfRegion(address) && ddd !== '61') reasons.push('ddd_off_region');

  const suspect = reasons.some((r) => SUSPECT_REASONS.includes(r));
  return { status: suspect ? 'suspect' : 'declared', digits, ddd, mobile, reasons };
}

module.exports = { classifyWaNumber, isDfRegion, splitLocal, VALID_DDD };
