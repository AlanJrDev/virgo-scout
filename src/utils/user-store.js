/* Store de usuários locais — auth/users.json + scrypt (fonte p/ login e futuro Supabase) */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROLES = new Set(['founder', 'cofounder']);
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, keylen: 64 };

function usersFile() {
  return process.env.USERS_FILE || path.join(__dirname, '..', '..', 'auth', 'users.json');
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function readStore() {
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

function findUser(email) {
  const store = readStore();
  if (!store) return null;
  const e = normEmail(email);
  return store.users.find((u) => normEmail(u.email) === e && ROLES.has(u.role)) || null;
}

function listUsers() {
  const store = readStore();
  if (!store) return [];
  return store.users
    .filter((u) => ROLES.has(u.role))
    .map((u) => ({ email: u.email, role: u.role }));
}

function addUser(email, role, pass, opts) {
  const e = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error(`e-mail inválido: ${email}`);
  if (!ROLES.has(role)) throw new Error(`papel desconhecido: ${role} (válidos: founder, cofounder)`);
  if (typeof pass !== 'string' || pass.length < 8) throw new Error(`senha muito curta (mín. 8): ${e}`);
  const store = readStore() || { version: 1, users: [] };
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

module.exports = { ROLES, usersFile, normEmail, readStore, writeStore, hashPassword, verifyPassword, findUser, listUsers, addUser };
