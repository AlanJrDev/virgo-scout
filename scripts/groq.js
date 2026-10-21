/* Cliente Groq — IA gratuita do painel (chave só no servidor) */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b'; // modelos do Groq giram; listar em GET /openai/v1/models
const TIMEOUT_MS = 12000;

const SYSTEM = [
  'Você é o analista de leads do Virgo Scout, um painel que rastreia empresas do Google Maps (advogados no Distrito Federal).',
  'Responda como analista de pré-venda da Virgo Tech (venda de sites/LPs). Priorize leads com telefone, sem site próprio e boa reputação.',
  'Responda em português do Brasil, em no máximo 3 frases, direto ao ponto e com os números exatos dos dados fornecidos, em texto puro (sem markdown, asteriscos nem HTML).',
  'Só use os dados do painel; se a resposta não estiver neles, diga que não encontrou na base atual.',
  'Não invente empresas, telefones ou estatísticas.',
  'Use SOMENTE os números e listas presentes em "Dados atuais do painel". Se a informação pedida não estiver no contexto, responda que não está disponível — nunca estime, some ou invente números.',
].join(' ');

function formatContext(p) {
  const s = (p && p.stats) || {};
  const comZap = s.comZap != null ? s.comZap : (s.zapReal || 0);
  const nichosSrc = (p && p.nichos && p.nichos.length ? p.nichos : (p && p.areas) || []);
  const nichos = nichosSrc.map((a) => `${a.label}=${a.value}`).join(', ') || '-';
  const areas = ((p && p.areas) || []).map((a) => `${a.label}=${a.value}`).join(', ') || '—';
  const top = ((p && p.top) || []).slice(0, 5).map((l) => `${l.name} (${l.score})`).join(' · ') || '—';
  const zapMaps = s.comZapMaps || 0;
  const zapSite = s.comZapSiteOficial || 0;
  const zapIg = s.comZapIg || 0;
  const zapOutros = comZap - zapMaps - zapSite - zapIg;
  const zapFontes = zapOutros === 0 ? ` (maps: ${zapMaps} · site: ${zapSite} · ig: ${zapIg})` : '';
  return [
    `Total: ${s.total || 0} empresas · com site: ${s.comSite || 0} · sem site: ${s.semSite || 0} · com telefone: ${s.comPhone || 0}`,
    `WhatsApp: ${comZap} com zap declarado${zapFontes} · ${s.comZapCelular || 0} por celular · ${s.comZapTotal || comZap} contatáveis no total`,
    `Alta oportunidade: ${s.alta || 0} | qualificados: ${s.qualif || 0} · E-mail direto: ${s.comEmail || 0} · Instagram: ${s.comInstagram || 0} · hint no site: ${s.comZapSite || 0}`,
    `Nichos: ${nichos}`,
    `Áreas de atuação: ${areas}`,
    `Perfis não reclamados (Maps): ${s.naoReclamados || 0} · Negócios de 5+ anos: ${s.desdeAntigo || 0}`,
    `Top leads: ${top}`,
  ].join('\n');
}

function buildMessages({ question, context, history = [] }) {
  const hist = history
    .slice(-6)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.text)
    .map((m) => ({ role: m.role, content: String(m.text).slice(0, 500) }));
  return [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: `Dados atuais do painel:\n${context}` },
    ...hist,
    { role: 'user', content: String(question || '').slice(0, 1000) },
  ];
}

async function askGroq({ question, context, history = [] }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) { const e = new Error('GROQ_API_KEY não definida'); e.code = 'no_key'; throw e; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, messages: buildMessages({ question, context, history }), temperature: 0.3, max_tokens: 400 }),
      signal: ctrl.signal,
    });
    if (!r.ok) { const e = new Error(`groq http ${r.status}`); e.code = 'http'; e.status = r.status; throw e; }
    const j = await r.json();
    const answer = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!answer || !answer.trim()) { const e = new Error('resposta vazia'); e.code = 'empty'; throw e; }
    return { answer: answer.trim() };
  } finally {
    clearTimeout(timer);
  }
}

