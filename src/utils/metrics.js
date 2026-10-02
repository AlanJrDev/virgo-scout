// Geração do payload do dashboard — compartilhada entre build estático (build-web-data)
// e a API ao vivo (serve-web), garantindo os mesmos números nos dois caminhos.
const fs = require('node:fs');
const path = require('node:path');
const { areaDistribution } = require('./classify');
const { parseRating, parseReviews } = require('./leads');
const { waLink, waMessage } = require('./wa');

// Regiões do DF com coordenadas (aproximação por região — a base não tem geocoding)
const REGIONS = [
  { key: 'aguas claras', label: 'Águas Claras', lat: -15.8489, lng: -48.0256 },
  { key: 'taguatinga', label: 'Taguatinga', lat: -15.8346, lng: -48.0535 },
  { key: 'ceilandia', label: 'Ceilândia', lat: -15.8144, lng: -48.111 },
  { key: 'samambaia', label: 'Samambaia', lat: -15.8767, lng: -48.0825 },
  { key: 'sobradinho', label: 'Sobradinho', lat: -15.6514, lng: -47.7906 },
  { key: 'planaltina', label: 'Planaltina', lat: -15.6178, lng: -47.65 },
  { key: 'santa maria', label: 'Santa Maria', lat: -15.9939, lng: -47.9378 },
  { key: 'guara', label: 'Guará', lat: -15.8222, lng: -47.9717 },
  { key: 'gama', label: 'Gama', lat: -15.9578, lng: -48.0517 },
  { key: 'riacho fundo', label: 'Riacho Fundo', lat: -15.8964, lng: -47.9864 },
  { key: 'nucleo bandeirante', label: 'Núcleo Bandeirante', lat: -15.8729, lng: -47.9664 },
  { key: 'asa sul', label: 'Brasília', lat: -15.7939, lng: -47.8828 },
  { key: 'asa norte', label: 'Brasília', lat: -15.7939, lng: -47.8828 },
  { key: 'eixo', label: 'Brasília', lat: -15.7939, lng: -47.8828 },
  { key: 'plano piloto', label: 'Brasília', lat: -15.7939, lng: -47.8828 },
];

