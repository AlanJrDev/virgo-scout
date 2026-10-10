const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { CATEGORIES } = require('../src/utils/categories');
const { json } = require('../src/utils/http-json');
const QUERIES_BY_CAT = {
  advogados: require('../scripts/queries').QUERIES,
  arquitetura: require('../scripts/queries-arquitetura').QUERIES_ARQ,
  tapecaria: require('../scripts/queries-tapecaria').QUERIES_TAP,
  estofado: require('../scripts/queries-estofado').QUERIES_EST,
};

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
  const key = qs.get('category');
  const cfg = CATEGORIES[key] || CATEGORIES.advogados;
  const queries = QUERIES_BY_CAT[cfg.tag] || QUERIES_BY_CAT.advogados;
  json(res, 200, { queries, category: cfg.tag });
};
