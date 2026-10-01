const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'data', 'advogados-df-max.json');
const OUT = path.join(__dirname, '..', 'web', 'data', 'leads.js');

function seedRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
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

function main() {
  const leads = JSON.parse(fs.readFileSync(SRC, 'utf8'))
    .map((l) => ({ ...l, name: cleanName(l.name) }))
    .filter((l) => l.name && !/^resultados?$/i.test(l.name.trim()));
  const total = leads.length;
  const comSite = leads.filter((l) => l.website).length;
  const semSite = total - comSite;
  const alta = leads.filter((l) => (l.rating || 0) >= 4.5 && (l.reviews || 0) >= 20).length;
  const qualif = leads.filter(
    (l) => l.website && /\d{8,}/.test(l.phone || '') && (l.rating || 0) >= 4.5
  ).length;

  const scored = leads
    .map((l) => ({ ...l, score: scoreOf(l), badge: badgeOf(scoreOf(l)) }))
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5).map((l) => ({
    name: l.name,
    cat: `Advocacia · ${/Taguatinga/i.test(l.address) ? 'Taguatinga' : /Ceilândia|Ceilandia/i.test(l.address) ? 'Ceilândia' : /Águas Claras|Aguas Claras/i.test(l.address) ? 'Águas Claras' : 'Brasília'}/DF`,
    score: l.score,
    badge: badgeOf(scoreOf(l)),
    rating: l.rating,
    reviews: l.reviews,
    site: !!l.website,
    phone: /\d{8,}/.test(l.phone || ''),
  }));

  // mapa: 26 pontos determinísticos ao redor do centro
  const rand = seedRand(20260429);
  const dots = scored.slice(0, 34).map((l, i) => {
    const ang = rand() * Math.PI * 2;
    const rad = 6 + rand() * 30;
    return {
      x: +(50 + Math.cos(ang) * rad * 1.25).toFixed(1),
      y: +(52 + Math.sin(ang) * rad * 0.85).toFixed(1),
      hot: i < 6,
    };
  });

  // série 7 dias determinística terminando no total
  const r2 = seedRand(77);
  const weights = [0.42, 0.5, 0.55, 0.68, 0.72, 0.86, 1].map((w) => w * (0.97 + r2() * 0.06));
  const series = weights.map((w) => Math.round(total * w));
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'));
  }

  const payload = {
    stats: {
      total,
      comSite,
      semSite,
      alta,
      qualif,
      pctSite: Math.round((100 * comSite) / total),
      pctAlta: Math.round((100 * alta) / total),
      pctQualif: Math.round((100 * qualif) / total),
    },
    top,
    dots,
    series: { days, values: series },
    donut: [
      { label: 'Com site', value: comSite, color: '#2E7CF6' },
      { label: 'Sem site', value: semSite, color: '#38BDF8' },
      { label: 'Alta prioridade', value: alta, color: '#F87171' },
    ],
    recent: [
      { tag: 'Advocacia · Brasília/DF', detail: `${total} empresas · 68%`, status: 'active', when: 'há 12 min' },
      { tag: 'Advocacia · Taguatinga/DF', detail: '100 empresas · Concluída', status: 'done', when: 'há 2 h' },
      { tag: 'Advocacia · Águas Claras/DF', detail: '87 empresas · Concluída', status: 'done', when: 'há 4 h' },
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, 'window.VIRGO_DATA = ' + JSON.stringify(payload) + ';\n', 'utf8');
  console.log(`leads.js gerado: total=${total} top=${top[0].name} (${top[0].score})`);
}

main();
