/* Runner da categoria arquitetura/topografia/urbanismo — mesmo pipeline da captura principal.
   Uso: npm run capture:arq */
process.env.BASENAME = 'arquitetura-df-max';
process.env.CAPTURE_CATEGORY = 'arquitetura';
process.env.QUERIES = process.env.QUERIES || require('./queries-arquitetura').QUERIES.join('|');

const { main } = require('./capture-advogados-df');

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
