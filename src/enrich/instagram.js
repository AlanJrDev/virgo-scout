// Instagram público — melhor esforço. Muro de login => blocked (unknown).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

// handles reservados do IG (páginas internas, não perfis de negócio)
const RESERVED = /^(p|reel|reels|explore|stories|accounts|tv|directory)$/i;

function handleFrom(value) {
  let v = String(value || '').trim();
  if (!v) return null;
  v = v.replace(/^@/, '');
  const m = v.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (m) return RESERVED.test(m[1]) ? null : m[1];
  return RESERVED.test(v) ? null : (/^[A-Za-z0-9_.]{2,40}$/.test(v) ? v : null);
}

function num(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parseIgProfile(html) {
  const t = String(html || '');
  const m = t.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || t.match(/<meta[^>]+content=["']([^"']*(?:Followers|seguidores)[^"']*)["'][^>]+property=["']og:description["']/i);
  const desc = m ? m[1] : '';
  const f = desc.match(/([\d.,]+)\s*(?:Followers|seguidores)/i);
  const p = desc.match(/([\d.,]+)\s*(?:Posts|publica)/i);
  const tm = t.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  const blocked = !m;
  return { blocked, followers: f ? num(f[1]) : null, posts: p ? num(p[1]) : null, last_post: tm ? tm[1].slice(0, 10) : null };
}

async function fetchIg(handle, { fetchImpl, timeoutMs = 8000 } = {}) {
  const f = fetchImpl || fetch;
  const h = handleFrom(handle);
  if (!h) return null;
  try {
    const res = await f('https://www.instagram.com/' + h + '/', { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) return null;
    return parseIgProfile(await res.text());
  } catch { return null; }
}

module.exports = { parseIgProfile, fetchIg, handleFrom };
