const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetch, SbError } = require('../src/utils/sb');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  if (req.method === 'POST') { json(res, 503, { error: 'local-only', message: 'Capture na máquina local' }); return; }
  try {
    const rows = await sbFetch('captures?select=*&order=finished_at.desc&limit=1');
    const row = rows && rows[0];
    const staleMs = 30 * 60 * 1000;
    const fresh = row && row.started_at && Date.now() - Date.parse(row.started_at) < staleMs;
    if (row && row.status === 'running' && fresh) {
      json(res, 200, { status: 'running', started_at: row.started_at, total: row.queries, done: 0, current: null });
      return;
    }
    json(res, 200, { status: 'idle', last: row || null });
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    console.error('[api/capture]', e);
    json(res, 500, { error: 'internal' });
  }
};
