const fs = require('node:fs');
const path = require('node:path');
const { buildPayload } = require('../src/utils/metrics');

const DATA = path.join(__dirname, '..', 'data');
const SRC = path.join(DATA, process.env.BASENAME ? `${process.env.BASENAME}.v2.json` : 'advogados-df-max.v2.json');
const FALLBACK = path.join(DATA, 'advogados-df-max.json');
const OUT = path.join(__dirname, '..', 'web', 'data', 'leads.js');

function main() {
  const src = fs.existsSync(SRC) ? SRC : FALLBACK;
  const leads = JSON.parse(fs.readFileSync(src, 'utf8'));
  const raw = src.replace(/\.v2\.json$/, '.json');
  const rawPath = fs.existsSync(raw) ? raw : src;
  const payload = buildPayload(leads, { dataDir: DATA, fallbackTs: fs.statSync(rawPath).mtimeMs });
  payload.source = path.basename(src);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, 'window.VIRGO_DATA = ' + JSON.stringify(payload) + ';\n', 'utf8');
  console.log(`leads.js gerado de ${payload.source}: total=${payload.stats.total} top=${payload.top[0].name} (${payload.top[0].score}) areas=${payload.areas.length}`);
}

main();
