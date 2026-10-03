/* Localização do JSON de leads mais recente — usado por serve-web e sync.
   Categorias isoladas: 'arquitetura' só vê arquivos que começam com arquitetura;
   'advogados' (padrão) vê todos os demais. */
const fs = require('node:fs');
const path = require('node:path');

function newestLeadsFile(dataDir, category = 'advogados') {
  const isArq = (f) => f.startsWith('arquitetura');
  const match = (f) => (category === 'arquitetura' ? isArq(f) : !isArq(f));
  const preferred =
    category === 'arquitetura'
      ? ['arquitetura-df-max.v2.json', 'arquitetura-df-max.json']
      : [process.env.BASENAME ? `${process.env.BASENAME}.v2.json` : null, 'advogados-df-max.v2.json', 'advogados-df-max.json'].filter(Boolean);
  for (const f of preferred) {
    const p = path.join(dataDir, f);
    if (match(f) && fs.existsSync(p)) return p;
  }
  const any = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && !f.includes('validacao') && !f.includes('job') && match(f))
    .map((f) => ({ f, m: fs.statSync(path.join(dataDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return any.length ? path.join(dataDir, any[0].f) : null;
}

module.exports = { newestLeadsFile };
