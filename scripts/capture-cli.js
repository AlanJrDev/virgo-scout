#!/usr/bin/env node
/* CLI de captura V2 — "como era no início": query string livre no argv.
   Uso:
     node scripts/capture-cli.js "topografia aguas claras, plano piloto, lago sul e lago norte"
     ...) [--dry-run | --yes]
   - Sem flags: mostra o plano (categoria, RAs, budget, queries count) e NÃO executa.
   - --dry-run: idem + lista TODAS as queries que rodariam.
   - --yes: executa de verdade (spawn node scripts/capture-advogados-df.js, herda
     stdout/stderr do processo atual; CAPTURE_CATEGORY + QUERIES| + BASENAME no env).
   Sidecar de estado ao final: data/<basename>-meta.json (+ -hist.json). */
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseCapturePrompt, planFor } = require('../src/utils/prompt-parse');
const { CATEGORIES } = require('../src/utils/categories');
const { defaultBudgetMinutes } = require('../src/utils/capture-plan');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes');
const prompt = args.filter((a) => a !== '--dry-run' && a !== '--yes').join(' ').trim();

const USAGE = `Uso: node scripts/capture-cli.js "<prompt de captura>" [--dry-run | --yes]
Ex:  node scripts/capture-cli.js "topografia aguas claras, plano piloto, lago sul" --yes`;
if (!prompt) { console.log(USAGE); process.exit(1); }

const parsed = parseCapturePrompt(prompt);
if (!parsed.category) {
  console.log(`\n[cli] low_signal: nenhuma categoria reconhecida no prompt.\n→ ${USAGE}`);
  process.exit(2);
}
const cat = parsed.category;
const cfg = CATEGORIES[cat];
const { plan, place, placeType } = planFor(cat, parsed);
const queries = plan.map((p) => p.query);
const budget = defaultBudgetMinutes(queries.length);
const basename = cfg.basename || `${cat}-df-max`;

console.log('\n── plano de captura ──────────────────────────────');
console.log(`prompt     : ${prompt}`);
console.log(`categoria  : ${cat} (${cfg.label})`);
console.log(`ra         : ${parsed.ras.length ? parsed.ras.join(', ') : 'DF inteiro'}`);
console.log(`df inteiro : ${parsed.df ? 'sim' : 'não'}`);
console.log(`place      : ${place} (${placeType})`);
console.log(`matched    : ${parsed.matched.map((m) => `${m.term}${m.ra ? `→${m.ra}` : ''}`).join(' | ')}`);
console.log(`queries    : ${queries.length}`);
console.log(`budget est.: ~${budget} min`);
console.log(`sidecar    : data/${basename}-meta.json`);
console.log('──────────────────────────────────────────────────');

if (dryRun) {
  console.log('\n[dry-run] queries que rodariam:');
  queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  process.exit(0);
}
if (!yes) {
  console.log('\n[cli] nada executado — use --yes para rodar ou --dry-run para listar as queries.');
  process.exit(0);
}

console.log(`\n[cli] executando: node scripts/${cfg.script} (queries=${queries.length})\n`);
const child = spawnSync(
  process.execPath,
  [path.join('scripts', cfg.script)],
  {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      CAPTURE_CATEGORY: cat,
      BASENAME: basename,
      QUERIES: queries.join('|'),
    },
  }
);
if (child.error) { console.error(`[cli] falha ao spawnar: ${child.error.message}`); process.exit(1); }
console.log(`\n[cli] fim (exit=${child.status}) — sidecar: data/${basename}-meta.json`);
process.exit(child.status || 0);
