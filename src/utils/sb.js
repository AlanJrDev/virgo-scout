/* Cliente PostgREST mínimo do Supabase — só servidor, chave secret (sb_secret_).
   sbEnabled/sbFetch lêem process.env a cada chamada (testes setam depois do require). */
function sbEnabled() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

class SbError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SbError';
    this.status = status;
    this.code = status >= 500 ? 'supabase_down' : message;
  }
}

async function sbFetch(path, { method = 'GET', body, headers = {} } = {}) {
  if (!sbEnabled()) throw new SbError('supabase_not_configured', 503);
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  let res;
  try {
    res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(body !== undefined ? { Prefer: 'return=representation' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SbError('supabase_down', 503);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new SbError(res.status >= 500 ? 'supabase_down' : `sb_${res.status}`, res.status >= 500 ? 503 : res.status);
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new SbError('sb_bad_json', 502); }
}

module.exports = { sbEnabled, sbFetch, SbError };
