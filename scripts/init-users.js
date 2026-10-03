/* Seed de usuários — recebe trios email:senha:role; nunca imprime senhas;
   destino: Supabase (se SUPABASE_URL/SECRET setados) ou auth/users.json */
require('dotenv').config();
const { addUser, usersFile } = require('../src/utils/user-store');
const { sbEnabled } = require('../src/utils/sb');

const args = process.argv.slice(2);
const force = args.includes('--force');
const pairs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--force') continue;
  if (args[i] === '--user' && args[i + 1]) { pairs.push(args[++i]); continue; }
  if (!args[i].startsWith('-')) pairs.push(args[i]);
}
for (const p of (process.env.SEED_USERS || '').split('|').filter(Boolean)) pairs.push(p);

if (!pairs.length) {
  console.error('Uso: node scripts/init-users.js --user email:senha:role [--force]');
  console.error('     SEED_USERS="email:senha:role|..." node scripts/init-users.js');
  process.exit(1);
}

(async () => {
  for (const pair of pairs) {
    const m = pair.match(/^([^:\s]+@[^:\s]+):([^:\s]+):([a-z]+)$/);
    if (!m) { console.error('Formato inválido (email:senha:role): entrada sem senha exibida'); process.exit(1); }
    const [, email, pass, role] = m;
    try {
      const u = await addUser(email, role, pass, { force });
      console.log(`ok: ${u.email} (${u.role}) — hash scrypt gravado em ${sbEnabled() ? 'Supabase' : usersFile()}`);
    } catch (e) {
      console.error('erro:', e.message);
      process.exitCode = 1;
    }
  }
  console.log(sbEnabled() ? 'Pronto: Supabase' : `Pronto: ${usersFile()}`);
})();
