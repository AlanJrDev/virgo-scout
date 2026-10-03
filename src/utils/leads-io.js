/* Localização do JSON de leads mais recente — usada por serve-web e sync */
const fs = require('node:fs');
const path = require('node:path');

function newestLeadsFile(dataDir) {
  const preferred = [process.env.BASENAME ? `${process.env.BASENAME}.v2.json` : null, 'advogados-df-max.v2.json', 'advogados-df-max.json'].filter(Boolean);
  for (const f of preferred) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) return p;
  }
  const any = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && !f.includes('validacao') && !f.includes('job'))
    .map((f) => ({ f, m: fs.statSync(path.join(dataDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return any.length ? path.join(dataDir, any[0].f) : null;
}

module.exports = { newestLeadsFile };
