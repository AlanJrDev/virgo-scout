/* Store de usuários — dispatcher: SUPABASE_URL/SECRET setados ⇒ PostgREST;
   sem env ⇒ auth/users.json local (síncrono, como sempre).
   Regra: TODOS os chamadores de produção devem consumir com await —
   com env as funções retornam Promise, sem env retornam valor cru. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sbEnabled, sbFetch } = require('./sb');

const ROLES = new Set(['founder', 'cofounder']);
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, keylen: 64 };

function usersFile() {
  return process.env.USERS_FILE || path.join(__dirname, '..', '..', 'auth', 'users.json');
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

/* ---------- local (JSON) ---------- */
function localReadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(usersFile(), 'utf8'));
    if (!raw || raw.version !== 1 || !Array.isArray(raw.users)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeStore(store) {
  const file = usersFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, file);
}

function hashPassword(pass, saltB64) {
  const { N, r, p, keylen } = SCRYPT_OPTS;
  return crypto.scryptSync(String(pass), saltB64, keylen, { N, r, p }).toString('base64');
}

function verifyPassword(user, pass) {
  if (!user || !user.salt || !user.hash || typeof pass !== 'string' || !pass) return false;
  let a, b;
  try {
    a = Buffer.from(hashPassword(pass, user.salt), 'base64');
    b = Buffer.from(user.hash, 'base64');
  } catch {
    return false;
  }
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function storeUnavailable() {
  const e = new Error('users.json ausente ou inválido');
  e.code = 'store_unavailable';
  return e;
}

function localFindUser(email) {
  const store = localReadStore();
  if (!store) throw storeUnavailable();
  const e = normEmail(email);
  return store.users.find((u) => normEmail(u.email) === e && ROLES.has(u.role)) || null;
}

function localListUsers() {
  const store = localReadStore();
  if (!store) return [];
  return store.users
    .filter((u) => ROLES.has(u.role))
    .map((u) => ({ email: u.email, role: u.role }));
}

function validateNewUser(email, role, pass) {
  const e = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error(`e-mail inválido: ${email}`);
  if (!ROLES.has(role)) throw new Error(`papel desconhecido: ${role} (válidos: founder, cofounder)`);
  if (typeof pass !== 'string' || pass.length < 8) throw new Error(`senha muito curta (mín. 8): ${e}`);
  return e;
}

function localAddUser(email, role, pass, opts) {
  const e = validateNewUser(email, role, pass);
  const store = localReadStore() || { version: 1, users: [] };
  if (store.users.some((u) => normEmail(u.email) === e)) {
    if (!(opts && opts.force)) throw new Error(`usuário já existe (use --force): ${e}`);
    store.users = store.users.filter((u) => normEmail(u.email) !== e);
  }
  const salt = crypto.randomBytes(16).toString('base64');
  store.users.push({
    email: e,
    role,
    algo: 'scrypt',
    salt,
    hash: hashPassword(pass, salt),
    created_at: new Date().toISOString(),
  });
  writeStore(store);
  return { email: e, role };
}

/* ---------- supabase (PostgREST) ---------- */
async function supabaseReadStore() {
  const users = await sbFetch('users?select=email,role,salt,hash,algo,created_at');
  return { version: 1, users: users || [] };
}

async function supabaseFindUser(email) {
  const e = normEmail(email);
  const rows = await sbFetch(`users?email=eq.${encodeURIComponent(e)}&select=*`);
  const u = rows && rows[0];
  if (!u || !ROLES.has(u.role)) return null;
  return u;
}

async function supabaseListUsers() {
  const rows = await sbFetch('users?select=email,role');
  return (rows || []).filter((u) => ROLES.has(u.role)).map((u) => ({ email: u.email, role: u.role }));
}

async function supabaseAddUser(email, role, pass, opts) {
  const e = validateNewUser(email, role, pass);
  const existente = await supabaseFindUser(e);
  if (existente && !(opts && opts.force)) throw new Error(`usuário já existe (use --force): ${e}`);
  const salt = crypto.randomBytes(16).toString('base64');
  const row = { email: e, role, algo: 'scrypt', salt, hash: hashPassword(pass, salt), created_at: new Date().toISOString() };
  if (existente) {
    await sbFetch('users?on_conflict=email', { method: 'POST', body: [row], headers: { Prefer: 'resolution=merge-duplicates' } });
  } else {
    await sbFetch('users', { method: 'POST', body: [row] });
  }
  return { email: e, role };
}

/* ---------- dispatcher ---------- */
function readStore() { return sbEnabled() ? supabaseReadStore() : localReadStore(); }
function findUser(email) { return sbEnabled() ? supabaseFindUser(email) : localFindUser(email); }
function listUsers() { return sbEnabled() ? supabaseListUsers() : localListUsers(); }
function addUser(email, role, pass, opts) { return sbEnabled() ? supabaseAddUser(email, role, pass, opts) : localAddUser(email, role, pass, opts); }

module.exports = { ROLES, usersFile, normEmail, readStore, writeStore, hashPassword, verifyPassword, findUser, listUsers, addUser };
