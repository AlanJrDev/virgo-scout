const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
require('dotenv').config();
const { buildPayload } = require('../src/utils/metrics');
const { attemptLogin, sessionUser } = require('./serve-web-auth');
const { destroySession } = require('../src/utils/session-store');
const { parseCookies, authCookie, clearAuthCookie } = require('../src/utils/cookies');
const { json } = require('../src/utils/http-json');
const { askGroq, formatContext } = require('./groq');

const ROOT = path.join(__dirname, '..', 'web');
const DATA = path.join(__dirname, '..', 'data');
const JOB_FILE = path.join(DATA, 'job.json');
const JOB_LOG = path.join(DATA, 'capture-live.log');
const JOB_ERR = path.join(DATA, 'capture-live.err.log');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// arquivos que a tela de login precisa sem sessão
const PUBLIC_LOGIN = new Set(['/login.css', '/login.js', '/styles.css', '/vendor/gsap.min.js', '/assets/LOGO.png']);

function newestLeadsFile() {
  const preferred = [process.env.BASENAME ? `${process.env.BASENAME}.v2.json` : null, 'advogados-df-max.v2.json', 'advogados-df-max.json'].filter(Boolean);
  for (const f of preferred) {
    const p = path.join(DATA, f);
    if (fs.existsSync(p)) return p;
  }
  const any = fs
    .readdirSync(DATA)
    .filter((f) => f.endsWith('.json') && !f.includes('validacao') && !f.includes('job'))
    .map((f) => ({ f, m: fs.statSync(path.join(DATA, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return any.length ? path.join(DATA, any[0].f) : null;
}

function readLeads() {
  const file = newestLeadsFile();
  if (!file) return { leads: [], file: null, mtime: 0, fallbackTs: Date.now() };
  // data da captura real = mtime do JSON bruto (o .v2 é gerado depois)
  const raw = file.replace(/\.v2\.json$/, '.json');
  const rawPath = fs.existsSync(raw) ? raw : file;
  return {
    leads: JSON.parse(fs.readFileSync(file, 'utf8')),
    file: path.basename(file),
    mtime: fs.statSync(file).mtimeMs,
    fallbackTs: fs.statSync(rawPath).mtimeMs,
  };
}

function readJob() {
  try {
    return JSON.parse(fs.readFileSync(JOB_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function jobStatus() {
  const job = readJob();
  if (!job) return { status: 'idle' };
  const alive = pidAlive(job.pid);
  if (alive) {
    let done = 0;
    let current = '';
    try {
      const lines = fs.readFileSync(JOB_LOG, 'utf8').split(/\r?\n/);
      for (const l of lines) {
        if (l.includes('[scraper] buscando:')) {
          done++;
          current = l.split('[scraper] buscando:')[1].trim();
        }
      }
    } catch {}
    return { status: 'running', pid: job.pid, started_at: job.started_at, total: job.queries, done, current };
  }
  let summary = null;
  try {
    const lines = fs.readFileSync(JOB_LOG, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const l of lines) {
      if (l.includes('[capture] RAW=')) summary = l;
    }
  } catch {}
  return { status: summary ? 'done' : 'failed', started_at: job.started_at, finished_at: job.finished_at || null, summary };
}

function startCapture() {
  const st = jobStatus();
  if (st.status === 'running') return { code: 409, body: { error: 'already_running', job: st } };
  const { QUERIES } = require('./capture-advogados-df');
  const effective = process.env.QUERIES ? process.env.QUERIES.split('|').filter(Boolean) : QUERIES;
  const out = fs.openSync(JOB_LOG, 'w');
  const err = fs.openSync(JOB_ERR, 'w');
  const child = spawn(process.execPath, [path.join(__dirname, 'capture-advogados-df.js')], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: path.join(__dirname, '..'),
    env: process.env,
  });
  const job = { pid: child.pid, started_at: new Date().toISOString(), queries: effective.length, log: path.basename(JOB_LOG) };
  fs.writeFileSync(JOB_FILE, JSON.stringify(job, null, 2));
  child.unref();
  return { code: 202, body: { ok: true, job: { ...job, status: 'running', done: 0, total: job.queries } } };
}

let payloadCache = { mtime: 0, payload: null };

function livePayload() {
  const { leads, file, mtime, fallbackTs } = readLeads();
  if (payloadCache.mtime === mtime && payloadCache.payload && payloadCache.source === file) return payloadCache.payload;
  const payload = buildPayload(leads, { dataDir: DATA, fallbackTs });
  payload.source = file;
  payloadCache = { mtime, payload, source: file };
  return payload;
}

async function handler(req, res) {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const cookies = parseCookies(req.headers.cookie);
  const sess = await sessionUser(cookies.vs_auth);
  const authed = !!sess;
  const ip = req.socket.remoteAddress || '?';

  function serveFile(file, code) {
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(code || 200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }

  /* login / logout (livres) */
  if (url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', async () => {
      let u = '', p = '', keep = false;
      try { const j = JSON.parse(body || '{}'); u = j.user; p = j.pass; keep = !!j.keep; } catch {}
      try {
        const r = await attemptLogin({ email: u, pass: p, keep, ip });
        if (r.token) res.setHeader('Set-Cookie', authCookie(r.token, { maxAge: r.keep ? Math.floor(r.ttlMs / 1000) : 0 }));
        json(res, r.status, r.body);
      } catch (e) {
        console.error('[serve-web] login', e);
        json(res, 500, { error: 'internal' });
      }
    });
    return;
  }
  if (url === '/api/logout' && req.method === 'POST') {
    if (cookies.vs_auth) await destroySession(cookies.vs_auth);
    res.setHeader('Set-Cookie', clearAuthCookie());
    json(res, 200, { ok: true });
    return;
  }

  /* API exige sessão */
  if (url.startsWith('/api')) {
    if (!authed) { json(res, 401, { error: 'unauthorized' }); return; }
    if (url === '/api/me') { json(res, 200, { user: sess.email, role: sess.role }); return; }
    if (url === '/api/insight' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', async () => {
        let q = '';
        let history = [];
        try {
          const j = JSON.parse(body || '{}');
          q = String(j.q || '').slice(0, 1000);
          history = Array.isArray(j.history) ? j.history.slice(-6) : [];
        } catch {}
        if (!q) { json(res, 400, { error: 'empty_q' }); return; }
        try {
          const r = await askGroq({ question: q, context: formatContext(livePayload()), history });
          json(res, 200, { answer: r.answer, source: 'groq' });
        } catch (e) {
          json(res, 503, { error: e.code || 'groq_error' });
        }
      });
      return;
    }
    if (url === '/api/leads') {
      try { json(res, 200, livePayload()); } catch (e) { json(res, 500, { error: e.message }); }
      return;
    }
    if (url === '/api/capture' && req.method === 'GET') { json(res, 200, jobStatus()); return; }
    if (url === '/api/capture' && req.method === 'POST') {
      try { const r = startCapture(); json(res, r.code, r.body); } catch (e) { json(res, 500, { error: e.message }); }
      return;
    }
    if (url === '/api/queries' && req.method === 'GET') {
      try { const { QUERIES } = require('./capture-advogados-df'); json(res, 200, { queries: QUERIES }); } catch (e) { json(res, 500, { error: e.message }); }
      return;
    }
    json(res, 404, { error: 'not_found' });
    return;
  }

  /* tela de login */
  if (url === '/login' || url === '/login.html') { serveFile(path.join(ROOT, 'login.html')); return; }

  /* sem sessão: bloqueia o app e redireciona */
  if (!authed) {
    if (PUBLIC_LOGIN.has(url)) { serveFile(path.join(ROOT, url)); return; }
    res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  serveFile(file);
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((e) => {
    console.error('[serve-web]', e);
    try { json(res, 500, { error: 'internal' }); } catch {}
  });
});

const PORT = parseInt(process.env.PORT || '8901', 10);
server.listen(PORT, () => console.log(`Virgo Scout API+web em http://localhost:${PORT}`));
