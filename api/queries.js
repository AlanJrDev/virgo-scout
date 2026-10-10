const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { CATEGORIES } = require('../src/utils/categories');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return; }
  const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
  const cfg = CATEGORIES[qs.get('category')] || CATEGORIES.advogados;
  const { [cfg.queriesExport]: queries } = require(`../scripts/${cfg.queriesModule.replace('./', '')}`);
  json(res, 200, { queries, category: cfg.tag });
};
