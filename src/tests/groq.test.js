// Testes do cliente Groq (mensagens/contexto — sem chamar a API)
const { test } = require('node:test');
const assert = require('node:assert');

const { buildMessages, formatContext, askGroq, GROQ_URL, MODEL } = require('../../scripts/groq');

const PAYLOAD = {
  stats: { total: 1345, comSite: 192, semSite: 1153, comPhone: 240, alta: 578, qualif: 168 },
  areas: [{ label: 'Trabalhista', value: 81 }, { label: 'Criminal', value: 99 }],
  top: [{ name: 'Dra.Daniela Galvão', score: 99 }, { name: 'Douglas Nogueira', score: 99 }],
};

test('formatContext resume stats, áreas e top leads', () => {
  const c = formatContext(PAYLOAD);
  assert.match(c, /Total: 1345/);
  assert.match(c, /sem site: 1153/);
  assert.match(c, /Trabalhista=81/);
  assert.match(c, /Dra\.Daniela Galvão \(99\)/);
  assert.match(formatContext({}), /Total: 0/);
});

test('buildMessages monta system + contexto + histórico + pergunta', () => {
  const msgs = buildMessages({
    question: 'quantos trabalhistas temos?',
    context: 'Total: 1345',
    history: [{ role: 'user', text: 'oi' }, { role: 'assistant', text: 'Olá!' }],
  });
  assert.strictEqual(msgs[0].role, 'system');
  assert.match(msgs[0].content, /Virgo Scout/);
  assert.match(msgs[1].content, /Total: 1345/);
  assert.deepStrictEqual(msgs.slice(2, 4), [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'Olá!' },
  ]);
  assert.deepStrictEqual(msgs[msgs.length - 1], { role: 'user', content: 'quantos trabalhistas temos?' });
});

test('buildMessages limita histórico a 6 e corta textos longos', () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x'.repeat(2000) }));
  const msgs = buildMessages({ question: 'q', context: 'c', history });
  // system(2) + 6 history + pergunta
  assert.strictEqual(msgs.length, 9);
  assert.ok(msgs[5].content.length <= 500);
  assert.ok(msgs[msgs.length - 1].content.length <= 1000);
  assert.ok(msgs.slice(2, 8).every((m) => m.role === 'user' || m.role === 'assistant'));
});

test('askGroq sem chave lança no_key (fail-closed)', async () => {
  const prev = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  await assert.rejects(() => askGroq({ question: 'oi', context: 'c' }), (e) => e.code === 'no_key');
  if (prev !== undefined) process.env.GROQ_API_KEY = prev;
});

test('constantes de API', () => {
  assert.match(GROQ_URL, /^https:\/\/api\.groq\.com/);
  assert.match(MODEL, /\//); // formato org/modelo
});
