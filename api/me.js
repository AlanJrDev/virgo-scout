const { sessionUser } = require('../scripts/serve-web-auth');
const { parseCookies } = require('../src/utils/cookies');
const { json } = require('../src/utils/http-json');

module.exports = async (req, res) => {
  const sess = await sessionUser(parseCookies(req.headers.cookie).vs_auth);
  if (!sess) { json(res, 401, { error: 'unauthorized' }); return; }
  json(res, 200, { user: sess.email, role: sess.role });
};
