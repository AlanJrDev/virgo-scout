/* Signups — store + validação do cadastro público. Sem HTTP: api/ e serve-web chamam daqui.
   Acesso a dados só via PostgREST (service key). Injeção opcional para testes:
   opts.sbFetch e opts.store (default: sb.js / user-store.js). */
const crypto = require('node:crypto');
const userStore = require('./user-store');
const { sbEnabled, sbFetch, SbError } = require('./sb');
const { isValidCpf, normCpf, maskCpf } = require('./cpf');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(code, status) {
  const e = new Error(code);
  e.code = code;
  e.status = status;
  return e;
}

function sbOf(opts) {
  if (opts && opts.sbFetch) return opts.sbFetch;
  if (sbEnabled()) return sbFetch;
  return null;
}

function validateSignup({ name, email, phone, cpf, pass } = {}) {
  const full = String(name || '').trim().replace(/\s+/g, ' ');
  const parts = full.split(' ').filter(Boolean);
  if (full.length < 5 || full.length > 120 || parts.length < 2 || parts[0].length < 2 || parts[parts.length - 1].length < 2) return { ok: false, code: 'invalid_name' };
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail) || mail.length > 254) return { ok: false, code: 'invalid_email' };
  const tel = normCpf(phone);
  const ddd = Number(tel.slice(0, 2));
  if ((tel.length !== 10 && tel.length !== 11) || ddd < 11 || ddd > 99) return { ok: false, code: 'invalid_phone' };
  if (!isValidCpf(cpf)) return { ok: false, code: 'invalid_cpf' };
  if (typeof pass !== 'string' || pass.length < 8 || pass.length > 128) return { ok: false, code: 'weak_pass' };
  return { ok: true, value: { full_name: full, email: mail, phone: tel, cpf: normCpf(cpf) } };
}

function hashNewPassword(pass) {
  const salt = crypto.randomBytes(16).toString('base64');
  return { algo: 'scrypt', salt, hash: userStore.hashPassword(pass, salt) };
}

async function createSignup(input, opts) {
  const sbf = sbOf(opts);
  if (!sbf) throw err('store_unavailable', 503);
  const v = validateSignup(input);
  if (!v.ok) throw err(v.code, 400);
  const row = v.value;
  const enc = encodeURIComponent(row.email);
  const emUsers = await sbf('users?email=eq.' + enc + '&select=email');
  if (emUsers && emUsers.length) throw err('duplicate', 409);
  const emSignups = await sbf('signups?email=eq.' + enc + '&status=in.(pending,approved)&select=id');
  if (emSignups && emSignups.length) throw err('duplicate', 409);
  const cpfSignups = await sbf('signups?cpf=eq.' + row.cpf + '&status=in.(pending,approved)&select=id');
  if (cpfSignups && cpfSignups.length) throw err('duplicate', 409);
  const cred = hashNewPassword(input.pass);
  let inserted;
  try {
    inserted = await sbf('signups', {
      method: 'POST',
      body: [{ full_name: row.full_name, email: row.email, phone: row.phone, cpf: row.cpf, algo: cred.algo, salt: cred.salt, hash: cred.hash, status: 'pending' }],
    });
  } catch (e) {
    // corrida de insert: unique violation do PostgREST vira duplicate (API responde genérico, anti-enumeração)
    if (e instanceof SbError && (e.status === 409 || String(e.code).startsWith('sb_409'))) throw err('duplicate', 409);
    throw e;
  }
  return { id: inserted && inserted[0] && inserted[0].id };
}

async function listSignups(opts) {
  const sbf = sbOf(opts);
  if (!sbf) throw err('store_unavailable', 503);
  const rows = await sbf('signups?select=id,full_name,email,phone,cpf,status,created_at,reviewed_at,reviewed_by&order=created_at.desc&limit=200');
  const items = (rows || []).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    email: r.email,
    phone: r.phone,
    cpf_masked: maskCpf(r.cpf),
    status: r.status,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
    reviewed_by: r.reviewed_by,
  }));
  return { items, truncated: items.length === 200 };
}

