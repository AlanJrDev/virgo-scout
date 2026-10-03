const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { sbFetchAll, SbError } = require('../src/utils/sb');
const { buildPayload } = require('../src/utils/metrics');
const { askGroq, formatContext } = require('../scripts/groq');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  const b = req.body || {};
  const q = String(b.q || '').slice(0, 1000);
  const history = Array.isArray(b.history) ? b.history.slice(-6) : [];
  const category = b.category === 'arquitetura' ? 'arquitetura' : 'advogados';
  if (!q) { json(res, 400, { error: 'empty_q' }); return; }
  try {
    const rows = await sbFetchAll(`leads?select=*&source=${category === 'arquitetura' ? 'eq.arquitetura' : 'neq.arquitetura'}&order=id`);
    const payload = buildPayload(rows || [], { dataDir: '/tmp', category });
    const r = await askGroq({ question: q, context: formatContext(payload), history });
    json(res, 200, { answer: r.answer, source: 'groq' });
  } catch (e) {
    if (e instanceof SbError) { json(res, 503, { error: 'supabase_down' }); return; }
    json(res, 503, { error: e.code || 'groq_down' });
  }
};
