/* Runner da categoria estofado — mesmo pipeline da captura principal.
   Uso: npm run capture:est */
process.env.BASENAME = 'estofado-df-max';
process.env.CAPTURE_CATEGORY = 'estofado';
process.env.QUERIES = process.env.QUERIES || require('./queries-estofado').QUERIES_EST.join('|');

const { main } = require('./capture-advogados-df');

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
