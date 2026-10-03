const { attemptLogin } = require('../scripts/serve-web-auth');
const { authCookie } = require('../src/utils/cookies');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const ip = req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?';
  const b = req.body || {};
  try {
    const r = await attemptLogin({ email: b.user, pass: b.pass, keep: !!b.keep, ip });
    if (r.token) res.setHeader('Set-Cookie', authCookie(r.token, { maxAge: r.keep ? Math.floor(r.ttlMs / 1000) : 0 }));
    json(res, r.status, r.body);
  } catch (e) {
    console.error('[api/login]', e);
    json(res, 500, { error: 'internal' });
  }
};