/* NLP da modal "Nova captura": nicho (categoria) + lugar (RA/cidade do DF ou DF inteiro)
   Resposta: JSON puro {nicho, lugar} — validação do lado do servidor. */
const INTERPRET_SYSTEM = [
  'Você converte pedidos de captura de leads em JSON estrito.',
  'O usuário descreve em português o que capturar. Responda SOMENTE com JSON: {"nicho": string, "lugar": string}.',
  'nicho: o tipo de negócio/termo de busca (ex.: "tapeçaria", "advogado", "consultório odontológico", "arquiteto").',
  'lugar: a cidade/região que citou (ex.: "Águas Claras", "Lago Sul", "Taguatinga") ou "DF"/"Distrito Federal"/"Brasília" se pediu todo o estado. Escreva o nome com os acentos corretos do português.',
  'Se o prompt não citar nenhum nicho comercial nem lugar, responda {"nicho": "", "lugar": ""}.',
  'Nunca adicione chaves além de nicho e lugar.',
].join(' ');

/* Retry do flaky json_object no gpt-oss-120b: 1ª tentativa COM response_format
   {type:'json_object'} (como sempre); 2ª tentativa SEM response_format e com o
   prompt reforçado a exigir JSON — só quando a 1ª falhou com http 400 ou JSON.parse
   do content. Se mesmo a 2ª falhar, extrai nicho/lugar por regex no texto cru;
   nada disso resolve → {nicho:'', lugar:''} (serve-web faz o match local do prompt
   ou cai no low_signal). Erros fora do cenário flaky (rede/5xx/timeout) seguem
   rethrow → groq_error honesto. */
const INTERPRET_RETRY_SUFFIX = '\nResponda SOMENTE JSON {"nicho":"...","lugar":"..."}.';
const RE_NICHO = /(?:nicho)\s*[:=]\s*["“]([^"”]+)["”]/i;
const RE_LUGAR = /(?:lugar)\s*[:=]\s*["“]([^"”]+)["”]/i;

async function interpretCapture(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) { const e = new Error('GROQ_API_KEY não definida'); e.code = 'no_key'; throw e; }
  const user = String(prompt || '').slice(0, 500);
  let raw = ''; // conteúdo cru da última resposta com corpo (base do fallback por regex)
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const body = {
        model: MODEL,
        messages: [
          { role: 'system', content: INTERPRET_SYSTEM },
          { role: 'user', content: attempt === 0 ? user : user + INTERPRET_RETRY_SUFFIX },
        ],
        temperature: 0,
        max_tokens: 200,
      };
      if (attempt === 0) body.response_format = { type: 'json_object' };
      const r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!r.ok) { const e = new Error(`groq http ${r.status}`); e.code = 'http'; e.status = r.status; throw e; }
      const j = await r.json();
      const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (text) raw = String(text);
      const parsed = JSON.parse(text || '{}');
      return { nicho: String(parsed.nicho || '').trim(), lugar: String(parsed.lugar || '').trim() };
    } catch (e) {
      const retryable = (e && e.code === 'http' && e.status === 400) || (e instanceof SyntaxError);
      if (!retryable) throw e; // fora do flaky: comportamento atual (503 groq_error)
      if (attempt === 1) break; // 2ª tentativa também falhou → fallback por regex
    } finally {
      clearTimeout(timer);
    }
  }
  const mN = RE_NICHO.exec(raw);
  const mL = RE_LUGAR.exec(raw);
  if (mN || mL) return { nicho: ((mN && mN[1]) || '').trim(), lugar: ((mL && mL[1]) || '').trim() };
  return { nicho: '', lugar: '' };
}

module.exports = { GROQ_URL, MODEL, SYSTEM, formatContext, buildMessages, askGroq, interpretCapture };

