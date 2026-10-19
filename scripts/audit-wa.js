/* Auditoria da qualidade do WhatsApp captado.
   npm run audit:wa [-- --no-probe] [--local data/arquivo.json] [--limit N]

   - Offline: classifica cada número em declared | suspect | invalid (utils/wa-audit).
   - Online (padrão): probe https://wa.me/<digits> → reachable | unknown | unreachable.
     ATENÇÃO: o wa.me não diz mais se o número EXISTE no WhatsApp (a página é genérica);
     o probe só confirma que o link resolve para um chat de telefone. A verificação
     definitiva de existência exige sessão (Baileys/whatsapp-web.js onWhatsApp).
   - Gera data/wa-audit-<data>.json + .csv e um resumo no console. */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { sbFetch } = require('../src/utils/sb');
const { classifyWaNumber } = require('../src/utils/wa-audit');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SELECT = 'id,name,phone,whatsapp,address,website,instagram';

async function loadLeads({ local, limit }) {
  if (local) {
    const leads = JSON.parse(fs.readFileSync(local, 'utf8'));
    return leads.filter((l) => l.whatsapp).slice(0, limit || undefined);
  }
  const q = `leads?select=${SELECT}&whatsapp=not.is.null&order=id${limit ? `&limit=${limit}` : ''}`;
  return (await sbFetch(q)) || [];
}

// Probe fraco: confirma que o link resolve para um chat de número (não a existência).
async function probe(digits) {
  try {
    const r = await fetch('https://wa.me/' + digits, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36' },
    });
    if (!r.ok) return 'unreachable';
    return /type=phone_number/.test(r.url || '') ? 'reachable' : 'unknown';
  } catch {
    return 'unreachable';
  }
}

async function audit({ local, limit, noProbe } = {}) {
  const leads = await loadLeads({ local, limit });
  const rows = leads.map((l) => {
    const c = classifyWaNumber(l);
    return {
      id: l.id || null,
      name: l.name || '',
      declared_raw: l.whatsapp || '',
      phone: l.phone || '',
      address: l.address || '',
      digits: c.digits,
      ddd: c.ddd,
      mobile: c.mobile,
      status: c.status,
      reasons: [...c.reasons],
      duplicate_of: 0,
      probe: noProbe ? 'skipped' : null,
    };
  });

  const counts = new Map();
  for (const r of rows) if (r.digits) counts.set(r.digits, (counts.get(r.digits) || 0) + 1);
  for (const r of rows) {
    if (r.digits && counts.get(r.digits) > 1) {
      r.duplicate_of = counts.get(r.digits);
      r.reasons.push('shared_number');
    }
  }

  if (!noProbe) {
    for (const r of rows) {
      if (!r.digits) { r.probe = 'skip'; continue; }
      r.probe = await probe(r.digits);
      await sleep(300);
    }
  }

  return rows;
}

function summarize(rows) {
  const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  const reasonHist = {};
  for (const r of rows) for (const reason of r.reasons) reasonHist[reason] = (reasonHist[reason] || 0) + 1;
  return { total: rows.length, status: by('status'), probe: by('probe'), reasons: reasonHist };
}

function toCsv(rows) {
  const cols = ['id', 'name', 'declared_raw', 'digits', 'ddd', 'mobile', 'status', 'probe', 'duplicate_of', 'reasons', 'phone', 'address'];
  const esc = (v) => {
    const s = Array.isArray(v) ? v.join('|') : v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n');
}

/* Grava o veredito do classificador na base: só marca wa_status/wa_checked_at.
   Nunca limpa whatsapp (invalid) nem muda origem — terceiro decide. */
async function persistWaStatus(rows) {
  let writes = 0;
  for (const r of rows) {
    if (!r.id || !['declared', 'suspect', 'invalid'].includes(r.status)) continue;
    try {
      await sbFetch(`leads?id=eq.${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { wa_status: r.status, wa_checked_at: new Date().toISOString() },
      });
      writes++;
    } catch (e) {
      if (/wa_(status|checked_at)/.test(e.message)) {
        console.error('[audit:wa] colunas de evidência ausentes — aplique supabase/migrations/0010 no SQL Editor');
        return writes; // aborta o resto; relatório de arquivos segue no main
      }
      console.warn(`[audit:wa] persist ${r.id} falhou: ${e.message}`);
    }
  }
  return writes;
}

async function main() {
  const args = process.argv.slice(2);
  const localIdx = args.indexOf('--local');
  const local = localIdx !== -1 ? args[localIdx + 1] : null;
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;
  const noProbe = args.includes('--no-probe');

  const rows = await audit({ local, limit, noProbe });
  const writes = await persistWaStatus(rows);
  const sum = summarize(rows);

  const dir = path.join(__dirname, '..', 'data');
  const stamp = new Date().toISOString().slice(0, 10);
  const base = path.join(dir, `wa-audit-${stamp}`);
  fs.writeFileSync(base + '.json', JSON.stringify({ generated_at: new Date().toISOString(), summary: sum, rows }, null, 2));
  fs.writeFileSync(base + '.csv', toCsv(rows));

  console.log(`\n[audit:wa] ${sum.total} números declarados`);
  console.log(`[audit:wa] ${writes} status gravado(s) na base`);
  console.log('[audit:wa] status:', JSON.stringify(sum.status));
  console.log('[audit:wa] probe :', JSON.stringify(sum.probe));
  console.log('[audit:wa] motivos:', JSON.stringify(sum.reasons));
  const suspects = rows.filter((r) => r.status !== 'declared');
  if (suspects.length) {
    console.log(`\n[audit:wa] ${suspects.length} suspeitos/inválidos:`);
    for (const r of suspects.slice(0, 40)) {
      console.log(`  - ${r.status.padEnd(7)} ${String(r.digits || r.declared_raw).padEnd(15)} ${r.reasons.join(',')}  | ${r.name.slice(0, 38)}`);
    }
  }
  console.log(`\n[audit:wa] relatórios: ${path.basename(base)}.json / .csv`);
  return sum;
}

if (require.main === module) {
  main().catch((e) => { console.error('[audit:wa]', e.message); process.exit(1); });
}
module.exports = { audit, summarize, toCsv, probe, persistWaStatus };
