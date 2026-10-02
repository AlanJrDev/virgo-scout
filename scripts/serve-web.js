const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
require('dotenv').config();
const { buildPayload } = require('../src/utils/metrics');
const { checkCredentials, newSessionToken, loginAllowed, registerFail, clearFails } = require('./serve-web-auth');

const ROOT = path.join(__dirname, '..', 'web');
const DATA = path.join(__dirname, '..', 'data');
const JOB_FILE = path.join(DATA, 'job.json');
const JOB_LOG = path.join(DATA, 'capture-live.log');
const JOB_ERR = path.join(DATA, 'capture-live.err.log');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

/* ---------- sessões locais (em memória; reinício do servidor desloga) ---------- */
const sessions = new Map(); // token -> expiresAt (ms)
const DAY = 24 * 60 * 60 * 1000;
function sessionValid(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
// arquivos que a tela de login precisa sem sessão
const PUBLIC_LOGIN = new Set(['/login.css', '/login.js', '/styles.css', '/vendor/gsap.min.js', '/assets/LOGO.png']);

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

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

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const cookies = parseCookies(req.headers.cookie);
  const authed = sessionValid(cookies.vs_auth);
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
    if (!loginAllowed(ip)) { json(res, 429, { error: 'locked' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let u = '', p = '', keep = false;
      try { const j = JSON.parse(body || '{}'); u = j.user; p = j.pass; keep = !!j.keep; } catch {}
      if (!checkCredentials(u, p)) {
        const locked = registerFail(ip);
        json(res, locked ? 429 : 401, { error: locked ? 'locked' : 'invalid' });
        return;
      }
      clearFails(ip);
      const token = newSessionToken();
      sessions.set(token, Date.now() + (keep ? 7 * DAY : DAY));
      const cookie = `vs_auth=${token}; Path=/; HttpOnly; SameSite=Lax${keep ? `; Max-Age=${7 * 86400}` : ''}`;
      res.setHeader('Set-Cookie', cookie);
      json(res, 200, { ok: true, user: u });
    });
    return;
  }
  if (url === '/api/logout' && req.method === 'POST') {
    if (cookies.vs_auth) sessions.delete(cookies.vs_auth);
    res.setHeader('Set-Cookie', 'vs_auth=; Path=/; HttpOnly; Max-Age=0');
    json(res, 200, { ok: true });
    return;
  }

  /* API exige sessão */
  if (url.startsWith('/api')) {
    if (!authed) { json(res, 401, { error: 'unauthorized' }); return; }
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
});

const PORT = parseInt(process.env.PORT || '8901', 10);
server.listen(PORT, () => console.log(`Virgo Scout API+web em http://localhost:${PORT}`));
