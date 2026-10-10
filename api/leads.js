const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetchAll, SbError } = require('../src/utils/sb');
const { buildPayload } = require('../src/utils/metrics');
const { matchesType } = require('../src/utils/categories');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
  const type = qs.get('type') || 'all';
  try {
    const rows = await sbFetchAll('leads?select=*&order=id');
    const filtered = (rows || []).filter((r) => matchesType(r, type));
    const payload = buildPayload(filtered, { dataDir: '/tmp', category: 'all' });
    payload.source = 'supabase';
    json(res, 200, payload);
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    console.error('[api/leads]', e);
    json(res, 500, { error: 'internal' });
  }
};
