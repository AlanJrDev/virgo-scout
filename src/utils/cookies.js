/* Cookies de sessão — compartilhados por serve-web local e funções da Vercel */
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function authCookie(token, { maxAge = 0 } = {}) {
  return `vs_auth=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ''}`;
}

function clearAuthCookie() {
  return 'vs_auth=; Path=/; HttpOnly; Max-Age=0';
}

module.exports = { parseCookies, authCookie, clearAuthCookie };
