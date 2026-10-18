// Testes do cliente Groq (mensagens/contexto — sem chamar a API)
const { test } = require('node:test');
const assert = require('node:assert');

const { buildMessages, formatContext, askGroq, interpretCapture, GROQ_URL, MODEL } = require('../../scripts/groq');

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

test('formatContext inclui os novos sinais quando existem na base', () => {
  const c = formatContext({ stats: { total: 10, comEmail: 7, comInstagram: 4, comZapSite: 2, naoReclamados: 5, desdeAntigo: 3 } });
  assert.match(c, /E-mail direto: 7/);
  assert.match(c, /Instagram: 4/);
  assert.match(c, /WhatsApp no site: 2/);
  assert.match(c, /Perfis não reclamados \(Maps\): 5/);
  assert.match(c, /Negócios de 5\+ anos: 3/);
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

/* ===== interpretCapture: retry do flaky 400 json_validate_failed (gpt-oss-120b) ===== */

function withFetchMock(fn) {
  const prevKey = process.env.GROQ_API_KEY;
  const prevFetch = global.fetch;
  process.env.GROQ_API_KEY = 'test-key';
  return fn().finally(() => {
    global.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevKey;
  });
}

test('interpretCapture: 400 flaky → retry sem response_format e prompt reforçado', async () => {
  await withFetchMock(async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (calls.length === 1) {
        assert.deepStrictEqual(body.response_format, { type: 'json_object' }, '1ª tentativa mantém response_format');
        return { ok: false, status: 400, json: async () => ({ error: 'json_validate_failed' }) };
      }
      assert.strictEqual(body.response_format, undefined, 'retry sai SEM response_format');
      assert.match(body.messages[body.messages.length - 1].content, /Responda SOMENTE JSON \{"nicho":"\.\.\.","lugar":"\.\.\."\}\./, 'prompt reforçado no retry');
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"nicho":"topografia","lugar":"Águas Claras"}' } }] }) };
    };
    const r = await interpretCapture('capturar topografia em águas claras');
    assert.deepStrictEqual(r, { nicho: 'topografia', lugar: 'Águas Claras' });
    assert.strictEqual(calls.length, 2, 'exatamente 2 tentativas');
  });
});

test('interpretCapture: retry falha de novo → extrai nicho/lugar por regex no texto cru', async () => {
  await withFetchMock(async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (calls.length === 1) return { ok: false, status: 400, json: async () => ({}) };
      assert.strictEqual(body.response_format, undefined);
      // 200 com conteúdo NÃO-JSON (modelo ignorou a ordem): parse quebra → regex
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Aqui está: nicho: "tapeçaria", lugar: "Gama"' } }] }) };
    };
    const r = await interpretCapture('preciso de uma tapeçaria no gama');
    assert.deepStrictEqual(r, { nicho: 'tapeçaria', lugar: 'Gama' });
    assert.strictEqual(calls.length, 2);
  });
});

test('interpretCapture: 2× 400 sem texto → {nicho:"",lugar:""} (serve-web faz o match local)', async () => {
  await withFetchMock(async () => {
    const calls = [];
    global.fetch = async () => { calls.push(1); return { ok: false, status: 400, json: async () => ({}) }; };
    const r = await interpretCapture('advogados no lago sul');
    assert.deepStrictEqual(r, { nicho: '', lugar: '' });
    assert.strictEqual(calls.length, 2, 'retry também tentou');
  });
});

test('interpretCapture: erro fora do cenário flaky (500) rethrow — groq_error segue honesto', async () => {
  await withFetchMock(async () => {
    const calls = [];
    global.fetch = async () => { calls.push(1); return { ok: false, status: 500, json: async () => ({}) }; };
    await assert.rejects(() => interpretCapture('oi'), (e) => e.code === 'http' && e.status === 500);
    assert.strictEqual(calls.length, 1, '500 não é retryável');
  });
});