function revertToPending(sbf, id) {
  // best-effort: desfaz a reserva approved→pending (condicional a approved).
  // Falha aqui não mascara o erro original nem trava o retry (caminho `approved`
  // cuida da recuperação).
  const body = { status: 'pending', reviewed_at: null, reviewed_by: null };
  return sbf('signups?id=eq.' + id + '&status=eq.approved', { method: 'PATCH', body })
    .catch(() => null);
}

function is409OfCreation(e) {
  return !!(e && (e.code === 'user_exists' || (e instanceof SbError && (e.status === 409 || String(e.code).startsWith('sb_409')))));
}

function hashIgual(u, row) {
  return !!(u && u.algo === row.algo && u.salt === row.salt && u.hash === row.hash);
}

async function lookupUser(store, email) {
  // user-store local é sync/undefined — await + try cobrem sync, async e throw
  try {
    return await store.findUser(email);
  } catch (_) {
    return null;
  }
}

async function criaUsuarioOuReverte(store, sbf, id, row) {
  // usuário é criado DEPOIS da reserva approved; qualquer falha reverte a
  // reserva → próximo approve volta pelo caminho pending (o relançamento
  // preserva o erro original).
  try {
    await store.addUserWithHash(row.email, 'cofounder', { algo: row.algo, salt: row.salt, hash: row.hash });
    return;
  } catch (e) {
    if (is409OfCreation(e)) {
      const u = await lookupUser(store, row.email);
      if (hashIgual(u, row)) return; // corrida: usuário gravado com as MESMAS credenciais → sucesso
      await revertToPending(sbf, id);
      throw err('user_exists', 409);
    }
    await revertToPending(sbf, id);
    throw e;
  }
}

async function reviewSignup({ id, action, reviewer } = {}, opts) {
  const sbf = sbOf(opts);
  if (!sbf) throw err('store_unavailable', 503);
  if (action !== 'approve' && action !== 'reject') throw err('invalid_action', 400);
  if (!id || !UUID_RE.test(String(id))) throw err('not_found', 404);
  const rows = await sbf('signups?id=eq.' + encodeURIComponent(String(id)) + '&select=*');
  const row = rows && rows[0];
  if (!row) throw err('not_found', 404);
  const review = { reviewed_at: new Date().toISOString(), reviewed_by: reviewer || 'sistema' };

  if (action === 'reject') {
    // PATCH condicional: só grava se ainda pending — approve concorrente nunca
    // é sobrescrito; sem linhas = já revisado por outro revisor.
    const patched = await sbf('signups?id=eq.' + encodeURIComponent(String(id)) + '&status=eq.pending', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: 'rejected', reviewed_at: review.reviewed_at, reviewed_by: review.reviewed_by },
    });
    if (!patched || !patched.length) throw err('already_reviewed', 409);
    return { ok: true, status: 'rejected', email: row.email };
  }

  // approve: reserva PRIMEIRO (pending→approved), depois cria o usuário.
  // Sem reserva, um reject concorrente criaria um usuário de status rejeitado.
  const qid = encodeURIComponent(String(id));
  let reserved;
  try {
    reserved = await sbf('signups?id=eq.' + qid + '&status=eq.pending', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: 'approved', reviewed_at: review.reviewed_at, reviewed_by: review.reviewed_by },
    });
  } catch (e) {
    throw e; // falha de rede: propagar SEM criar usuário
  }
  if (!reserved || !reserved.length) {
    // 0 linhas: outro revisor venceu OU status approved gravado numa tentativa
    // anterior (retry idempotente).
    if (row.status !== 'approved') throw err('already_reviewed', 409);
    const store = (opts && opts.store) || userStore;
    const u = await lookupUser(store, row.email);
    if (hashIgual(u, row)) return { ok: true, status: 'approved', email: row.email, already: true };
    if (u) throw err('user_exists', 409);
    await criaUsuarioOuReverte(store, sbf, id, row); // recuperação: status gravado mas usuário não existe
    return { ok: true, status: 'approved', email: row.email };
  }
  // cidadela: usuário vivo só com a reserva approved garantida — o approve do
  // mesmo sign-up nunca cria um usuário de cadastro rejeitado.
  const store = (opts && opts.store) || userStore;
  await criaUsuarioOuReverte(store, sbf, id, row);
  return { ok: true, status: 'approved', email: row.email };
}

module.exports = { validateSignup, hashNewPassword, createSignup, listSignups, reviewSignup };
