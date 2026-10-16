// Registro do desfecho comercial do lead (base do feedback de calibração).
const { sbFetch } = require('./sb');

const ALLOWED = ['novo', 'contatado', 'respondeu', 'reuniao', 'fechou', 'perdeu'];

async function markOutcome(id, outcome) {
  const iid = String(id || '');
  if (!/^[A-Za-z0-9_:.]{6,128}$/.test(iid)) { const e = new Error('invalid_id'); e.code = 'invalid_id'; throw e; }
  if (!ALLOWED.includes(outcome)) { const e = new Error('invalid_outcome'); e.code = 'invalid_outcome'; throw e; }
  await sbFetch(`leads?id=eq.${iid}`, { method: 'PATCH', body: { outcome, outcome_at: new Date().toISOString() } });
  return true;
}

module.exports = { markOutcome, ALLOWED };
