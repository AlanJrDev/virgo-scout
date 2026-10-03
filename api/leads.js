const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetchAll, SbError } = require('../src/utils/sb');
const { buildPayload } = require('../src/utils/metrics');
const { json } = require('../src/utils/http-json');

function categoryOf(req) {
  const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
  return qs.get('category') === 'arquitetura' ? 'arquitetura' : 'advogados';
}

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  const category = categoryOf(req);
  try {
    const rows = await sbFetchAll(`leads?select=*&source=${category === 'arquitetura' ? 'eq.arquitetura' : 'neq.arquitetura'}&order=id`);
    const payload = buildPayload(rows || [], { dataDir: '/tmp', category });
    payload.source = 'supabase';
    json(res, 200, payload);
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    console.error('[api/leads]', e);
    json(res, 500, { error: 'internal' });
  }
};
