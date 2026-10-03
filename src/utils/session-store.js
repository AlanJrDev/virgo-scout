/* Sessões: Supabase (sessions table, hash sha256) quando configurado; Map em memória caso contrário */
const crypto = require('node:crypto');
const { sbEnabled, sbFetch } = require('./sb');

const mem = new Map(); // token -> { exp, email, role }

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createSession({ email, role, ttlMs, token = crypto.randomBytes(32).toString('hex') }) {
  const exp = Date.now() + ttlMs;
  if (sbEnabled()) {
    await sbFetch('sessions', {
      method: 'POST',
      body: [{ token_hash: hashToken(token), email, role, exp: new Date(exp).toISOString() }],
    });
    // limpeza oportunista das expiradas
    await sbFetch(`sessions?exp=lt.${new Date().toISOString()}`, { method: 'DELETE' });
  } else {
    mem.set(token, { exp, email, role });
  }
  return token;
}

async function getSession(token) {
  if (!token) return null;
  if (sbEnabled()) {
    const rows = await sbFetch(`sessions?token_hash=eq.${hashToken(token)}&select=*`);
    const s = rows && rows[0];
    if (!s) return null;
    if (Date.now() > new Date(s.exp).getTime()) {
      await destroySession(token);
      return null;
    }
    return { email: s.email, role: s.role };
  }
  const s = mem.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { mem.delete(token); return null; }
  return { email: s.email, role: s.role };
}

async function destroySession(token) {
  if (!token) return;
  if (sbEnabled()) await sbFetch(`sessions?token_hash=eq.${hashToken(token)}`, { method: 'DELETE' });
  else mem.delete(token);
}

module.exports = { createSession, getSession, destroySession };
