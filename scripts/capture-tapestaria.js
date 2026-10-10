/* Runner da categoria tapeçaria — mesmo pipeline da captura principal.
   Uso: npm run capture:tap */
process.env.BASENAME = 'tapestaria-df-max';
process.env.CAPTURE_CATEGORY = 'tapestaria';
process.env.QUERIES = process.env.QUERIES || require('./queries-tapestaria').QUERIES_TAP.join('|');

const { main } = require('./capture-advogados-df');

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
