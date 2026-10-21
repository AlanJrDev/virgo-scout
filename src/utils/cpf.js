/* CPF — normalização, validação (dígitos verificadores, algoritmo da Receita) e máscara segura */
function normCpf(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function isValidCpf(v) {
  const c = normCpf(v);
  if (c.length !== 11 || new Set(c).size === 1) return false;
  const d = c.split('').map(Number);
  let s = 0;
  for (let i = 0; i < 9; i++) s += d[i] * (10 - i);
  let r = s % 11;
  if ((r < 2 ? 0 : 11 - r) !== d[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += d[i] * (11 - i);
  r = s % 11;
  return (r < 2 ? 0 : 11 - r) === d[10];
}

function maskCpf(v) {
  const c = normCpf(v);
  if (!c.length) return '';
  return '***.***.***-' + ('0' + c.slice(-2)).slice(-2);
}

module.exports = { normCpf, isValidCpf, maskCpf };
