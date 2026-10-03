const { parseCookies, clearAuthCookie } = require('../src/utils/cookies');
const { destroySession } = require('../src/utils/session-store');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const token = parseCookies(req.headers.cookie).vs_auth;
  if (token) { try { await destroySession(token); } catch (e) { console.error('[api/logout]', e); } }
  res.setHeader('Set-Cookie', clearAuthCookie());
  json(res, 200, { ok: true });
};
