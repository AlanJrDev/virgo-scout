const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { QUERIES } = require('../scripts/queries');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }); return; }
  json(res, 200, { queries: QUERIES });
};
