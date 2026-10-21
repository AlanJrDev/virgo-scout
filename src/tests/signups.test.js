// Testes do fluxo de cadastro público (validação + store de signups + revisão)
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-signups-'));
process.env.USERS_FILE = path.join(TMP, 'users.json');
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

const store = require('../../src/utils/user-store');
const signups = require('../../src/utils/signups');
const { SbError } = require('../../src/utils/sb');
const { hashNewPassword, validateSignup, listSignups, createSignup, reviewSignup } = signups;

const UUID = '5c9d1f2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f';
const base = { name: 'Maria Silva', email: 'maria@x.com', phone: '(61) 99999-9999', cpf: '52998224725', pass: 'senhaFort32' };

function fakeSb(handler) {
  const sb = async (p, o = {}) => {
    sb.calls.push({ path: p, opts: o });
    return handler(p, o, sb.calls);
  };
  sb.calls = [];
  return sb;
}

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('validateSignup aceita entrada correta e normaliza', () => {
  const v = validateSignup(base);
  assert.ok(v.ok);
  assert.deepStrictEqual(v.value, { full_name: 'Maria Silva', email: 'maria@x.com', phone: '61999999999', cpf: '52998224725' });
});

test('validateSignup devolve o código certo para cada campo', () => {
  assert.strictEqual(validateSignup({ ...base, name: 'Ana' }).code, 'invalid_name');
  assert.strictEqual(validateSignup({ ...base, name: 'Ana S' }).code, 'invalid_name');
  assert.strictEqual(validateSignup({ ...base, name: 'Ana S' + ' K'.repeat(60) }).code, 'invalid_name'); // >120
  assert.strictEqual(validateSignup({ ...base, email: 'maria@' }).code, 'invalid_email');
  assert.strictEqual(validateSignup({ ...base, email: '' }).code, 'invalid_email');
  assert.strictEqual(validateSignup({ ...base, email: 'm@' + 'x'.repeat(254) + '.com' }).code, 'invalid_email'); // >254
  assert.strictEqual(validateSignup({ ...base, phone: '99999999' }).code, 'invalid_phone');
  assert.strictEqual(validateSignup({ ...base, phone: '10123456789' }).code, 'invalid_phone');
  assert.strictEqual(validateSignup({ ...base, cpf: '52998224724' }).code, 'invalid_cpf');
  assert.strictEqual(validateSignup({ ...base, cpf: '11111111111' }).code, 'invalid_cpf');
  assert.strictEqual(validateSignup({ ...base, pass: 'curta12' }).code, 'weak_pass');
  assert.strictEqual(validateSignup({ ...base, pass: 'x'.repeat(129) }).code, 'weak_pass');
  assert.strictEqual(validateSignup({}).ok, false);
});

test('createSignup insere pending e devolve id (representation)', async () => {
  let row = null;
  const sb = fakeSb((p, o) => {
    if (p.startsWith('users?')) return [];
    if (p.startsWith('signups?cpf=eq') || p.startsWith('signups?email=eq')) return [];
    row = o.body[0];
    if (o.method === 'POST') return [{ id: UUID }];
    return null;
  });
  const r = await createSignup(base, { sbFetch: sb });
  assert.strictEqual(r.id, UUID);
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(row.algo, 'scrypt');
  assert.ok(row.salt && row.hash);
  assert.ok(!JSON.stringify(row).includes('senhaFort32'));
});

test('createSignup bloqueia duplicidades com code duplicate', async () => {
  const dupUser = fakeSb((p) => (p.startsWith('users?email') ? [{ email: 'maria@x.com' }] : []));
  await assert.rejects(() => createSignup(base, { sbFetch: dupUser }), (e) => e.code === 'duplicate' && e.status === 409);
  const dupSignup = fakeSb((p) => (p.startsWith('users?email') || p.startsWith('signups?email=eq') ? [{ id: UUID }] : []));
  await assert.rejects(() => createSignup(base, { sbFetch: dupSignup }), (e) => e.code === 'duplicate');
  const dupCpf = fakeSb((p) => (p.startsWith('users?email') ? [] : p.startsWith('signups?cpf=eq') ? [{ id: UUID }] : []));
  await assert.rejects(() => createSignup(base, { sbFetch: dupCpf }), (e) => e.code === 'duplicate');
});

