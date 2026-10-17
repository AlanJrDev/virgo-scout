/* Dedupe de leads do Supabase: mesma empresa capturada em runs/lugares distintos
   ganha 1 row canônica (mais preenchida) — campos nulos no canônico são completados
   pelos duplicados antes de deletá-los. id/place_id contêm '0x…:0x…' e hash sha1:
   a chave é nome+endereço normalizados (o mesmo critério do sync). */
const { sbFetch } = require('./sb');

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

const MERGEABLE = ['phone', 'whatsapp', 'website', 'instagram', 'facebook', 'email', 'rating', 'reviews',
  'address', 'place_id', 'category', 'claimed', 'closed', 'since_year', 'source', 'lat', 'lng', 'captured_at'];

function fillCount(r) {
  let v = 0;
  for (const f of MERGEABLE) if (r[f] != null && r[f] !== '') v++;
  return (r.status && r.status !== 'novo' ? 10 : 0) + v;
}

/* puro: devolve {groups:[{key, canonical, deletes:[ids], patch}]} sem tocar em nada */
function dedupePlan(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const k = norm(r.name) + '|' + norm(String(r.address || '').split('-')[0]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => fillCount(b) - fillCount(a));
    const canonical = sorted[0];
    const patch = {};
    for (const f of MERGEABLE) {
      if (canonical[f] == null || canonical[f] === '') {
        const alt = sorted.find((r) => r[f] != null && r[f] !== '');
        if (alt) patch[f] = alt[f];
      }
    }
    out.push({ key, canonical_id: canonical.id, deletes: sorted.slice(1).map((r) => r.id), patch });
  }
  return { groups: out, removed: out.reduce((a, g) => a + g.deletes.length, 0) };
}

async function dedupeLeads({ apply = false } = {}) {
  const rows = (await sbFetch('leads?select=*')) || [];
  const plan = dedupePlan(rows);
  if (!apply || !plan.groups.length) return { rows: rows.length, ...plan };
  for (const g of plan.groups) {
    if (Object.keys(g.patch).length) {
      await sbFetch(`leads?id=eq.${encodeURIComponent(g.canonical_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: g.patch });
    }
    for (const id of g.deletes) {
      await sbFetch(`leads?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
  }
  return { rows: rows.length, ...plan };
}

module.exports = { dedupePlan, dedupeLeads, norm };
