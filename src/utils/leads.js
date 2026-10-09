function parseRating(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(',', '.').replace(/[^\d.]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseReviews(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const digits = String(v).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function cleanPhone(v) {
  const s = String(v || '').trim().replace(/^tel:/i, '');
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8) return ''; // glifo de ícone ou lixo
  return s.replace(/\s+/g, ' ');
}

function cleanAddress(v) {
  let s = String(v || '').trim().replace(/\s+/g, ' ');
  // remove prefixo de glifo de ícone (Maps renderiza /etc no innerText)
  s = s.replace(/^[^\p{L}\d]+/u, '');
  // remove sufixo duplicado " - <trecho já contido>": ex "A - DF - Asa Sul, Brasília - DF" -> "A - DF - Asa Sul"
  const parts = s.split(' - ').map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const joined = out.join(' - ');
    if (joined.toLowerCase().includes(p.toLowerCase())) continue;
    out.push(p);
  }
  // apara caudas duplicadas do último segmento: ", Cidade - UF", depois ", Cidade",
  // enquanto a cauda já consta no corpo. Ex: "... - Asa Sul, Brasília - DF" -> "... - Asa Sul"
  if (out.length > 1) {
    const joined = out.slice(0, -1).join(' - ').toLowerCase();
    let last = out[out.length - 1];
    let changed = true;
    while (changed) {
      changed = false;
      const m = last.match(/,\s*([^,]+)\s*$/);
      if (m && /[a-zA-Z\u00C0-\u024F]/.test(m[1]) && joined.includes(m[1].trim().toLowerCase())) {
        last = last.slice(0, m.index).trim().replace(/ -$/, '');
        changed = true;
      }
    }
    out[out.length - 1] = last;
  }
  return out.join(' - ');
}

function normalizeLead(raw = {}) {
  const name = String(raw.name || '').trim().replace(/\s+/g, ' ');
  const address = cleanAddress(raw.address);
  const phone = cleanPhone(raw.phone);
  const website = String(raw.website || '').trim();
  const source = String(raw.source || '').trim();
  return {
    name,
    rating: parseRating(raw.rating),
    reviews: parseReviews(raw.reviews),
    address,
    phone,
    website,
    source,
    captured_at: raw.captured_at || new Date().toISOString(),
    category: String(raw.category || '').trim() || null,
    plus_code: String(raw.plus_code || '').trim() || null,
    lat: Number.isFinite(parseFloat(raw.lat)) ? parseFloat(raw.lat) : null,
    lng: Number.isFinite(parseFloat(raw.lng)) ? parseFloat(raw.lng) : null,
    place_id: String(raw.place_id || '').trim() || null,
    claimed: raw.claimed === true || raw.claimed === false ? raw.claimed : null,
    hours: String(raw.hours || '').trim() || null,
    closed: !!raw.closed,
    photos: Number.isFinite(parseInt(raw.photos, 10)) ? parseInt(raw.photos, 10) : null,
    instagram: String(raw.instagram || '').trim() || null,
    facebook: String(raw.facebook || '').trim() || null,
  };
}

function keyOf(lead) {
  const n = String(lead.name || '').toLowerCase().trim();
  const a = String(lead.address || '').toLowerCase().trim();
  return `${n}||${a}`;
}

function dedupeLeads(leads = []) {
  const seen = new Set();
  const out = [];
  for (const l of leads) {
    const k = keyOf(l);
    if (!k || k === '||') continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

function escCSV(v) {
  const s = v == null ? '' : String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSVRow(obj) {
  const cols = ['name', 'rating', 'reviews', 'address', 'phone', 'website', 'source', 'captured_at',
    'category', 'plus_code', 'lat', 'lng', 'place_id', 'claimed', 'hours', 'closed', 'photos', 'instagram', 'facebook'];
  return cols.map((c) => escCSV(obj[c])).join(';');
}

function toCSV(leads = []) {
  const header = 'name;rating;reviews;address;phone;website;source;captured_at;category;plus_code;lat;lng;place_id;claimed;hours;closed;photos;instagram;facebook';
  return [header, ...leads.map(toCSVRow)].join('\n');
}

module.exports = { normalizeLead, dedupeLeads, toCSVRow, toCSV, parseRating, parseReviews };
