const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetch, SbError } = require('../src/utils/sb');
const { buildPayload } = require('../src/utils/metrics');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  try {
    const rows = await sbFetch('leads?select=*');
    const payload = buildPayload(rows || [], { dataDir: '/tmp' });
    payload.source = 'supabase';
    json(res, 200, payload);
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    console.error('[api/leads]', e);
    json(res, 500, { error: 'internal' });
  }
};