test('createSignup devolve erros de validação com code', async () => {
  const sb = fakeSb(() => []);
  await assert.rejects(() => createSignup({ ...base, cpf: '123' }, { sbFetch: sb }), (e) => e.code === 'invalid_cpf');
  await assert.rejects(() => createSignup({ name: 'Fulano de Tal' }, { sbFetch: sb }), (e) => e.status === 400 && e.code === 'invalid_email');
});

test('createSignup: unique violation na corrida de insert vira duplicate', async () => {
  const sb = fakeSb((p, o) => {
    if (p.startsWith('signups') && o.method === 'POST') throw new SbError('sb_409 :: duplicate key value violates unique constraint "signups_email_key"', 409);
    return [];
  });
  await assert.rejects(() => createSignup(base, { sbFetch: sb }), (e) => e.code === 'duplicate' && e.status === 409);
});

test('createSignup: e-mail de signup filtrado por pending/approved (rejected não bloqueia)', async () => {
  let emailQ = '', cpfQ = '';
  const sb = fakeSb((p, o) => {
    if (p.startsWith('users?')) return [];
    if (p.includes('signups?email=eq')) { emailQ = p; return []; }
    if (p.includes('signups?cpf=eq')) { cpfQ = p; return []; }
    if (o.method === 'POST') return [{ id: UUID }];
    return null;
  });
  await createSignup(base, { sbFetch: sb });
  assert.ok(emailQ.includes('&status=in.(pending,approved)'), 'email check com filtro de status');
  assert.ok(cpfQ.includes('&status=in.(pending,approved)'), 'cpf check com filtro de status');
});

test('sem Supabase configurado: store_unavailable', async () => {
  await assert.rejects(() => createSignup(base), (e) => e.code === 'store_unavailable' && e.status === 503);
  await assert.rejects(() => listSignups(), (e) => e.code === 'store_unavailable');
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'approve' }), (e) => e.code === 'store_unavailable');
});

test('listSignups mascara CPF e nunca devolve salt/hash/cpf cru', async () => {
  const sb = fakeSb(() => [{ id: UUID, full_name: 'Maria Silva', email: 'maria@x.com', phone: '61999999999', cpf: '52998224725', salt: 'zzz', hash: 'hhh', status: 'pending', created_at: '2026-01-01T00:00:00Z' }]);
  const list = await listSignups({ sbFetch: sb });
  const items = list.items;
  assert.ok(items[0].cpf_masked === '***.***.***-25');
  assert.strictEqual(items[0].cpf, undefined);
  assert.strictEqual(items[0].salt, undefined);
  assert.strictEqual(items[0].hash, undefined);
  assert.strictEqual(list.truncated, false);
  assert.ok(sb.calls[0].path.includes('order=created_at.desc&limit=200'));
});

test('reviewSignup recusa ação inválida e id malformado', async () => {
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'arquivar' }, { sbFetch: fakeSb(() => null) }), (e) => e.code === 'invalid_action' && e.status === 400);
  await assert.rejects(() => reviewSignup({ id: 'zzz', action: 'approve' }, { sbFetch: fakeSb(() => null) }), (e) => e.code === 'not_found');
  await assert.rejects(() => reviewSignup({ id: 'aaaaaaaa-cccccc-dddd-eeee-ffffffffffff', action: 'approve' }, { sbFetch: fakeSb(() => null) }), (e) => e.code === 'not_found'); // não-canônico
});

