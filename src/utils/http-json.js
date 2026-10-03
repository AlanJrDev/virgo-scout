/* Resposta JSON comum — serve-web local e funções da Vercel */
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

module.exports = { json };
