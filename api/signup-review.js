const { reviewSignup } = require('../src/utils/signups');
const { SbError } = require('../src/utils/sb');
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  if (sess.role !== 'founder') { json(res, 403, { error: 'forbidden' }); return; }
  const b = req.body || {};
  if (JSON.stringify(b).length > 4 * 1024) { json(res, 400, { error: 'too_large' }); return; }
  try {
    const r = await reviewSignup({ id: b.id, action: b.action, reviewer: sess.email });
    json(res, 200, { ok: true, status: r.status });
  } catch (e) {
    if (e instanceof SbError || (e && e.code === 'store_unavailable')) { json(res, 503, { error: 'store_unavailable' }); return; }
    const st = e && ({ invalid_action: 400, not_found: 404, already_reviewed: 409, user_exists: 409 }[e.code] || null);
    if (st) { json(res, st, { error: e.code }); return; }
    console.error('[api/signup-review]', e);
    json(res, 500, { error: 'internal' });
  }
};