test('reviewSignup: 404 inexistente; already_reviewed antes de tocar no store', async () => {
  const nf = fakeSb(() => []);
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'reject' }, { sbFetch: nf }), (e) => e.code === 'not_found' && e.status === 404);
  let touched = 0;
  const rejectedRow = { id: UUID, email: 'maria@x.com', status: 'rejected', salt: 'a', hash: 'b', algo: 'scrypt' };
  const stubStore = { addUserWithHash: async () => { touched++; }, findUser: async () => null };
  const sb = fakeSb((p) => {
    if (p.includes('&select=*')) return [rejectedRow];
    if (p.includes('&status=eq.pending')) return []; // PATCH condicional: status não é pending
    return null;
  });
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sb, store: stubStore }), (e) => e.code === 'already_reviewed' && e.status === 409);
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'reject' }, { sbFetch: sb, store: stubStore }), (e) => e.code === 'already_reviewed');
  assert.strictEqual(touched, 0);
});

test('reviewSignup reject: PATCH condicional (pending) com auditoria', async () => {
  const sb = fakeSb((p) => {
    if (p.includes('&select=*')) return [{ id: UUID, email: 'maria@x.com', status: 'pending', salt: 'a', hash: 'b', algo: 'scrypt' }];
    if (p.includes('&status=eq.pending')) return [{ id: UUID, status: 'rejected' }];
    return null;
  });
  const r = await reviewSignup({ id: UUID, action: 'reject', reviewer: 'landevbrasil.ia@gmail.com' }, { sbFetch: sb });
  assert.strictEqual(r.status, 'rejected');
  const patch = sb.calls.find((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patch.opts.body.status, 'rejected');
  assert.strictEqual(patch.opts.body.reviewed_by, 'landevbrasil.ia@gmail.com');
  assert.ok(patch.opts.body.reviewed_at);
  assert.ok(patch.path.includes('&status=eq.pending'), 'PATCH só grava se ainda pending');
});

test('reviewSignup approve: cria usuário local + PATCH approved (senha verificável, nunca em claro)', async () => {
  const cred = hashNewPassword('senhaFort32');
  const row = { id: UUID, full_name: 'Maria Silva', email: 'maria.aprov2@x.com', phone: '61999999999', cpf: '52998224725', ...cred, status: 'pending' };
  const sb = fakeSb((p) => {
    if (p.includes('&select=*')) return [row];
    if (p.includes('&status=eq.pending')) return [{ id: UUID, status: 'approved' }];
    return null;
  });
  const r = await reviewSignup({ id: UUID, action: 'approve', reviewer: 'revisor@x.com' }, { sbFetch: sb, store });
  assert.strictEqual(r.status, 'approved');
  const u = store.findUser('maria.aprov2@x.com');
  assert.ok(u && u.role === 'cofounder');
  assert.strictEqual(store.verifyPassword(u, 'senhaFort32'), true);
  assert.strictEqual(store.verifyPassword(u, 'errada'), false);
  const raw = fs.readFileSync(process.env.USERS_FILE, 'utf8');
  assert.ok(!raw.includes('senhaFort32'));
  const patch = sb.calls.find((c) => c.opts.method === 'PATCH');
  assert.strictEqual(patch.opts.body.status, 'approved');
  assert.strictEqual(patch.opts.body.reviewed_by, 'revisor@x.com');
});

test('reviewSignup approve idempotente: user_exists com MESMAS credenciais → aprovado', async () => {
  const cred = hashNewPassword('senhaFort32');
  const row = { id: UUID, full_name: 'Maria Idem', email: 'maria.idem@x.com', ...cred, status: 'pending' };
  let addCalls = 0;
  const stubStore = {
    addUserWithHash: async () => { addCalls++; const e = new Error('usuário já existe'); e.code = 'user_exists'; throw e; },
    findUser: async () => ({ email: row.email, role: 'cofounder', algo: cred.algo, salt: cred.salt, hash: cred.hash }),
  };
  const sb = fakeSb((p) => {
    if (p.includes('&select=*')) return [row];
    if (p.includes('&status=eq.pending')) return [{ id: UUID, status: 'approved' }];
    return null;
  });
  const r = await reviewSignup({ id: UUID, action: 'approve', reviewer: 'revisor@x.com' }, { sbFetch: sb, store: stubStore });
  assert.strictEqual(r.status, 'approved'); // retry idempotente da tentativa anterior
  assert.strictEqual(addCalls, 1);
});

test('reviewSignup approve: user_exists com hash DIFERENTE → reverte p/ pending + 409', async () => {
  store.addUser('maria.dup@x.com', 'cofounder', 'senhaFort32');
  const cred = hashNewPassword('outraSenha12');
  const row = { id: UUID, full_name: 'Maria Dup', email: 'maria.dup@x.com', ...cred, status: 'pending' };
  const sb = fakeSb((p, o) => {
    if (p.includes('&select=*')) return [row];
    if (p.includes('&status=eq.pending') && o.method === 'PATCH') return [row]; // reserva vence
    if (p.includes('&status=eq.approved')) return []; // revert condicional
    return null;
  });
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sb, store }), (e) => e.code === 'user_exists' && e.status === 409);
  const revert = sb.calls.filter((c) => c.opts.method === 'PATCH').find((c) => c.opts.body.status === 'pending');
  assert.ok(revert, 'reserva approved é revertida p/ pending');
  const u = store.findUser('maria.dup@x.com');
  assert.strictEqual(store.verifyPassword(u, 'senhaFort32'), true);
});

