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
    // code = prefixo estável ('sb_404'): o corpo do erro, quando anexado ao
    // message via ' :: ', NÃO vira código (callers compilam pelo prefixo)
    this.code = status >= 500 ? 'supabase_down' : String(message).split(' :: ')[0];
  }
}

/* Erro HTTP < 500: anexa o CORPO da resposta ao message (1ª vez, truncado a
   300 chars) para decode do motivo real (PGRST204/42703/23514 check etc.);
   prefixo 'sb_<status>' é preservado exato no início. try/JSON → extrai o
   message/details em vez do corpo cru quando possível. */
function errBodyMsg(status, text) {
  const body = String(text || '').trim();
  if (!body) return `sb_${status}`;
  let detail = body;
  try {
    const j = JSON.parse(body);
    if (j && typeof j === 'object') {
      detail = [j.message, j.error, j.details, j.hint].filter(Boolean).join(' :: ') || body;
    }
  } catch (e) { /* corpo não-JSON: usa cru */ }
  return `sb_${status} :: ${detail.slice(0, 300)}`;
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
  if (!res.ok) throw new SbError(res.status >= 500 ? 'supabase_down' : errBodyMsg(res.status, text), res.status >= 500 ? 503 : res.status);
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new SbError('sb_bad_json', 502); }
}

/* GET paginado — o PostgREST do Supabase trava em 1000 linhas por requisição;
   o chamador deve passar `order=` estável p/ offset não pular registros. */
async function sbFetchAll(path) {
  const sep = path.includes('?') ? '&' : '?';
  const size = 1000;
  let all = [];
  let offset = 0;
  for (;;) {
    const batch = (await sbFetch(`${path}${sep}limit=${size}&offset=${offset}`)) || [];
    all = all.concat(batch);
    if (batch.length < size) break;
    offset += size;
  }
  return all;
}

module.exports = { sbEnabled, sbFetch, sbFetchAll, SbError };
