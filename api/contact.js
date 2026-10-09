const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { markContacted } = require('../src/utils/contact');
const { SbError } = require('../src/utils/sb');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  try {
    await markContacted((req.body || {}).id);
    json(res, 200, { ok: true });
  } catch (e) {
    if (e instanceof SbError) { json(res, e.status >= 500 ? 503 : e.status, { error: e.status >= 500 ? 'supabase_down' : e.code }); return; }
    if (e.code === 'invalid_id') { json(res, 400, { error: 'invalid_id' }); return; }
    console.error('[api/contact]', e);
    json(res, 500, { error: 'internal' });
  }
};
