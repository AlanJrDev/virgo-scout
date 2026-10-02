const crypto = require('node:crypto');
const store = require('../src/utils/user-store');

// autentica no user-store local; 503 = sem users.json (fail-closed), 401 = inválido
function authenticate(email, pass) {
  if (!store.readStore()) return { status: 503 };
  const user = store.findUser(email);
  if (!user || !store.verifyPassword(user, pass)) return { status: 401 };
  return { status: 200, user: { email: user.email, role: user.role } };
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

module.exports = { authenticate, newSessionToken, loginAllowed, registerFail, clearFails };