test('reviewSignup approve: reserva (PATCH) antes de criar usuário — reject concorrente → 409 e usuário NÃO criado', async () => {
  const cred = hashNewPassword('senhaFort32');
  const row = { id: UUID, email: 'maria.cond@x.com', ...cred, status: 'pending' };
  let created = 0;
  const stubStore = { addUserWithHash: async () => { created++; }, findUser: async () => null };
  const sb = fakeSb((p) => {
    if (p.includes('&select=*')) return [row];
    if (p.includes('&status=eq.pending')) return []; // outro revisor rejeitou nesse meio-tempo
    return null;
  });
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sb, store: stubStore }), (e) => e.code === 'already_reviewed' && e.status === 409);
  assert.strictEqual(created, 0); // PATCH de reserva vem antes do store: nada é criado
});

test('reviewSignup approve: reenvio com status approved e MESMO hash → ok (already)', async () => {
  const cred = hashNewPassword('senhaFort32');
  const row = { id: UUID, email: 'maria.rep@x.com', ...cred, status: 'approved' };
  let created = 0;
  const stubStore = { addUserWithHash: async () => { created++; }, findUser: async () => ({ email: row.email, role: 'cofounder', algo: cred.algo, salt: cred.salt, hash: cred.hash }) };
  const sb = fakeSb((p) => (p.includes('&select=*') ? [row] : null));
  const r = await reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sb, store: stubStore });
  assert.strictEqual(r.status, 'approved');
  assert.strictEqual(r.already, true);
  assert.strictEqual(created, 0);
});

test('reviewSignup approve: status approved com hash DIFERENTE → 409 user_exists', async () => {
  const cred = hashNewPassword('senhaFort32');
  const row = { id: UUID, email: 'maria.repdif@x.com', ...cred, status: 'approved' };
  const stubStore = { addUserWithHash: async () => { throw new Error('não devia criar'); }, findUser: async () => ({ email: row.email, role: 'cofounder', algo: 'scrypt', salt: 'zz', hash: 'zzz' }) };
  const sb = fakeSb((p) => (p.includes('&select=*') ? [row] : null));
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sb, store: stubStore }), (e) => e.code === 'user_exists' && e.status === 409);
});

