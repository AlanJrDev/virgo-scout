const { listSignups } = require('../src/utils/signups');
const { SbError } = require('../src/utils/sb');
const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  if (sess.role !== 'founder') { json(res, 403, { error: 'forbidden' }); return; }
  try {
    json(res, 200, await listSignups());
  } catch (e) {
    if (e instanceof SbError || (e && e.code === 'store_unavailable')) { json(res, 503, { error: 'store_unavailable' }); return; }
    console.error('[api/signups]', e);
    json(res, 500, { error: 'internal' });
  }
};
