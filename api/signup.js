const { createSignup } = require('../src/utils/signups');
const { SbError } = require('../src/utils/sb');
const { json } = require('../src/utils/http-json');

const MAX_HITS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map(); // ip -> { count, resetAt } (em memória, por instância)
function allowed(ip) {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k); // poda expiradas (padrão serve-web-auth)
  const a = hits.get(ip);
  if (!a || now > a.resetAt) { hits.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return true; }
  if (a.count >= MAX_HITS) return false;
  a.count++;
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const ip = req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?';
  if (!allowed(ip)) { json(res, 429, { error: 'locked' }); return; }
  const b = req.body || {};
  if (JSON.stringify(b).length > 16 * 1024) { json(res, 400, { error: 'too_large' }); return; }
  try {
    await createSignup(b);
    json(res, 201, { ok: true });
  } catch (e) {
    if (e instanceof SbError || (e && e.code === 'store_unavailable')) { json(res, 503, { error: 'store_unavailable' }); return; }
    // anti-enumeração: duplicidade responde 200/201 genérico, sem criar nada
    if (e && e.code === 'duplicate') { json(res, 201, { ok: true }); return; }
    const st = /^(invalid_|weak_pass|too_large)/.test(e.code) ? 400 : null;
    if (st) { json(res, st, { error: e.code }); return; }
    console.error('[api/signup]', e);
    json(res, 500, { error: 'internal' });
  }
};
