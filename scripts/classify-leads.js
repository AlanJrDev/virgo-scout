// Triagem dos leads por área de atuação → data/<basename>.v2.json
// Uso: npm run classify  (lê BASENAME do .env, padrão advogados-df-max)
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { classifyLead, areaDistribution } = require('../src/utils/classify');

function main() {
  const basename = process.env.BASENAME || 'advogados-df-max';
  const src = path.join(__dirname, '..', 'data', `${basename}.json`);
  const out = path.join(__dirname, '..', 'data', `${basename}.v2.json`);

  const leads = JSON.parse(fs.readFileSync(src, 'utf8'));
  const classified = leads.map((l) => {
    const { area, confidence } = classifyLead(l);
    return { ...l, area, area_conf: confidence };
  });

  fs.writeFileSync(out, JSON.stringify(classified, null, 2), 'utf8');

  const dist = areaDistribution(leads);
  const withArea = classified.filter((l) => l.area !== 'Geral').length;
  console.log(`[classify] ${leads.length} leads -> ${path.relative(process.cwd(), out)}`);
  console.log(`[classify] rotulados=${withArea} (${Math.round((100 * withArea) / leads.length)}%) gerais=${leads.length - withArea}`);
  for (const d of dist) {
    console.log(`  ${String(d.value).padStart(4)}  ${d.label}`);
  }
}

main();
