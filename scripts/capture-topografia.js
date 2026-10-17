/* Runner da categoria topografia — mesmo pipeline da captura principal.
   Uso: npm run capture:topografia */
process.env.BASENAME = 'topografia-df-max';
process.env.CAPTURE_CATEGORY = 'topografia';
process.env.QUERIES = process.env.QUERIES || require('./queries-topografia').QUERIES_TOP.join('|');

const { main } = require('./capture-advogados-df');

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
