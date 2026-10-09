// Marcação de contato no pipeline (Supabase via PostgREST).
// status: 'novo' | 'contatado' | ... — ver supabase/migrations/0003_leads_pipeline.sql
const { sbFetch } = require('./sb');

async function markContacted(id) {
  const iid = String(id || '');
  if (!/^[a-f0-9]{6,64}$/i.test(iid)) {
    const e = new Error('invalid_id');
    e.code = 'invalid_id';
    throw e;
  }
  await sbFetch(`leads?id=eq.${iid}`, {
    method: 'PATCH',
    body: { status: 'contatado', last_contact_at: new Date().toISOString() },
  });
  return true;
}

module.exports = { markContacted };
