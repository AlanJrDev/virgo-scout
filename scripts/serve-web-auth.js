const crypto = require('node:crypto');

// credenciais locais: LOGIN_USER / LOGIN_PASS no .env (padrão admin / virgo123)
function checkCredentials(user, pass) {
  const u = process.env.LOGIN_USER || 'admin';
  const p = process.env.LOGIN_PASS || 'virgo123';
  const a = Buffer.from(String(user || ''));
  const b = Buffer.from(String(u));
  const c = Buffer.from(String(pass || ''));
  const d = Buffer.from(String(p));
  const okUser = a.length === b.length && crypto.timingSafeEqual(a, b);
  const okPass = c.length === d.length && crypto.timingSafeEqual(c, d);
  return okUser && okPass;
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// controle de tentativas: 5 falhas em 60s → 30s de bloqueio por IP
const attempts = new Map();
function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a) return true;
  if (Date.now() > a.resetAt) { attempts.delete(ip); return true; }
  return a.fails < 5;
}
function registerFail(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { fails: 0, resetAt: now + 60000 };
  if (now > a.resetAt) { a.fails = 0; a.resetAt = now + 60000; }
  a.fails++;
  attempts.set(ip, a);
  return a.fails >= 5;
}
function clearFails(ip) { attempts.delete(ip); }

module.exports = { checkCredentials, newSessionToken, loginAllowed, registerFail, clearFails };
