/* Renomeia o e-mail de um usuário no store ativo (users.json local ou Supabase).
   Uso: node scripts/rename-user.js <old> <new> [--apply]  — sem --apply é dry-run. */
require('dotenv').config();
async function main() {
  const apply = process.argv.includes('--apply');
  const [from, to] = process.argv.slice(2).filter((a) => a !== '--apply');
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!from || !to || !EMAIL_RE.test(from) || !EMAIL_RE.test(to)) {
    console.error('uso: node scripts/rename-user.js <old> <new> [--apply]');
    process.exit(1);
  }
  const store = require('../src/utils/user-store');
  try {
    if (!apply) {
      const [src, dst] = [await store.findUser(from), await store.findUser(to)];
      if (!src && dst) console.log(`Já aplicado: ${to} já existe — nada a fazer.`);
      else if (!src) console.log(`Origem ${from} não encontrada no store ativo.`);
      else if (dst) console.log(`Destino ${to} já existe — renomear falharia (email_taken).`);
      else console.log(`Dry-run: renomearia ${from} -> ${to} (use --apply para gravar).`);
      return;
    }
    const r = await store.renameEmail(from, to);
    if (r.already) console.log(`Nada a fazer: ${r.to} já existia.`);
    else if (r.changed) console.log(`Renomeado: ${r.from} -> ${r.to}`);
    else console.log(`Sem mudanças: ${r.from} -> ${r.to}`);
    if (r.changed && r.sessions_cleared === false) {
      console.warn(`ATENÇÃO: sessões de ${r.from} não puderam ser invalidadas — tokens antigos continuam válidos.`);
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`Erro: ${e && e.code ? e.code + ' — ' : ''}${(e && e.message) || e}`);
    process.exit(1);
  }
}
main();