function normTxt(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// região a partir de endereço + query de origem; fallback = Brasília
function regionOfLead(lead) {
  const txt = normTxt([lead.address, lead.source].filter(Boolean).join(' '));
  for (const r of REGIONS) {
    if (new RegExp(`\\b${r.key}\\b`).test(txt)) return r;
  }
  return { key: 'brasilia', label: 'Brasília', lat: -15.7939, lng: -47.8828 };
}

// agregado por região: [{label, lat, lng, count, comSite, alta, comPhone, avgScore}]
function regionAgg(leads = []) {
  const byLabel = new Map();
  for (const l of leads) {
    const r = regionOfLead(l);
    let a = byLabel.get(r.label);
    if (!a) {
      a = { label: r.label, lat: r.lat, lng: r.lng, count: 0, comSite: 0, alta: 0, comPhone: 0, scoreSum: 0 };
      byLabel.set(r.label, a);
    }
    a.count++;
    if (l.website) a.comSite++;
    if ((l.rating || 0) >= 4.5 && (l.reviews || 0) >= 20) a.alta++;
    if (/\d{8,}/.test(l.phone || '')) a.comPhone++;
    a.scoreSum += scoreOf(l);
  }
  return [...byLabel.values()]
    .map((a) => ({ ...a, avgScore: Math.round(a.scoreSum / (a.count || 1)) }))
    .sort((a, b) => b.count - a.count);
}

// histograma de notas: faixas [0-2, 2-3, 3-4, 4-4.5, 4.5-5] (só leads com nota)
function ratingBuckets(leads = []) {
  const buckets = [
    { label: '0 – 2', value: 0 },
    { label: '2 – 3', value: 0 },
    { label: '3 – 4', value: 0 },
    { label: '4 – 4,5', value: 0 },
    { label: '4,5 – 5', value: 0 },
  ];
  for (const l of leads) {
    const r = l.rating;
    if (r == null || !Number.isFinite(r)) continue;
    if (r < 2) buckets[0].value++;
    else if (r < 3) buckets[1].value++;
    else if (r < 4) buckets[2].value++;
    else if (r < 4.5) buckets[3].value++;
    else buckets[4].value++;
  }
  return buckets;
}

function cleanName(s) {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
    .replace(/\s*-\s*/g, ' - ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^-\s*|\s*-$/g, '');
}

function scoreOf(l) {
  const r = l.rating || 0;
  const rev = l.reviews || 0;
  let s = r * 18 + Math.log10(rev + 1) * 8;
  if (l.website) s += 6;
  if (/\d{8,}/.test(l.phone || '')) s += 6;
  return Math.max(0, Math.min(99, Math.round(s)));
}

function badgeOf(score) {
  if (score >= 80) return 'Alta';
  if (score >= 60) return 'Média';
  return 'Baixa';
}

function prepare(leads = []) {
  return leads
    .map((l) => ({ ...l, name: cleanName(l.name), rating: parseRating(l.rating), reviews: parseReviews(l.reviews) }))
    .filter((l) => l.name && !/^resultados?$/i.test(l.name.trim()));
}

function buildStats(leads) {
  const total = leads.length;
  const comSite = leads.filter((l) => l.website).length;
  const comPhone = leads.filter((l) => /\d{8,}/.test(l.phone || '')).length;
  const alta = leads.filter((l) => (l.rating || 0) >= 4.5 && (l.reviews || 0) >= 20).length;
  const qualif = leads.filter((l) => l.website && /\d{8,}/.test(l.phone || '') && (l.rating || 0) >= 4.5).length;
  const pct = (n) => (total ? Math.round((100 * n) / total) : 0);
  return { total, comSite, semSite: total - comSite, comPhone, alta, qualif, pctSite: pct(comSite), pctAlta: pct(alta), pctQualif: pct(qualif) };
}

function regionOf(address) {
  const a = String(address || '');
  if (/Taguatinga/i.test(a)) return 'Taguatinga';
  if (/Ceilândia|Ceilandia/i.test(a)) return 'Ceilândia';
  if (/Águas Claras|Aguas Claras/i.test(a)) return 'Águas Claras';
  return 'Brasília';
}

function buildTop(leads, n = 5) {
  return leads
    .map((l) => ({ ...l, score: scoreOf(l) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((l) => ({
      name: l.name,
      area: l.area || 'Geral',
      cat: `${l.area || 'Advocacia'} · ${regionOf(l.address)}/DF`,
      score: l.score,
      badge: badgeOf(l.score),
      rating: l.rating,
      reviews: l.reviews,
      site: !!l.website,
      phone: /\d{8,}/.test(l.phone || ''),
      phone_raw: l.phone || '',
      wa: l.phone ? waLink(l.phone, waMessage(l.name)) : null,
    }));
}

function seedRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildDots(leads) {
  const rand = seedRand(20260429);
  return leads.slice(0, 34).map((l, i) => {
    const ang = rand() * Math.PI * 2;
    const rad = 6 + rand() * 30;
    return { x: +(50 + Math.cos(ang) * rad * 1.25).toFixed(1), y: +(52 + Math.sin(ang) * rad * 0.85).toFixed(1), hot: i < 6 };
  });
}

// série real: acumulado de leads capturados por dia nos últimos 7 dias (captured_at).
// Leads legados sem captured_at recebem fallbackTs (mtime do arquivo da captura).
function buildSeries(leads, fallbackTs) {
  const fb = Number.isFinite(fallbackTs) ? fallbackTs : Date.now();
  const tsOf = (l) => {
    const t = Date.parse(l.captured_at);
    return Number.isFinite(t) ? t : fb;
  };
  const days = [];
  const values = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(23, 59, 59, 999);
    const end = d.getTime();
    days.push(String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'));
    values.push(leads.filter((l) => tsOf(l) <= end).length);
  }
  for (let i = 1; i < values.length; i++) values[i] = Math.max(values[i], values[i - 1]);
  return { days, values };
}

function relTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

// capturas reais lidas dos arquivos em data/ (exclui .v2 e arquivos de teste)
function buildRecent(dataDir) {
  try {
    const files = fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith('.json') && !f.includes('.v2') && !f.includes('validacao'))
      .map((f) => {
        const p = path.join(dataDir, f);
        let count = 0;
        try {
          count = JSON.parse(fs.readFileSync(p, 'utf8')).length;
        } catch {}
        return { file: f, mtime: fs.statSync(p).mtimeMs, count };
      })
      .filter((f) => f.count > 0)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3);
    return files.map((f) => ({
      tag: f.file.replace(/\.json$/, '').replace(/-/g, ' '),
      detail: `${f.count} empresas · Concluída`,
      status: 'done',
      when: relTime(f.mtime),
    }));
  } catch {
    return [];
  }
}

// variação % entre as duas capturas mais recentes de data/ (null se só há uma)
function buildDelta(dataDir) {
  try {
    const files = fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith('.json') && !f.includes('.v2') && !f.includes('validacao') && !f.includes('job'))
      .map((f) => {
        const p = path.join(dataDir, f);
        let count = 0;
        try {
          count = JSON.parse(fs.readFileSync(p, 'utf8')).length;
        } catch {}
        return { m: fs.statSync(p).mtimeMs, count };
      })
      .filter((f) => f.count > 0)
      .sort((a, b) => b.m - a.m);
    if (files.length < 2 || !files[1].count) return null;
    return Math.round(((files[0].count - files[1].count) / files[1].count) * 100);
  } catch {
    return null;
  }
}

function buildPayload(leads, opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, '..', '..', 'data');
  const prepared = prepare(leads);
  const scored = prepared.map((l) => ({ ...l, score: scoreOf(l) })).sort((a, b) => b.score - a.score);
  const stats = buildStats(prepared);
  return {
    generated_at: new Date().toISOString(),
    stats,
    delta_pct: buildDelta(dataDir),
    areas: areaDistribution(prepared),
    regions: regionAgg(prepared),
    ratingBuckets: ratingBuckets(prepared),
    top: buildTop(prepared),
    pool: buildTop(prepared, 30),
    dots: buildDots(scored),
    series: buildSeries(prepared, opts.fallbackTs),
    donut: [
      { label: 'Com site', value: stats.comSite, color: '#2E7CF6' },
      { label: 'Sem site', value: stats.semSite, color: '#38BDF8' },
      { label: 'Alta prioridade', value: stats.alta, color: '#F87171' },
    ],
    recent: buildRecent(dataDir),
  };
}

module.exports = { cleanName, scoreOf, badgeOf, prepare, buildStats, buildTop, buildSeries, buildRecent, buildPayload };
