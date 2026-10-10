/* Localização do JSON de leads mais recente — usado por serve-web e sync.
   Seleção por registro (src/utils/categories): cada categoria só enxerga
   arquivos com a própria tag; 'advogados' (padrão) fica com o resto. */
const fs = require('node:fs');
const path = require('node:path');
const { CATEGORIES, tagOf } = require('./categories');

function matchFile(f, category) {
  const tag = tagOf(category);
  if (tag === 'advogados') {
    return !Object.values(CATEGORIES).some((c) => c.tag !== 'advogados' && f.startsWith(c.tag));
  }
  return f.startsWith(tag + '-');
}

function newestLeadsFile(dataDir, category = 'advogados') {
  const tag = tagOf(category);
  const preferred =
    tag === 'advogados'
      ? [process.env.BASENAME ? `${process.env.BASENAME}.v2.json` : null, 'advogados-df-max.v2.json', 'advogados-df-max.json'].filter(Boolean)
      : [`${tag}-df-max.v2.json`, `${tag}-df-max.json`];
  for (const f of preferred) {
    const p = path.join(dataDir, f);
    if (matchFile(f, category) && fs.existsSync(p)) return p;
  }
  const any = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && !f.includes('validacao') && !f.includes('job') && matchFile(f, category))
    .map((f) => ({ f, m: fs.statSync(path.join(dataDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return any.length ? path.join(dataDir, any[0].f) : null;
}

module.exports = { newestLeadsFile, matchFile };
