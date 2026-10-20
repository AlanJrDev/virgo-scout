const fs = require('node:fs');
const path = require('node:path');
const { buildPayload } = require('../src/utils/metrics');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(__dirname, '..', 'web', 'data', 'leads.js');

function pickSrc() {
  if (process.env.BASENAME) {
    const a = path.join(DATA, `${process.env.BASENAME}.v2.json`);
    const b = path.join(DATA, `${process.env.BASENAME}.json`);
    if (fs.existsSync(a)) return a;
    if (fs.existsSync(b)) return b;
  }
  const c = path.join(DATA, 'advogados-df-max.v2.json');
  const d = path.join(DATA, 'advogados-df-max.json');
  if (fs.existsSync(c)) return c;
  if (fs.existsSync(d)) return d;
  const newest = fs.readdirSync(DATA).filter((f) => f.endsWith('-max.json') || f.endsWith('-max.v2.json'))
    .map((f) => ({ f, t: fs.statSync(path.join(DATA, f)).mtimeMs })).sort((x, y) => y.t - x.t)[0];
  return newest ? path.join(DATA, newest.f) : null;
}

function main() {
  const src = pickSrc();
  if (!src) { console.log('leads.js mantido: nenhum JSON de leads em data/'); return; }
  const parsed = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!Array.isArray(parsed)) { console.log(`leads.js mantido: ${path.basename(src)} não é um array de leads`); return; }
  const leads = parsed;
  const raw = src.replace(/\.v2\.json$/, '.json');
  const rawPath = fs.existsSync(raw) ? raw : src;
  const payload = buildPayload(leads, { dataDir: DATA, fallbackTs: fs.statSync(rawPath).mtimeMs });
  payload.source = path.basename(src);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, 'window.VIRGO_DATA = ' + JSON.stringify(payload) + ';\n', 'utf8');
  const topName = (payload.top && payload.top[0] && payload.top[0].name) || 'N/A';
  const topScore = (payload.top && payload.top[0] && payload.top[0].score) || 0;
  console.log(`leads.js gerado de ${payload.source}: total=${payload.stats.total} top=${topName} (${topScore}) areas=${payload.areas.length}`);
}

main();
