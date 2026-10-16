/* Instagram em batch. npm run enrich:ig [limite]
   Resumível por ig_checked_at. Muro de login => grava só ig_checked_at. */
require('dotenv').config();
const { sbFetch } = require('../src/utils/sb');
const { fetchIg } = require('../src/enrich/instagram');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = parseInt(process.argv[2] || '40', 10);
  const rows = (await sbFetch(`leads?select=id,instagram&instagram=not.is.null&ig_checked_at=is.null&order=id&limit=${limit}`)) || [];
  console.log(`[enrich:ig] ${rows.length} perfis a checar`);
  let ok = 0, dados = 0, blocked = 0;
  for (const r of rows) {
    const res = await fetchIg(r.instagram);
    const patch = { ig_checked_at: new Date().toISOString() };
    if (res && !res.blocked) {
      if (res.followers != null) patch.ig_followers = res.followers;
      if (res.posts != null) patch.ig_posts = res.posts;
      if (res.last_post) patch.ig_last_post = res.last_post;
      dados++;
    } else blocked++;
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch });
      ok++;
    } catch (e) { console.error(`[enrich:ig] erro ${r.id}: ${e.message}`); }
    await sleep(1200);
  }
  console.log(`[enrich:ig] concluído: ${ok} ok, ${dados} com dados, ${blocked} blocked`);
}

if (require.main === module) main().catch((e) => { console.error('[enrich:ig]', e.message); process.exit(1); });
module.exports = { main };
