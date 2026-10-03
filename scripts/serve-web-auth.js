/* Autenticação comum local + Vercel: tentativa de login e leitura de sessão */
const crypto = require('node:crypto');
const store = require('../src/utils/user-store');
const { createSession, getSession } = require('../src/utils/session-store');
const { SbError } = require('../src/utils/sb');

const DAY = 24 * 60 * 60 * 1000;

// valida credenciais, cria sessão (banco ou memória) e devolve token pronto p/ cookie
async function attemptLogin({ email, pass, keep = false, ip = '?' }) {
  if (!loginAllowed(ip)) return { status: 429, body: { error: 'locked' } };
  try {
    const user = await store.findUser(email);
    if (!user || !store.verifyPassword(user, pass)) {
      const locked = registerFail(ip);
      return { status: locked ? 429 : 401, body: { error: locked ? 'locked' : 'invalid' } };
    }
    clearFails(ip);
    const ttlMs = keep ? 7 * DAY : DAY;
    const token = await createSession({ email: user.email, role: user.role, ttlMs });
    return { status: 200, token, ttlMs, keep, body: { ok: true, user: user.email, role: user.role } };
  } catch (e) {
    if (e instanceof SbError || (e && e.code === 'store_unavailable')) {
      return { status: 503, body: { error: 'setup_required' } };
    }
    throw e;
  }
}

// sessão → usuário; ausência/expiração/falha de store → null (fail-closed, nunca lança)
async function sessionUser(token) {
  try { return await getSession(token); } catch { return null; }
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

module.exports = { attemptLogin, sessionUser, newSessionToken, loginAllowed, registerFail, clearFails };