test('reviewSignup approve: falha ao criar usuário → revert approved→pending (condicional) e relança; retry insere', async () => {
  const cred = hashNewPassword('senhaFort32');
  const row = { id: UUID, email: 'maria.boom@x.com', ...cred, status: 'pending' };
  let fails = true;
  const stubStore = { addUserWithHash: async () => { if (fails) throw new Error('boom store'); }, findUser: async () => null };
  const sb = fakeSb((p, o) => {
    if (p.includes('&select=*')) return [row];
    if (p.includes('&status=eq.pending') && o.method === 'PATCH') { row.status = 'approved'; return [row]; }
    if (p.includes('&status=eq.approved')) { row.status = 'pending'; return []; }
    return null;
  });
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sb, store: stubStore }), /boom store/);
  const revert = sb.calls.filter((c) => c.opts.method === 'PATCH').find((c) => c.opts.body.status === 'pending');
  assert.ok(revert, 'revert da reserva');
  assert.ok(revert.path.includes('&status=eq.approved'), 'revert condicional a approved');
  assert.strictEqual(revert.opts.body.reviewed_at, null);
  assert.strictEqual(revert.opts.body.reviewed_by, null);
  fails = false;
  const r = await reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sb, store: stubStore });
  assert.strictEqual(r.status, 'approved'); // retry funciona
});

test('reviewSignup approve: revert falhando não mascara o erro original', async () => {
  const cred = hashNewPassword('senhaFort32');
  const row = { id: UUID, email: 'maria.revb@x.com', ...cred, status: 'pending' };
  const stubStore = { addUserWithHash: async () => { throw new Error('boom store'); }, findUser: async () => null };
  const sb = fakeSb((p, o) => {
    if (p.includes('&select=*')) return [row];
    if (p.includes('&status=eq.pending') && o.method === 'PATCH') { row.status = 'approved'; return [row]; }
    if (p.includes('&status=eq.approved')) throw new Error('sb_down no revert');
    return null;
  });
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sb, store: stubStore }), /boom store/);
});

test('reviewSignup approve: SbError 409 na criação — sem usuário → 409; hash igual → sucesso', async () => {
  const cred = hashNewPassword('senhaFort32');
  const rowA = { id: UUID, email: 'maria.409a@x.com', ...cred, status: 'pending' };
  const sbA = fakeSb((p, o) => {
    if (p.includes('&select=*')) return [rowA];
    if (p.includes('&status=eq.pending') && o.method === 'PATCH') return [rowA];
    if (p.includes('&status=eq.approved')) return [];
    return null;
  });
  const racelike = { addUserWithHash: async () => { throw new SbError('sb_409 :: duplicate key', 409); }, findUser: async () => null };
  await assert.rejects(() => reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sbA, store: racelike }), (e) => e.code === 'user_exists' && e.status === 409);
  // corrida: usuário gravado entre o 409 e o findUser → MESMO hash → sucesso
  const rowB = { id: UUID, email: 'maria.409b@x.com', ...cred, status: 'pending' };
  const rounded = { addUserWithHash: async () => { throw new SbError('sb_409 :: duplicate key', 409); }, findUser: async () => ({ email: rowB.email, role: 'cofounder', algo: cred.algo, salt: cred.salt, hash: cred.hash }) };
  const sbB = fakeSb((p, o) => {
    if (p.includes('&select=*')) return [rowB];
    if (p.includes('&status=eq.pending') && o.method === 'PATCH') return [rowB];
    return null;
  });
  const r = await reviewSignup({ id: UUID, action: 'approve' }, { sbFetch: sbB, store: rounded });
  assert.strictEqual(r.status, 'approved');
});

test('migration 0013: e-mail sem unique de coluna + índice único parcial (reenvio pós-rejected)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0013_signups.sql'), 'utf8');
  assert.ok(!/email\s+text\s+not\s+null\s+unique/.test(sql), 'coluna email não pode ser unique');
  assert.ok(/create\s+unique\s+index\s+if\s+not\s+exists\s+signups_email_active_uidx/.test(sql), 'índice único parcial ausente');
  assert.ok(/where\s+status\s+in\s*\('pending','approved'\)/.test(sql), 'filtro pending/approved ausente');
});
