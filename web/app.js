/* Virgo Tech dashboard — dados ao vivo (/api/leads) + motion GSAP (momento único de entrada) */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGsap = typeof window.gsap !== 'undefined' && !reduceMotion;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var charts = { bars: null, donut: null };
  var bootTl = null; // timeline de entrada do boot — guardada p/ matar troca rápida (não acumula)
  var trendState = { visible: null };
  var TREND_COLORS = { total: '#38bdf8', comSite: '#34d399', semSite: '#fbbf24', comWa: '#2e7cf6', alta: '#f87171', icpSite: '#a78bfa', icpSistema: '#22d3ee' };
  var CHART_ANIM = reduceMotion ? { colors: true, x: false, y: false } : { duration: 650, easing: 'easeOutQuart', delay: function (c) { return (c.dataIndex || 0) * 45; } };

  function chartTheme() {
    if (typeof window.Chart === 'undefined') return null;
    if (!window.Chart.__virgo) {
      window.Chart.__virgo = true;
      window.Chart.defaults.font.family = '"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      window.Chart.defaults.font.size = 11.5;
      window.Chart.defaults.color = '#7d90ac';
      window.Chart.defaults.borderColor = 'rgba(120,160,255,.10)';
      window.Chart.defaults.devicePixelRatio = window.devicePixelRatio || 1;
    }
    return window.Chart;
  }

  /* Evolução por tipo de leads — D3 multi-linha com chips de visibilidade (todas ligadas no início) */
  function renderTrend(Series) {
    var svg = $('#trendChart');
    if (!svg || typeof window.d3 === 'undefined') return;
    var d3 = window.d3;
    var wrap = svg.parentNode;
    var days = (Series && Series.days) || [];
    var series = ((Series && Series.series) || []).filter(function (s) { return s && Array.isArray(s.values) && s.values.length === days.length; });
    var tip = $('#trendTip');
    if (!series.length || days.length < 2) {
      svg.setAttribute('viewBox', '0 0 600 200');
      svg.innerHTML = '<text x="300" y="100" text-anchor="middle" fill="#7d90ac" font-size="13">Sem dados de evolução ainda — execute uma captura.</text>';
      if (tip) tip.hidden = true;
      var tgl0 = $('#trendToggles'); if (tgl0) tgl0.innerHTML = '';
      return;
    }
    if (!trendState.visible) {
      trendState.visible = {};
      series.forEach(function (s) { trendState.visible[s.key] = true; });
    }
    series.forEach(function (s) { if (!(s.key in trendState.visible)) trendState.visible[s.key] = true; });
    var vis = series.filter(function (s) { return trendState.visible[s.key]; });

    var tgl = $('#trendToggles');
    tgl.innerHTML = series.map(function (s) {
      var on = trendState.visible[s.key];
      return '<button type="button" class="chip trend-chip' + (on ? '' : ' off') + '" data-key="' + s.key + '" aria-pressed="' + (on ? 'true' : 'false') + '"><i style="background:' + (TREND_COLORS[s.key] || '#7d90ac') + '"></i>' + escapeHtml(s.label) + '</button>';
    }).join('');
    tgl.querySelectorAll('.trend-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key');
        trendState.visible[key] = !trendState.visible[key];
        btn.classList.toggle('off', !trendState.visible[key]);
        btn.setAttribute('aria-pressed', trendState.visible[key] ? 'true' : 'false');
        renderTrend(Series);
      });
    });

    var W = Math.max(wrap.clientWidth || 600, 320), H = 248;
    var M = { t: 16, r: 60, b: 28, l: 40 };
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '';
    var x = d3.scalePoint().domain(days).range([M.l, W - M.r]).padding(0.5);
    var maxY = d3.max(vis, function (s) { return d3.max(s.values); }) || 1;
    var y = d3.scaleLinear().domain([0, Math.ceil(maxY * 1.08)]).range([H - M.b, M.t]).nice();
    var line = d3.line().x(function (d, i) { return x(days[i]); }).y(function (d) { return y(d); }).curve(d3.curveMonotoneX);
    var defs = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
    defs.innerHTML = '<linearGradient id="trendGridGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(120,160,255,.10)"/><stop offset="1" stop-color="rgba(120,160,255,.04)"/></linearGradient>';
    var g = d3.select(svg).append('g').attr('transform', 'translate(0,0)');

    g.append('g').attr('class', 't-grid').selectAll('line').data(y.ticks(4)).enter().append('line')
      .attr('x1', M.l).attr('x2', W - M.r).attr('y1', function (d) { return y(d); }).attr('y2', function (d) { return y(d); })
      .attr('stroke', 'url(#trendGridGrad)');
    g.append('g').attr('class', 't-axis t-ay').attr('transform', 'translate(' + (M.l - 6) + ',0)')
      .call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8)).call(function (sel) { sel.select('.domain').remove(); });
    g.append('g').attr('class', 't-axis t-ax').attr('transform', 'translate(0,' + (H - M.b + 16) + ')')
      .call(d3.axisBottom(x).tickSize(0).tickPadding(10)).call(function (sel) { sel.select('.domain').remove(); });

    var dur = reduceMotion ? 0 : 850, stag = reduceMotion ? 0 : 130;
    var endLabels = [];
    vis.forEach(function (s, si) {
      var c = TREND_COLORS[s.key] || '#7d90ac';
      g.append('path').attr('class', 't-line').attr('fill', 'none').attr('stroke', c).attr('stroke-width', 2.2)
        .attr('stroke-linecap', 'round').attr('d', line(s.values))
        .attr('opacity', 0.95)
        .attr('stroke-dasharray', function () { var L = this.getTotalLength ? this.getTotalLength() : 0; return reduceMotion || !L ? null : L + ' ' + L; })
        .attr('stroke-dashoffset', function () { var L = this.getTotalLength ? this.getTotalLength() : 0; return reduceMotion || !L ? 0 : L; })
        .transition().duration(dur).delay(reduceMotion ? 0 : si * stag).ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
      var lx = x(days[days.length - 1]), ly = y(s.values[s.values.length - 1]);
      g.append('circle').attr('class', 't-dot').attr('cx', lx).attr('cy', ly).attr('r', 4.5)
        .attr('fill', '#0f1524').attr('stroke', c).attr('stroke-width', 2.2)
        .attr('opacity', 0).attr('transform', reduceMotion ? '' : 'scale(0)')
        .attr('transform-origin', lx + 'px ' + ly + 'px')
        .transition().duration(dur ? 420 : 0).delay(reduceMotion ? 0 : si * stag + dur * 0.7).ease(d3.easeBackOut.overshoot(2.4))
        .attr('opacity', 1).attr('transform', 'scale(1)');
      endLabels.push({ color: c, ly: ly, text: fmtInt(s.values[s.values.length - 1]), delay: si * stag + dur * 0.85 });
    });
    endLabels.sort(function (a, b) { return a.ly - b.ly; });
    for (var e = 1; e < endLabels.length; e++) {
      if (endLabels[e].ly - endLabels[e - 1].ly < 13) endLabels[e].ly = endLabels[e - 1].ly + 13;
    }
    var lxEnd = x(days[days.length - 1]) + 8;
    endLabels.forEach(function (L) {
      g.append('text').attr('class', 't-end').attr('x', lxEnd).attr('y', L.ly + 3.5)
        .attr('fill', L.color).attr('font-size', 11).attr('font-weight', 600).attr('opacity', 0)
        .text(L.text).transition().duration(dur ? 500 : 0).delay(reduceMotion ? 0 : L.delay)
        .attr('opacity', 0.95);
    });

    if (tip) {
      var guide = g.append('line').attr('class', 't-guide').attr('y1', M.t).attr('y2', H - M.b)
        .attr('stroke', 'rgba(125,144,172,.45)').attr('stroke-dasharray', '3 4').attr('opacity', 0);
      var hDots = g.append('g').attr('class', 't-hipdots');
      svg.addEventListener('mousemove', function (ev) {
        var r = svg.getBoundingClientRect();
        var px = ((ev.clientX - r.left) / r.width) * W;
        var i = Math.max(0, Math.min(days.length - 1, Math.round((px - M.l) / x.step())));
        var gx = x(days[i]);
        guide.attr('x1', gx).attr('x2', gx).attr('opacity', 1);
        var hsel = hDots.selectAll('circle').data(vis).join('circle')
          .attr('cx', gx).attr('cy', function (s) { return y(s.values[i]); }).attr('r', 3.4)
          .attr('fill', function (s) { return TREND_COLORS[s.key] || '#7d90ac'; });
        tip.hidden = false;
        tip.innerHTML = '<strong>' + days[i] + '</strong>' + vis.map(function (s, sIdx) {
          return '<span><i style="background:' + (TREND_COLORS[s.key] || '#7d90ac') + '"></i>' + escapeHtml(s.label) + ' <b>' + fmtInt(s.values[i]) + '</b></span>';
        }).join('');
        var wr = wrap.getBoundingClientRect();
        var tx = Math.min(Math.max(ev.clientX - wr.left + 14, 8), wr.width - 168);
        tip.style.left = tx + 'px';
        tip.style.top = Math.max(ev.clientY - wr.top - 14, 4) + 'px';
      });
      svg.addEventListener('mouseleave', function () { guide.attr('opacity', 0); hDots.selectAll('circle').remove(); if (tip) tip.hidden = true; });
    }
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function hhmm() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fmtInt(n) { return (typeof n === 'number' && isFinite(n) ? Math.round(n) : 0).toLocaleString('pt-BR'); }

  var WA_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>';
  var SITE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 4 5.6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.6-4-9s1.5-6.4 4-9z"/></svg>';
  var IG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>';

  function igHref(l) {
    var ig = String(l.instagram || '').trim().replace(/^@/, '');
    if (!ig) return '';
    return /^https?:\/\//i.test(ig) ? ig : 'https://instagram.com/' + ig;
  }
  function igBtn(l) {
    var href = igHref(l);
    if (!href) return '';
    return '<a class="ig-btn" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir Instagram de ' + escapeHtml(l.name) + '" title="Abrir Instagram">' + IG_SVG + '</a>';
  }
  function siteBtn(l) {
    var s = String(l.site_url || '').trim();
    if (!s) return '';
    var href = /^https?:\/\//i.test(s) ? s : 'https://' + s;
    return '<a class="site-btn" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir site de ' + escapeHtml(l.name) + '" title="Abrir site">' + SITE_SVG + '</a>';
  }

  /* ---------- toast: feedback de ações ---------- */
  function toast(msg, kind) {
    var box = $('#toasts');
    if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.setAttribute('role', 'status');
    t.innerHTML = '<i></i><span>' + escapeHtml(msg) + '</span>';
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    var timer = setTimeout(close, 2800);
    function close() { clearTimeout(timer); if (!t.parentNode) return; t.classList.add('out'); setTimeout(function () { t.remove(); }, 170); }
    t.addEventListener('click', close);
  }

  /* ---------- saudação / relógio ---------- */
  var h = new Date().getHours();
  $('#greeting').textContent = (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + ',';
  var now = new Date();
  var months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var days = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  $('#todayLine').textContent = days[now.getDay()] + ', ' + now.getDate() + ' de ' + months[now.getMonth()] + ' de ' + now.getFullYear();
  function tick() {
    var d = new Date();
    $('#clockLine').textContent = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  tick(); setInterval(tick, 15000);

  /* ---------- helpers de render ---------- */
  function countUp(el, target) {
    if (!hasGsap) { el.textContent = fmtInt(target); return; }
    var o = { v: 0 };
    window.gsap.to(o, { v: target, duration: 0.9, ease: 'expo.out', onUpdate: function () { el.textContent = fmtInt(Math.round(o.v)); } });
  }

  var CIRC = 2 * Math.PI * 15.5;
  function ring(score, size) {
    var color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
    return '<span class="ring"><svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="15.5"/>' +
      '<circle class="fg" cx="20" cy="20" r="15.5" stroke="' + color + '" stroke-dasharray="' + CIRC.toFixed(1) + '" stroke-dashoffset="' + CIRC.toFixed(1) + '" data-ring="' + score + '"/>' +
      '</svg><b>' + score + '</b></span>';
  }
  function drawRings(scope) {
    (scope || document).querySelectorAll('[data-ring]').forEach(function (c) {
      var target = CIRC * (1 - (+c.getAttribute('data-ring')) / 100);
      if (!hasGsap) { c.setAttribute('stroke-dashoffset', target.toFixed(1)); return; }
      window.gsap.to(c, { strokeDashoffset: target, duration: 0.7, ease: 'expo.out', delay: 0.35 });
    });
  }

  /* estado vazio compartilhado por gráficos e listas */
  function emptyBox(title, text) {
    return '<div class="empty-box"><span class="empty-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V8l6-5v18"/><path d="M10 21V12l8-4v13"/><path d="M2 21h20"/></svg></span>' +
      '<strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(text) + '</p></div>';
  }

  /* ---------- estado da captura (API) ---------- */
  var currentPayload = null;
  var pollTimer = null;
  var sawRunning = false;
  var typeFilter = 'all';
  var areaState = { active: '' };
  try { var vt = sessionStorage.getItem('vs_type'); if (vt) typeFilter = vt; } catch (e) {}
  var captureCat = 'advogados';
  try { var vc = sessionStorage.getItem('vs_capture_cat'); if (vc) captureCat = vc; } catch (e) {}
  var CAT_LABELS = { advogados: 'Advogados', arquitetura: 'Arquitetura', tapecaria: 'Tapeçaria', estofado: 'Estofado', topografia: 'Topografia' };
  function catLabel(tag) {
    return CAT_LABELS[tag] || tag.charAt(0).toUpperCase() + tag.slice(1).replace(/-/g, ' ');
  }
  /* chips dinâmicos: categorias vêm dos dados (l.types/source do payload) — nova captura entra sozinha */
  function renderTypeSwitch() {
    var box = document.getElementById('typeSwitch');
    if (!box) return;
    var pool = (currentPayload && currentPayload.pool) || [];
    var cats = [];
    for (var i = 0; i < pool.length; i++) {
      var raw = pool[i].types != null ? pool[i].types : (pool[i].source != null ? pool[i].source : '');
      if (typeof raw !== 'string') raw = (raw && raw.join) ? raw.join(',') : '';
      var tag = String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
      if (tag && tag !== 'all' && cats.indexOf(tag) === -1) cats.push(tag);
    }
    var html = '<button type="button" class="type-btn' + (typeFilter === 'all' ? ' active' : '') + '" data-type="all" aria-pressed="' + (typeFilter === 'all') + '" title="Todas as categorias">Todos</button>';
    for (var i = 0; i < cats.length; i++) {
      var on = typeFilter === cats[i];
      html += '<button type="button" class="type-btn' + (on ? ' active' : '') + '" data-type="' + escapeHtml(cats[i]) + '" aria-pressed="' + on + '" title="' + escapeHtml(catLabel(cats[i])) + '">' + escapeHtml(catLabel(cats[i])) + '</button>';
    }
    box.innerHTML = html;
  }
  function syncTypeUI() {
    var box = document.getElementById('typeSwitch');
    if (box) {
      var btns = box.querySelectorAll('.type-btn');
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].getAttribute('data-type') === typeFilter;
        btns[i].classList.toggle('active', on);
        btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    var sel = document.getElementById('capCat');
    if (sel) sel.value = captureCat;
    var t = document.getElementById('capTitle');
    var labels = CAT_LABELS;
    if (t) t.textContent = 'Captura — ' + (labels[captureCat] || catLabel(captureCat));
  }
  function setCaptureUI(st) {
    var bar = $('#capBar'), pct = $('#capPct'), sub = $('#capSub'), btn = $('#capRun');
    var prog = document.querySelector('.capture-card .progress');
    if (!st || st.status === 'idle') {
      bar.style.width = '100%'; pct.textContent = '100%';
      var total = currentPayload && currentPayload.stats ? currentPayload.stats.total : 0;
      sub.textContent = 'Última captura concluída' + (total ? ' · ' + total + ' empresas' : '');
      btn.textContent = 'Nova captura'; btn.disabled = false;
      btn.classList.remove('busy');
      if (prog) prog.classList.remove('busy');
      return;
    }
    if (st.status === 'running') {
      sawRunning = true;
      var p = st.total ? Math.round((100 * st.done) / st.total) : 0;
      bar.style.width = p + '%'; pct.textContent = p + '%';
      sub.textContent = (st.current || 'iniciando…') + ' · ' + st.done + '/' + st.total;
      btn.textContent = 'Capturando…'; btn.disabled = true; btn.classList.add('busy');
      if (prog) prog.classList.add('busy');
      if (!pollTimer) pollTimer = setInterval(pollCapture, 3000);
      return;
    }
    if (st.status === 'done') {
      bar.style.width = '100%'; pct.textContent = '100%';
      sub.textContent = st.summary ? st.summary.replace('[capture] ', '') : 'Concluída';
      btn.textContent = 'Nova captura'; btn.disabled = false; btn.classList.remove('busy');
      if (prog) prog.classList.remove('busy');
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      var dec = window.CaptureState ? window.CaptureState.decide('done', { sawRunning: sawRunning, startedAt: st.started_at, storage: window.sessionStorage }) : { toast: true, reload: false };
      if (dec.toast) toast('Captura concluída — atualizando dados…', 'ok');
      if (dec.reload) setTimeout(function () { location.reload(); }, 1400);
      return;
    }
    bar.style.width = '0%'; pct.textContent = 'erro';
    sub.textContent = 'Captura falhou — veja data/capture-live.err.log';
    btn.textContent = 'Tentar de novo'; btn.disabled = false; btn.classList.remove('busy');
    if (prog) prog.classList.remove('busy');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    toast('Captura falhou — confira o log', 'warn');
  }
  function pollCapture() {
    fetch('/api/capture', { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { location.href = '/login'; return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (d) { if (d) setCaptureUI(d); })
      .catch(function () {});
  }
  function startCapture() {
    var btn = $('#capRun');
    btn.disabled = true; btn.textContent = 'Iniciando…';
    fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: captureCat }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (res) {
        if (res.ok) setCaptureUI(res.b.job || { status: 'running', done: 0, total: res.b.job && res.b.job.queries });
        else { btn.disabled = false; btn.textContent = 'Tentar de novo'; $('#capSub').textContent = res.b.error === 'already_running' ? 'Já existe uma captura em andamento' : res.b.error === 'local-only' ? 'Capture na máquina local' : 'Erro ao iniciar'; }
      })
      .catch(function () { btn.disabled = false; btn.textContent = 'Tentar de novo'; });
  }

  /* ---------- mapa: MapLibre GL (WebGL) com fallback 2D sem WebGL ---------- */
  function initMap(D) {
    var host = $('#leadMap');
    var regions = (D && D.regions) || [];
    if (!host) return;
    if (!regions.length) { host.innerHTML = '<div class="empty-box"><strong>Sem região para plotar</strong><p>Execute uma captura.</p></div>'; return; }
    var maxCount = Math.max.apply(null, regions.map(function (r) { return r.count; }));
    function sizeOf(count) { return 28 + Math.round(20 * Math.sqrt(count / (maxCount || 1))); }
    // separa bolhas que colidem (aproximação geográfica continua válida)
    function relaxPositions() {
      var pts = regions.map(function (r) { return { lat: r.lat, lng: r.lng }; });
      var radii = regions.map(function (r) { return sizeOf(r.count) / 2; });
      var dLat = 1 / 690, dLng = 1 / 663;
      for (var it = 0; it < 40; it++) {
        var moved = false;
        for (var i = 0; i < pts.length; i++) {
          for (var j = i + 1; j < pts.length; j++) {
            var dx = (pts[i].lng - pts[j].lng) / dLng;
            var dy = (pts[i].lat - pts[j].lat) / dLat;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var need = radii[i] + radii[j] + 10;
            if (dist < need && dist > 0.01) {
              var push = (need - dist) / 2, ux = dx / dist, uy = dy / dist;
              pts[i].lng += ux * push * dLng; pts[i].lat += uy * push * dLat;
              pts[j].lng -= ux * push * dLng; pts[j].lat -= uy * push * dLat;
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
      // mantém tudo dentro da área reservada ao fitBounds (evita bolhas fora do viewport)
      var C = { minLng: -48.19, maxLng: -47.57, minLat: -16.07, maxLat: -15.57 };
      pts.forEach(function (p) {
        p.lng = Math.min(C.maxLng, Math.max(C.minLng, p.lng));
        p.lat = Math.min(C.maxLat, Math.max(C.minLat, p.lat));
      });
      return pts;
    }
    var pos = relaxPositions();
    function popupHtml(r) {
      var altaPct = r.count ? Math.round((100 * r.alta) / r.count) : 0;
      return '<b>' + escapeHtml(r.label) + '</b><br><span>' + r.count + ' leads · ' + r.comSite + ' com site · ' +
        r.alta + ' alta (' + altaPct + '%) · potencial médio ' + r.avgScore + '</span>';
    }
    function bubbleEl(r) {
      // wrapper é posicionado pelo MapLibre (transform intocado); o botão interno recebe o motion
      var wrap = document.createElement('div');
      wrap.className = 'map-marker';
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-bubble' + (r.count && r.alta / r.count >= 0.5 ? ' hot' : '');
      var size = sizeOf(r.count);
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.setAttribute('aria-label', r.label + ': ' + r.count + ' leads');
      el.innerHTML = '<span>' + r.count + '</span>';
      wrap.appendChild(el);
      return wrap;
    }
    function fallbackMap() {
      host.innerHTML = '';
      var box = document.createElement('div');
      box.className = 'map-fallback';
      var B = { minLng: -48.16, maxLng: -47.55, minLat: -16.06, maxLat: -15.57 };
      regions.forEach(function (r, i) {
        var p = pos[i];
        var x = ((p.lng - B.minLng) / (B.maxLng - B.minLng)) * 100;
        var y = (1 - (p.lat - B.minLat) / (B.maxLat - B.minLat)) * 100;
        var d = document.createElement('div');
        d.className = 'fb-dot';
        var size = sizeOf(r.count);
        d.style.cssText = 'left:' + x + '%;top:' + y + '%;width:' + size + 'px;height:' + size + 'px';
        d.textContent = r.count;
        d.title = r.label + ': ' + r.count + ' leads';
        box.appendChild(d);
      });
      host.appendChild(box);
    }
    var supported = typeof window.maplibregl !== 'undefined' &&
      (typeof window.maplibregl.supported !== 'function' || window.maplibregl.supported());
    if (!supported) { fallbackMap(); return; }
    var map;
    try {
      map = new window.maplibregl.Map({
        container: 'leadMap',
        style: 'https://tiles.openfreemap.org/styles/dark',
        center: [-47.93, -15.82],
        zoom: 8.85,
        minZoom: 8,
        maxZoom: 11,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disable();
      window.__map = map;
      map.on('load', function () { map.fitBounds([[-48.21, -16.09], [-47.55, -15.55]], { padding: { top: 16, right: 36, bottom: 66, left: 16 }, duration: 0 }); });
      map.on('error', function () { /* tiles offline: fundo escuro + marcadores seguem */ });
      regions.forEach(function (r, i) {
        var pop = new window.maplibregl.Popup({ offset: 14, closeButton: false, maxWidth: '240px' })
          .setLngLat([pos[i].lng, pos[i].lat])
          .setHTML(popupHtml(r));
        var marker = new window.maplibregl.Marker({ element: bubbleEl(r), anchor: 'center' })
          .setLngLat([pos[i].lng, pos[i].lat])
          .setPopup(pop)
          .addTo(map);
        var node = marker.getElement();
        node.addEventListener('mouseenter', function () { pop.addTo(map); });
        node.addEventListener('mouseleave', function () { pop.remove(); });
        node.addEventListener('focus', function () { pop.addTo(map); });
        node.addEventListener('blur', function () { pop.remove(); });
      });
      function zoom(dz) {
        var z = Math.min(13, Math.max(8, map.getZoom() + dz));
        if (reduceMotion) map.jumpTo({ zoom: z });
        else map.easeTo({ zoom: z, duration: 250 });
      }
      var zi = $('#mapZoomIn'), zo = $('#mapZoomOut'), rc = $('#mapRecenter');
      if (zi) zi.addEventListener('click', function () { zoom(1); });
      if (zo) zo.addEventListener('click', function () { zoom(-1); });
      if (rc) rc.addEventListener('click', function () {
        map.fitBounds([[-48.21, -16.09], [-47.55, -15.55]], { padding: { top: 16, right: 36, bottom: 66, left: 16 }, duration: reduceMotion ? 0 : 400 });
      });
    } catch (e) { fallbackMap(); }
  }

  /* ---------- qualidade da base (consumo defensivo: só existe se a API mandar) ---------- */
  function renderQuality(q, s) {
    var row = document.getElementById('qualityRow');
    if (!row) return;
    var chips = [];
    function n(v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : null; }
    [[s && s.tierA, 'principais · sem site, zap/celular'], [s && s.tierB, 'com site'], [s && s.tierC, 'instagram'], [s && s.tierD, 'só telefone']]
      .forEach(function (pair) {
        var v = n(pair[0]);
        if (v != null) chips.push('<span class="q-chip"><b>' + fmtInt(v) + '</b> ' + pair[1] + '</span>');
      });
    if (q && typeof q === 'object') {
      [['semTelefone', 'sem telefone'], ['semSite', 'sem site'], ['semAvaliacao', 'sem avaliação'], ['semEndereco', 'sem endereço']]
        .forEach(function (pair) {
          var v = n(q[pair[0]]);
          if (v != null) chips.push('<span class="q-chip"><b>' + fmtInt(v) + '</b> ' + pair[1] + '</span>');
        });
      var comp = n(q.completude);
      if (comp != null) {
        if (comp <= 1 && comp >= 0 && q.completude !== 100) comp = Math.round(q.completude * 100);
        chips.push('<span class="q-chip ok"><b>' + comp + '%</b> completude</span>');
      }
    }
    row.innerHTML = chips.join('');
    row.hidden = !chips.length;
  }

  /* ---------- render principal ---------- */

  function render(D) {
    var S = D.stats || {};
    $('#capSub').textContent = 'Brasília/DF · ' + fmtInt(S.total) + ' empresas';
    $('#kSiteSub').textContent = (S.pctSite || 0) + '% do total · ' + fmtInt(S.semSite) + ' sem site';
    $('#kAltaSub').textContent = (S.pctAlta || 0) + '% · nota 4,5★+ com 20+ resenhas';
    $('#kQualSub').textContent = (S.pctQualif || 0) + '% · telefone + sem site + nota 4,5';
    var dEl = $('#kDelta');
    if (dEl) {
      if (D.delta_pct == null) { dEl.textContent = '1ª captura'; dEl.className = 'flat'; }
      else { dEl.textContent = (D.delta_pct >= 0 ? '↑ +' : '↓ ') + D.delta_pct + '% vs anterior'; dEl.className = D.delta_pct >= 0 ? 'up' : 'down'; }
    }
    renderQuality(D.quality, D.stats);

    /* destaques + filtro por área — chips derivam do recorte ativo (tipo no topbar), não do payload global */
    var pool = D.pool && D.pool.length ? D.pool : (D.top || []);
    function waBtn(l) {
      if (l.wa) {
        var cid = l.id ? ' data-contact-id="' + escapeHtml(l.id) + '"' : '';
        return '<a class="wa-btn" href="' + escapeHtml(l.wa) + '"' + cid + ' target="_blank" rel="noopener noreferrer" aria-label="Conversar no WhatsApp com ' + escapeHtml(l.name) + '" title="Abrir WhatsApp">' + WA_SVG + '</a>';
      }
      var semZap = l.phone ? 'Sem WhatsApp declarado no site' : 'Sem telefone na base';
      return '<span class="wa-btn disabled" role="img" aria-label="' + semZap + '" title="' + semZap + '">' + WA_SVG + '</span>';
    }
    function featRows(area) {
      var rows = pool.filter(function (l) { return !area || l.area === area; }).slice(0, 5);
      $('#featList').innerHTML = rows.map(function (l) {
        return '<li data-area="' + escapeHtml(l.area) + '"><span class="feat-ava"><svg viewBox="0 0 24 24"><path d="M4 21V8l6-5v18"/><path d="M10 21V12l8-4v13"/><path d="M2 21h20"/></svg></span>' +
          '<div class="feat-info"><strong>' + escapeHtml(l.name) + '</strong><span>' + escapeHtml(l.cat) + '</span></div>' +
          ring(l.score) + '<span class="badge ' + l.badge + '">' + l.badge + '</span>' +
          waBtn(l) + igBtn(l) +
          '<div class="kebab-wrap">' +
            '<button class="kebab" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Ações do lead" title="Ações">⋮</button>' +
            '<div class="kebab-menu" hidden>' +
              '<button type="button" data-copy="' + escapeHtml(l.name) + '">Copiar nome</button>' +
              (l.wa ? '<button type="button" data-copy="' + escapeHtml(l.wa) + '">Copiar link do WhatsApp</button>' : '') +
              (igHref(l) ? '<button type="button" data-copy="' + escapeHtml(igHref(l)) + '">Copiar link do Instagram</button>' : '') +
            '</div>' +
          '</div></li>';
      }).join('') || '<li class="feat-empty">Nenhum lead nesta área</li>';
      bindCopy();
      drawRings($('#featList'));
    }
    function bindCopy() {
      document.querySelectorAll('[data-copy]').forEach(function (b) {
        if (b._bound) return; b._bound = true;
        b.addEventListener('click', function () {
          if (navigator.clipboard) navigator.clipboard.writeText(b.getAttribute('data-copy')).catch(function () {});
          var km = b.closest ? b.closest('.kebab-menu') : null;
          if (km) { km.hidden = true; var kb = km.parentElement.querySelector('.kebab'); if (kb) kb.setAttribute('aria-expanded', 'false'); }
          toast('Nome copiado', 'ok');
          if (hasGsap) window.gsap.fromTo(b, { scale: 0.8 }, { scale: 1, duration: 0.16, ease: 'expo.out' });
        });
      });
    }
    if (!bindCopy._kebab) {
      bindCopy._kebab = true;
      document.addEventListener('click', function (e) {
        var kab = e.target && e.target.closest ? e.target.closest('.kebab') : null;
        if (kab) {
          var wrap = kab.closest('.kebab-wrap');
          var menu = wrap ? wrap.querySelector('.kebab-menu') : null;
          var open = menu && menu.hidden;
          document.querySelectorAll('.kebab-menu').forEach(function (m) { m.hidden = true; });
          document.querySelectorAll('.kebab[aria-expanded]').forEach(function (k) { k.setAttribute('aria-expanded', 'false'); });
          if (menu && open) { menu.hidden = false; kab.setAttribute('aria-expanded', 'true'); }
          return;
        }
        var outside = !(e.target && e.target.closest && e.target.closest('.kebab-wrap'));
        if (outside) document.querySelectorAll('.kebab-menu').forEach(function (m) {
          m.hidden = true;
          var kb = m.parentElement && m.parentElement.querySelector('.kebab');
          if (kb) kb.setAttribute('aria-expanded', 'false');
        });
      });
    }
    /* chips de área: contagem REAL por área dentro do recorte ativo (pool do tipo),
       máx 6 + 'Todas', ordem por count desc; 'Geral' (fallback) não vira chip */
    function renderAreaFilter(state) {
      var counts = {};
      for (var i = 0; i < pool.length; i++) {
        var a = pool[i].area || 'Geral';
        if (a === 'Geral') continue;
        counts[a] = (counts[a] || 0) + 1;
      }
      var labels = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x]; }).slice(0, 6);
      // área ativa morre se sair do pool OU sair do top-6 (ficaria ativa e invisível); reset ANTES de qualquer early return
      if (state.active && (counts[state.active] == null || labels.indexOf(state.active) === -1)) state.active = '';
      var fRow = $('#areaFilter');
      if (!fRow) return labels;
      var visible = state.active ? counts[state.active] : pool.length;
      // título: fade curto (opacity) quando a contagem muda — troca de recorte é pouco
      // frequente e o (N) age como confirmação do dado; roda ANTES do early return de
      // labels vazio p/ o (N) corrigir mesmo recorte só-'Geral' e não deixar timer órfão
      var head = fRow.closest('.card') ? fRow.closest('.card').querySelector('.card-head h2') : null;
      if (head) {
        var txt = 'Leads em Destaque (' + fmtInt(visible) + ')';
        if (head._featTxt !== txt) {
          clearTimeout(head._featT); // pendência antiga morre; alvo marcado já no agendamento
          var stale1 = head._featIn; // fallback do fade-in anterior, se houver
          if (stale1) clearTimeout(stale1);
          head._featTxt = txt;
          if (reduceMotion) { head.textContent = txt; head.classList.remove('is-swapping'); }
          else {
            head.classList.add('is-swapping'); // dona da transition de opacity (fade-out E fade-in animados)
            head.style.opacity = '0';
            head._featT = setTimeout(function () {
              head.style.opacity = '1'; // fade-in transicionado com a classe ainda viva
              head.textContent = txt;
              var done = function () { head.classList.remove('is-swapping'); };
              var te = function () { head.removeEventListener('transitionend', te); done(); };
              head.addEventListener('transitionend', te);
              clearTimeout(head._featIn);
              head._featIn = setTimeout(done, 170); // fallback sem transitionend
            }, 160);
          }
        }
      }
      if (!labels.length) { fRow.innerHTML = ''; return labels; }
      fRow.innerHTML = ['<button class="chip' + (state.active ? '' : ' active') + '" type="button" data-area="">Todas</button>']
        .concat(labels.map(function (a) {
          return '<button class="chip' + (state.active === a ? ' active' : '') + '" type="button" data-area="' + escapeHtml(a) + '">' + escapeHtml(a) + ' <b>' + counts[a] + '</b></button>';
        })).join('');
      fRow.querySelectorAll('.chip').forEach(function (c) {
        c.addEventListener('click', function () {
          fRow.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active'); });
          c.classList.add('active');
          state.active = c.getAttribute('data-area') || '';
          renderAreaFilter(state);
          featRows(state.active);
        });
      });
      return labels;
    }
    renderAreaFilter(areaState);
    featRows(areaState.active);

    /* IA: top 3 com área */
    function describe(l) {
      var parts = [];
      if (l.area && l.area !== 'Geral') parts.push('atuando em ' + l.area.toLowerCase());
      if (l.rating) parts.push('reputação ' + String(l.rating).replace('.', ',') + '★' + (l.reviews ? ' com ' + l.reviews + ' avaliações' : ''));
      parts.push(l.site ? 'site profissional' : 'sem site detectado');
      parts.push(l.phone ? 'telefone captado' : 'sem telefone');
      return cap(parts.join(', ')) + '. Alta probabilidade de interesse em soluções digitais.';
    }
    $('#aiList').innerHTML = (D.top || []).slice(0, 3).map(function (l) {
      return '<li><div class="ai-lead-head"><strong>' + escapeHtml(l.name) + '</strong>' + ring(l.score) + '</div><p>' + escapeHtml(describe(l)) + '</p></li>';
    }).join('');

    /* legenda do mapa */
    var legend = [
      { label: 'Total', value: S.total || 0, color: '#38bdf8' },
      { label: 'Com site', value: S.comSite || 0, color: '#2e7cf6' },
      { label: 'Sem site', value: S.semSite || 0, color: '#7dd3fc' },
      { label: 'Alta prioridade', value: S.alta || 0, color: '#f87171' }
    ];
    $('#mapLegend').innerHTML = legend.map(function (l) {
      return '<li><i style="background:' + l.color + '"></i>' + l.label + '<b>' + l.value + '</b></li>';
    }).join('');

    /* mapa real: MapLibre GL (open source, WebGL/GPU) com fallback 2D */
    initMap(D);

    /* composição da base: barras por aba (áreas / regiões / notas) */
    var chartData = {
      areas: (D.areas || []).filter(function (a) { return a.label !== 'Geral'; })
        .map(function (a) { return { label: a.label, value: a.value }; }),
      regioes: (D.regions || []).map(function (r) {
        return { label: r.label, value: r.count, sub: r.avgScore + ' potencial' };
      }),
      notas: (D.ratingBuckets || []).map(function (b) { return { label: b.label, value: b.value }; })
    };
    function renderBars(key) {
      var list = (chartData[key] || []).map(function (x) { return { label: x.label, value: x.value || 0, sub: x.sub || '' }; });
      var Canvas = chartTheme();
      var host = $('#barsChart');
      if (!host || !Canvas) {
        if (host && !Canvas) host.innerHTML = emptyBox('Sem dados para este recorte', 'Os números desta aba aparecem quando a categoria tem leads.');
        return;
      }
      var labels = list.map(function (x) { return x.label; });
      var values = list.map(function (x) { return x.value; });
      var sum = values.reduce(function (a, v) { return a + v; }, 0);
      var tooltipSub = { callbacks: { label: function (c) { var x = list[c.dataIndex] || {}; return ' ' + fmtInt(x.value) + (sum ? ' (' + Math.round((100 * x.value) / sum) + '%)' : '') + (x.sub ? ' · ' + x.sub : ''); } } };
      var config = {
        type: 'bar', data: { labels: labels, datasets: [{ data: values, borderRadius: 5, borderSkipped: false, maxBarThickness: 14,
          backgroundColor: function (c) { var a = c.chart && c.chart.chartArea; if (!a) return '#2e7cf6'; var g = c.chart.ctx.createLinearGradient(0, 0, a.right || 0, 0); g.addColorStop(0, '#2e7cf6'); g.addColorStop(1, '#38bdf8'); return g; },
          hoverBackgroundColor: '#5aa5fb' }] },
        options: {
          indexAxis: 'y', maintainAspectRatio: false, animation: CHART_ANIM, layout: { padding: { right: 8 } },
          plugins: { legend: { display: false }, tooltip: tooltipSub },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(120,160,255,.08)', drawBorder: false } },
            y: { ticks: { color: '#7d90ac' }, grid: { display: false }, afterFit: function (ax) { ax.width = 96; } }
          }
        }
      };
      if (!charts.bars) { host.innerHTML = '<canvas id="barsCanvas" role="img" aria-label="Composição da base por recorte"></canvas>'; charts.bars = new Canvas(document.getElementById('barsCanvas'), config); }
      else { charts.bars.data.labels = labels; charts.bars.data.datasets[0].data = values; charts.bars.update(); }
      if (!list.length) charts.bars.ctx.clearRect(0, 0, charts.bars.width, charts.bars.height);
    }
    var tabs = $('#chartTabs');
    if (tabs) {
      tabs.querySelectorAll('.chip').forEach(function (btn) {
        btn.addEventListener('click', function () {
          tabs.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          renderBars(btn.getAttribute('data-chart'));
        });
      });
      renderBars('areas');
    }

    /* donut */
    var DC = chartTheme();
    var donutData = (D.donut || []).filter(function (s) { return s && s.value > 0; });
    var donutHost = $('#donut');
    $('#donutTotal').textContent = fmtInt(S.total || 0);
    if (!donutData.length) {
      $('#donutLegend').innerHTML = '<li class="empty-box"><strong>Sem composição ainda</strong><p>Os segmentos aparecem quando a categoria tem leads.</p></li>';
      if (charts.donut) { charts.donut.clear(); }
    } else if (DC && donutHost) {
      var donutSum = donutData.reduce(function (a, x) { return a + x.value; }, 0) || 1;
      if (!charts.donut) {
        charts.donut = new DC(document.getElementById('donut'), {
          type: 'doughnut',
          data: { labels: donutData.map(function (s) { return s.label; }), datasets: [{ data: donutData.map(function (s) { return s.value; }), backgroundColor: donutData.map(function (s) { return s.color; }), borderWidth: 0, hoverOffset: 6 }] },
          options: { cutout: '76%', maintainAspectRatio: false, animation: { animateRotate: !reduceMotion, duration: reduceMotion ? 0 : 700, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var s = donutData[c.dataIndex] || {}; return ' ' + (s.label || '') + ': ' + fmtInt(s.value) + ' (' + Math.round((100 * (s.value || 0)) / (S.total || 1)) + '%)'; } } } } }
        });
      } else {
        charts.donut.data.labels = donutData.map(function (s) { return s.label; });
        charts.donut.data.datasets[0].data = donutData.map(function (s) { return s.value; });
        charts.donut.data.datasets[0].backgroundColor = donutData.map(function (s) { return s.color; });
        charts.donut.update();
      }
      $('#donutLegend').innerHTML = donutData.map(function (s) {
        var pct = Math.round((100 * s.value) / (S.total || 1));
        return '<li><i style="background:' + s.color + '"></i>' + escapeHtml(s.label) + '<b>' + fmtInt(s.value) + ' <span style="color:var(--faint)">(' + pct + '%)</span></b></li>';
      }).join('');
    }

    /* evolução por tipo de leads — D3 linhas multi-série com chips de visibilidade */
    renderTrend(D.series);

    /* oportunidades reais derivadas da base */
    var oppIcons = {
      doc: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/></svg>',
      mon: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M8 21h8M12 19v2M7 10h4M7 14h7"/></svg>',
      chk: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>',
      spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>'
    };
    var opps = [];
    if (S.comPhone > 0) opps.push({ ico: 'mon', title: S.comPhone + ' leads com telefone', sub: 'Telefone presente na base (não validado como WhatsApp)' });
    if (S.alta > 0) opps.push({ ico: 'chk', title: S.alta + ' em alta oportunidade', sub: 'Notas 4,5★+ com 20+ avaliações — priorizar' });
    if (S.semSite > 0) opps.push({ ico: 'doc', title: S.semSite + ' leads sem site', sub: 'Landing page converte essa base fria' });
    if (D.areas && D.areas.length > 1) {
      var topArea = D.areas.filter(function (a) { return a.label !== 'Geral'; })[0];
      if (topArea) opps.push({ ico: 'spark', title: topArea.label + ': ' + topArea.value + ' leads', sub: 'Maior concentração por especialidade' });
    }
    if (!opps.length) opps.push({ ico: 'spark', title: 'Base enxuta', sub: 'Execute uma captura para gerar insights' });
    $('#oppsList').innerHTML = opps.slice(0, 3).map(function (o) {
      return '<li><span class="opp-ico">' + oppIcons[o.ico] + '</span><div><strong>' + escapeHtml(o.title) + '</strong><span>' + escapeHtml(o.sub) + '</span></div></li>';
    }).join('');

    /* recentes — capturas reais */
    var icons = {
      active: '<svg viewBox="0 0 24 24"><path d="M12 3v10"/><path d="m8 9 4-4 4 4"/><path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/></svg>',
      done: '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>'
    };
    $('#recentList').innerHTML = (D.recent || []).map(function (r) {
      return '<li><span class="rec-ico ' + r.status + '">' + icons[r.status] + '</span>' +
        '<div class="rec-info"><strong>' + escapeHtml(r.tag) + '</strong><span>' + escapeHtml(r.detail) + '</span></div>' +
        '<span class="rec-when">' + escapeHtml(r.when) + '</span></li>';
    }).join('') || '<li class="feat-empty">Nenhuma captura ainda</li>';

    /* tabela densa da base (módulo web/table.js) */
    if (window.VS_TABLE) window.VS_TABLE.render(D);

    /* fila "Contatar hoje": top 10 contatáveis ainda não abordados */
    function renderQueue() {
      var qPool = (currentPayload && currentPayload.pool) || [];
      var queue = qPool.filter(function (l) { return l.score > 0 && !l.closed && (l.status || 'novo') === 'novo'; })
        .sort(function (a, b) { return (b.site ? 0 : 1) - (a.site ? 0 : 1) || b.score - a.score; })
        .slice(0, 10);
      var card = document.getElementById('queueCard');
      if (!card) return;
      card.hidden = !queue.length;
      var n = queue.length;
      document.getElementById('queueSub').textContent = n + (n === 1 ? ' lead contatável ainda não abordado' : ' leads contatáveis ainda não abordados');
      document.getElementById('queueList').innerHTML = queue.map(function (l) {
        var why = [];
        if (!l.site) why.push('sem site');
        if (l.email) why.push('e-mail');
        if (l.instagram) why.push('Instagram');
        if (l.since_year) why.push('desde ' + l.since_year);
        return '<li data-id="' + escapeHtml(l.id || '') + '">' +
          '<div class="q-info"><strong>' + escapeHtml(l.name) + '</strong><span>' + escapeHtml((l.area || 'Geral') + (why.length ? ' · ' + why.join(' · ') : '')) + '</span></div>' +
          ring(l.score) + (l.wa ? waBtn(l) : '') + siteBtn(l) + igBtn(l) + '</li>';
      }).join('');
      drawRings(document.getElementById('queueList'));
    }
    renderQueue();

    /* motion: momento único de entrada */
    function finalStates() {
      document.querySelectorAll('[data-count]').forEach(function (el2) {
        var m = { kTotal: S.total, kSite: S.comSite, kAlta: S.alta, kQual: S.qualif };
        el2.textContent = fmtInt(m[el2.id] || 0);
      });
      drawRings(document);
      document.querySelectorAll('[data-w]').forEach(function (t) { t.style.width = t.getAttribute('data-w') + '%'; });
    }
    if (!hasGsap) { finalStates(); }
    else {
      // partial boot de entrada apenas 1x por sessão (flag vs_dash_boot): trocas de tipo
      // subsequentes atualizam em estado final, sem replay de entrada
      var bootDone = null;
      try { bootDone = sessionStorage.getItem('vs_dash_boot'); } catch (e) {}
      if (bootDone) { finalStates(); }
      else {
        try { sessionStorage.setItem('vs_dash_boot', '1'); } catch (e) {}
        /* dono único da entrada: cada tween termina limpando inline
           transform/opacity/visibility (clearProps) — devolve os cards aos styles
           (hover-lift .dash-lift e estados :active voltam a funcionar pós-boot).
           is-booting silencia as transitions CSS dos cards ENQUANTO a timeline roda. */
        if (bootTl) { bootTl.kill(); document.body.classList.remove('is-booting'); } // troca rápida não acumula timelines
        document.body.classList.add('is-booting');
        bootTl = window.gsap.timeline({
          defaults: { ease: 'expo.out', clearProps: 'transform,opacity,visibility' },
          onComplete: function () { document.body.classList.remove('is-booting'); }
        });
        bootTl.from('.sidebar', { x: -16, autoAlpha: 0, duration: 0.28 })
        .from('.topbar', { y: -12, autoAlpha: 0, duration: 0.26 }, 0.05)
        .from('.greet', { y: 10, autoAlpha: 0, duration: 0.26 }, 0.08)
        .from('.hero .card', { y: 12, autoAlpha: 0, duration: 0.28, stagger: 0.07 }, 0.12)
        .from('.kpi', { y: 12, autoAlpha: 0, duration: 0.26, stagger: 0.06 }, 0.18)
        .from('.leads-sec', { y: 14, autoAlpha: 0, duration: 0.28 }, 0.26)
        .from('.filter-row .chip', { y: 6, autoAlpha: 0, duration: 0.22, stagger: 0.04 }, 0.34)
        .from('.row-2 .card, .row-3 .card', { y: 14, autoAlpha: 0, duration: 0.28, stagger: 0.07 }, 0.24)
        .from('.feat-list li, .recent-list li', { x: 10, autoAlpha: 0, duration: 0.24, stagger: 0.045 }, 0.4)
        .from('.map-bubble', { autoAlpha: 0, duration: 0.28, stagger: 0.03 }, 0.45);
        countUp($('#kTotal'), S.total || 0); countUp($('#kSite'), S.comSite || 0);
        countUp($('#kAlta'), S.alta || 0); countUp($('#kQual'), S.qualif || 0);
        document.querySelectorAll('[data-w]').forEach(function (t) {
          window.gsap.to(t, { width: t.getAttribute('data-w') + '%', duration: 0.7, ease: 'expo.out', delay: 0.4 });
        });
        drawRings(document);
      }
    }
  }

  /* ---------- busca Ctrl+K com resultados ---------- */
  var search = $('#globalSearch');
  var results = $('#searchResults');
  var srRows = [], srIndex = -1;
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape' && document.activeElement === search) { closeResults(); search.blur(); }
  });
  function closeResults() {
    if (!results) return;
    results.hidden = true;
    srRows = []; srIndex = -1;
    search.setAttribute('aria-expanded', 'false');
  }
  function copyText(txt, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(function () {});
    toast(okMsg, 'ok');
  }
  function srRegion(l) {
    if (l.cat) {
      var i = l.cat.indexOf('·');
      if (i !== -1) { var r = l.cat.slice(i + 1).trim(); if (r) return r; }
    }
    return l.region || l.city || '';
  }
  function srMeta(l) {
    var bits = [];
    if (l.area && l.area !== 'Geral') bits.push(l.area);
    var r = srRegion(l);
    if (r) bits.push(r);
    if (l.site === true || l.website) bits.push('com site');
    return bits.join(' · ');
  }
  function srRating(l) {
    if (typeof l.rating !== 'number' || !isFinite(l.rating)) return 'sem nota';
    var s = String(l.rating).replace('.', ',') + '★';
    if (typeof l.reviews === 'number' && isFinite(l.reviews)) s += ' · ' + fmtInt(l.reviews) + ' avaliações';
    return s;
  }
  function runSearch() {
    var q = norm(search.value.trim());
    if (q.length < 2) { closeResults(); return; }
    var pool = (currentPayload && currentPayload.pool) || [];
    var hits = pool.filter(function (l) {
      return norm(l.name).indexOf(q) !== -1 || norm(l.cat).indexOf(q) !== -1 || norm(l.area).indexOf(q) !== -1 ||
        norm(l.phone_raw).indexOf(q) !== -1 || norm(srRegion(l)).indexOf(q) !== -1;
    }).slice(0, 7);
    srIndex = hits.length ? 0 : -1;
    results.innerHTML = hits.length
      ? hits.map(function (l, i) {
          var acts = '';
          if (l.wa) {
            var waCid = l.id ? ' data-contact-id="' + escapeHtml(l.id) + '"' : '';
            acts += '<a class="sr-act wa" href="' + escapeHtml(l.wa) + '"' + waCid + ' target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp" aria-label="WhatsApp de ' + escapeHtml(l.name) + '">' + WA_SVG + '</a>';
          }
          var igUrl = igHref(l);
          if (igUrl) {
            acts += '<a class="sr-act ig" href="' + escapeHtml(igUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir Instagram" title="Abrir Instagram">' + IG_SVG + '</a>';
          }
          if (l.website) {
            var url = /^https?:/i.test(l.website) ? l.website : 'https://' + l.website;
            acts += '<a class="sr-act" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="Abrir site" aria-label="Site de ' + escapeHtml(l.name) + '">' + SITE_SVG + '</a>';
          }
          return '<div class="sr-item" role="option" data-name="' + escapeHtml(l.name) + '" data-i="' + i + '" aria-selected="' + (i === 0) + '">' +
            '<span class="sr-main"><strong>' + escapeHtml(l.name) + '</strong><span>' + escapeHtml(srRating(l)) + '</span></span>' +
            '<span class="sr-meta">' + escapeHtml(srMeta(l)) + '</span>' +
            '<span class="sr-score">' + (typeof l.score === 'number' ? l.score : '—') + '<span class="sr-only"> potencial</span></span>' +
            '<span class="sr-acts">' + acts + '</span>' +
            '</div>';
        }).join('')
      : '<div class="sr-empty">Nenhum lead encontrado para “' + escapeHtml(search.value.trim()) + '”</div>';
    srRows = [].slice.call(results.querySelectorAll('.sr-item'));
    results.hidden = false;
    search.setAttribute('aria-expanded', 'true');
  }
  function moveSel(delta) {
    if (!srRows.length) return;
    srIndex = (srIndex + delta + srRows.length) % srRows.length;
    srRows.forEach(function (r, i) { r.setAttribute('aria-selected', String(i === srIndex)); });
    srRows[srIndex].scrollIntoView({ block: 'nearest' });
  }
  function pickResult(row) {
    if (!row) return;
    copyText(row.getAttribute('data-name'), 'Nome copiado: ' + row.getAttribute('data-name'));
    closeResults();
    search.value = '';
  }
  if (search && results) {
    search.addEventListener('input', runSearch);
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); pickResult(srRows[srIndex]); }
    });
    results.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.sr-act')) return;
      var row = e.target.closest ? e.target.closest('.sr-item') : null;
      pickResult(row);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (!e.target.closest('.search')) closeResults();
    });
  }

  /* ---------- telas: Visão Geral x Base de Leads ---------- */
  /* entrada de troca: a .view é display:contents (anima-la é inerte) → a animation
     vai nos FILHOS diretos, com stagger 30ms via --view-i. O void offsetWidth entre
     remover e re-adicionar a classe é o que força o restart da animation no mesmo frame */
  function animateViewIn(viewEl) {
    if (!viewEl) return;
    viewEl.classList.remove('view-enter');
    for (var i = 0; i < viewEl.children.length; i++) viewEl.children[i].style.setProperty('--view-i', i);
    void viewEl.offsetWidth; // restaura o kick p/ a nova animation comecar do zero
    viewEl.classList.add('view-enter');
  }
  function showView(v) {
    var d = document.getElementById('viewDashboard');
    var l = document.getElementById('viewLeads');
    if (!d || !l) return;
    d.hidden = v === 'leads';
    l.hidden = v !== 'leads';
    document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
      if (n.hasAttribute('data-scroll')) return; // atalho de ação, não local
      var on = n.getAttribute('data-view') === v;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
    document.querySelectorAll('.viewbar-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === v;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    try { sessionStorage.setItem('vs_view', v); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var t = e.target.closest('[data-view]');
    if (!t) return;
    e.preventDefault();
    var v = t.getAttribute('data-view');
    var viewEl = document.getElementById(v === 'leads' ? 'viewLeads' : 'viewDashboard');
    var wasHidden = !viewEl || viewEl.hidden;
    showView(v);
    if (wasHidden) animateViewIn(viewEl); // só troca real de tela (via clique); boot/restore não anima
    var sel = t.getAttribute('data-scroll');
    if (sel) {
      var target = document.querySelector(sel);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  (function restoreView() {
    var v = null;
    try { v = sessionStorage.getItem('vs_view'); } catch (e) {}
    showView(v === 'leads' ? 'leads' : 'dashboard');
  })();

  /* ---------- Fase B: lift de hover nos cards + pulse único do FAB ---------- */
  /* reveal dos cards: dono único é a timeline GSAP do boot (que ora limpa inline
     transform/opacity ao final) — sem classe CSS de reveal, sem dono duplicado */
  (function rigDashCards() {
    var cards = document.querySelectorAll('#viewDashboard .card');
    for (var i = 0; i < cards.length; i++) cards[i].classList.add('dash-lift');
  })();
  (function fabPulseOnce() {
    if (reduceMotion) return;
    var fab = document.querySelector('.ia-fab');
    if (!fab) { try { sessionStorage.setItem('vs_fab_intro', '1'); } catch (e) {} return; } // flag só com FAB confirmado
    try { if (sessionStorage.getItem('vs_fab_intro')) return; sessionStorage.setItem('vs_fab_intro', '1'); } catch (e) { return; }
    fab.classList.add('fab-pulse');
    setTimeout(function () { fab.classList.remove('fab-pulse'); }, 340);
  })();

  /* ---------- pipeline: marca "contatado" ao abrir o WhatsApp ---------- */
  function markContact(id) {
    fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
      .then(function (r) {
        if (r.ok) toast('Lead marcado como contatado', 'ok');
        else toast('Contato não registrado no banco', 'warn');
      })
      .catch(function () { toast('Contato não registrado (offline?)', 'warn'); });
  }
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var a = e.target.closest('[data-contact-id]');
    if (!a) return;
    var id = a.getAttribute('data-contact-id');
    if (!id || a._vsMarked) return;
    a._vsMarked = true;
    a.classList.add('wa-sent');
    var ctx = a.closest('tr') || a.closest('li');
    var badge = ctx && ctx.querySelector('.badge');
    if (badge) { badge.className = 'badge Contatado'; badge.textContent = 'Contatado'; }
    var qLi = a.closest('#queueList li');
    if (qLi) {
      var row = null;
      document.querySelectorAll('#tblBody [data-contact-id]').forEach(function (wa) {
        if (!row && wa.getAttribute('data-contact-id') === id) row = wa.closest('tr');
      });
      if (row) {
        var rBadge = row.querySelector('.badge');
        if (rBadge) { rBadge.className = 'badge Contatado'; rBadge.textContent = 'Contatado'; }
      }
      qLi.remove();
      var qCard = document.getElementById('queueCard');
      var qSub = document.getElementById('queueSub');
      var qN = document.getElementById('queueList').children.length;
      if (qCard) qCard.hidden = !qN;
      if (qSub) qSub.textContent = qN + (qN === 1 ? ' lead contatável ainda não abordado' : ' leads contatáveis ainda não abordados');
    }
    markContact(id);
  });

  /* ---------- navegação: páginas restantes em breve ---------- */
  document.querySelectorAll('.nav-item').forEach(function (n) {
    n.addEventListener('click', function (e) {
      if (n.hasAttribute('data-view')) return; // telas reais têm handler próprio
      if (n.hasAttribute('data-action')) return; // ações (drawer IA) têm handler próprio
      if (n.classList.contains('active')) return;
      e.preventDefault();
      var label = (n.textContent || '').trim().split('\n')[0];
      toast(label + ' — página em breve');
    });
  });

  /* ---------- IA: drawer retrátil (sidebar + FAB) ---------- */
  var iaDrawer = document.getElementById('iaDrawer');
  var iaBackdrop = document.getElementById('iaBackdrop');
  var iaTriggers = document.querySelectorAll('[data-action="toggle-ia"]');
  var iaLastTrigger = null;
  function iaOpen() { return document.body.classList.contains('ia-open'); }
  function setIaOpen(open, trigger) {
    if (!iaDrawer) return;
    if (open) iaLastTrigger = trigger || document.activeElement;
    document.body.classList.toggle('ia-open', open);
    iaTriggers.forEach(function (t) { t.setAttribute('aria-expanded', String(open)); });
    if (open) {
      var input = $('#aiInput');
      if (input) input.focus({ preventScroll: true });
      var log = $('#chatLog');
      if (log) { log.scrollTop = log.scrollHeight; } // conversa longa reabre na última msg
      var body = iaDrawer.querySelector('.ia-body'); // #chatLog não é o elemento scrollável (o .ia-body é)
      if (body) body.scrollTop = body.scrollHeight;
    } else if (iaLastTrigger && iaLastTrigger.focus) {
      iaLastTrigger.focus({ preventScroll: true });
      iaLastTrigger = null;
    }
  }
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var t = e.target.closest('[data-action="toggle-ia"]');
    if (!t) return;
    e.preventDefault();
    setIaOpen(!iaOpen(), t);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && iaOpen()) setIaOpen(false);
  });
  if (iaBackdrop) iaBackdrop.addEventListener('click', function () { setIaOpen(false); });
  var iaCloseBtn = document.getElementById('iaClose');
  if (iaCloseBtn) iaCloseBtn.addEventListener('click', function () { setIaOpen(false); });

  /* ---------- IA: respondedor local sobre a base real ---------- */
  function aiAnswer(q) {
    var P = currentPayload || {};
    var S = P.stats || {};
    var areas = P.areas || [];
    var top = P.top || [];
    var n = norm(q);
    var areaHit = null;
    (areas || []).forEach(function (a) {
      if (a.value && n.indexOf(norm(a.label).split(' ')[0].slice(0, 7)) !== -1) areaHit = a.label;
    });
    if (areaHit) {
      var a = areas.filter(function (x) { return x.label === areaHit; })[0];
      if (a && a.value) {
        var best = (P.pool || []).filter(function (l) { return l.area === areaHit; })[0];
        return '<strong>' + a.value + ' leads</strong> em ' + escapeHtml(areaHit) + '.' +
          (best ? ' Melhor da área: ' + escapeHtml(best.name) + ' (score ' + best.score + ').' : '');
      }
      return 'Nenhum lead rotulado como <strong>' + escapeHtml(areaHit) + '</strong> na base atual.';
    }
    if (n.indexOf('sem site') !== -1) return '<strong>' + S.semSite + ' leads</strong> não têm site — essa é a maior oportunidade de landing page da base.';
    if (n.indexOf('com site') !== -1 || (n.indexOf('site') !== -1 && n.indexOf('sem') === -1)) return '<strong>' + S.comSite + ' leads</strong> têm site (' + (S.pctSite || 0) + '% da base) e ' + S.semSite + ' não têm.';
    if (n.indexOf('telefone') !== -1 || n.indexOf('whatsapp') !== -1 || n.indexOf('zap') !== -1) return '<strong>' + (S.comPhone || 0) + ' leads</strong> têm telefone válido — contato direto possível agora.';
    if (n.indexOf('alta') !== -1 || n.indexOf('prioridade') !== -1 || n.indexOf('oportunidade') !== -1) return '<strong>' + S.alta + ' leads</strong> estão em alta oportunidade (4,5★+ com 20+ avaliações). Recomendo contatar os 5 primeiros primeiro.';
    if (n.indexOf('qualificad') !== -1) return '<strong>' + S.qualif + ' leads</strong> são oportunidades ideais (telefone + sem site + nota 4,5★+): ' + (S.pctQualif || 0) + '% da base.';
    if (n.indexOf('email') !== -1 || n.indexOf('e-mail') !== -1) return '<strong>' + (S.comEmail || 0) + ' leads</strong> têm e-mail direto capturado — contato com proposta personalizada.';
    if (n.indexOf('instagram') !== -1 || n.indexOf('insta') !== -1) return '<strong>' + (S.comInstagram || 0) + ' leads</strong> têm Instagram no site — alternativa de contato por DM.';
    if (n.indexOf('desde') !== -1 || n.indexOf('anos') !== -1 || n.indexOf('antigo') !== -1) return '<strong>' + (S.desdeAntigo || 0) + ' negócios</strong> estão no ar há 5 anos ou mais — senioridade que valoriza um site profissional.';
    if (n.indexOf('reclam') !== -1) return '<strong>' + (S.naoReclamados || 0) + ' perfis</strong> não foram reclamados no Maps — dono ausente, sinal de oportunidade.';
    if (n.indexOf('top') !== -1 || n.indexOf('melhor') !== -1 || n.indexOf('ranking') !== -1 || n.indexOf('potencial') !== -1) {
      return 'Top 3 por potencial: ' + top.slice(0, 3).map(function (l, i) { return (i + 1) + '. ' + escapeHtml(l.name) + ' (' + l.score + ')'; }).join(' · ');
    }
    if (n.indexOf('captura') !== -1 || n.indexOf('recente') !== -1 || n.indexOf('quando') !== -1) {
      var r = (P.recent || [])[0];
      return r ? 'Última captura: <strong>' + escapeHtml(r.tag) + '</strong> — ' + escapeHtml(r.detail) + ', ' + escapeHtml(r.when) + '.' : 'Nenhuma captura registrada ainda.';
    }
    if (/^(oi|ola|e ai|opa|bom dia|boa tarde|boa noite)/.test(n)) return 'Olá! Base atual: <strong>' + S.total + ' empresas</strong>, ' + S.comSite + ' com site, ' + S.alta + ' em alta. Pergunte “quantos trabalhistas?”, “sem site” ou “top leads”.';
    return 'Resumo da base: <strong>' + S.total + ' empresas</strong>, ' + S.comSite + ' com site, ' + (S.comPhone || 0) + ' com telefone e ' + S.qualif + ' qualificados. Posso detalhar por área — tente “criminal”, “trabalhista” ou “sem site”.';
  }
  function appendUserMsg(text) {
    var el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = '<p>' + escapeHtml(text) + '</p><time>' + hhmm() + '</time>';
    $('#chatLog').appendChild(el);
    return el;
  }
  function appendAssistantMsg(html) {
    var el = document.createElement('div');
    el.className = 'msg assistant';
    el.innerHTML = '<p>' + html + '</p>';
    $('#chatLog').appendChild(el);
    return el;
  }
  var chatHistory = [];
  function chatCaption(src) {
    return src ? ' <em class="ai-src">' + (src === 'groq' ? 'Groq' : 'local') + '</em>' : '';
  }
  function sendChat() {
    var input = $('#aiInput');
    var q = (input.value || '').trim();
    if (!q) return;
    input.value = '';
    appendUserMsg(q);
    chatHistory.push({ role: 'user', text: q });
    var typing = document.createElement('div');
    typing.className = 'msg assistant';
    typing.innerHTML = '<span class="ai-typing" aria-label="Pensando"><i></i><i></i><i></i></span>';
    $('#chatLog').appendChild(typing);
    typing.scrollIntoView({ block: 'nearest' });

    function finish(html, src) {
      chatHistory.push({ role: 'assistant', text: String(html).replace(/<[^>]+>/g, '') });
      typing.innerHTML = '<p>' + html + chatCaption(src) + '</p>';
      typing.scrollIntoView({ block: 'nearest' });
    }
    fetch('/api/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: q, history: chatHistory.slice(0, -1).slice(-6) })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.answer) finish(escapeHtml(d.answer), d.source || 'groq');
        else finish(aiAnswer(q), 'local');
      })
      .catch(function () { finish(aiAnswer(q), 'local'); });
  }
  var aiInput = $('#aiInput'), aiSend = $('#aiSend');
  if (aiInput && aiSend) {
    aiSend.addEventListener('click', sendChat);
    aiInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
  }

  /* ---------- identidade da sessão (topbar) ---------- */
  function emailInitials(email) {
    var parts = String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean);
    var a = parts[0] ? parts[0][0] : '';
    var b = parts[1] ? parts[1][0] : (parts[0] && parts[0][1] ? parts[0][1] : '');
    return (a + b).toUpperCase() || 'VS';
  }
  function loadMe() {
    fetch('/api/me', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) {
        if (!me) return;
        var name = document.getElementById('uName');
        var role = document.getElementById('uRole');
        var av = document.getElementById('uAvatar');
        if (name) name.textContent = me.user;
        var g = document.getElementById('greeting');
        if (g) g.textContent = g.textContent.replace(',', ', ' + String(me.user || '').split('@')[0].split(/[._-]/)[0] + '!');
        if (role) role.textContent = me.role === 'founder' ? 'Fundador' : 'Cofounder';
        if (av) av.textContent = emailInitials(me.user);
      })
      .catch(function () {});
  }

  /* ---------- boot: API ao vivo com fallback estático sob demanda ---------- */
  var EMPTY = { stats: {}, top: [], pool: [], regions: [], ratingBuckets: [], dots: [], series: { days: [], values: [0] }, donut: [], recent: [], areas: [] };
  function boot(payload) {
    currentPayload = payload && payload.stats ? payload : (window.VIRGO_DATA || EMPTY);
    renderTypeSwitch();
    render(currentPayload);
    loadMe();
    pollCapture();
  }
  function bootOfflineFallback(apiFailed) {
    if (apiFailed) {
      try {
        if (!sessionStorage.getItem('vs_fallback_warn')) {
          sessionStorage.setItem('vs_fallback_warn', '1');
          toast('Sem conexão com a API — dados locais de fallback', 'warn');
        }
      } catch (e) {}
      var cc = document.querySelector('.capture-card');
      if (cc) cc.classList.add('stale');
    }
    if (window.VIRGO_DATA) { boot(null); return; }
    var s = document.createElement('script');
    s.src = 'data/leads.js';
    s.onerror = function () { boot(null); };
    s.onload = function () { boot(null); };
    document.head.appendChild(s);
  }
  function loadLeads() {
    fetch('/api/leads?type=' + typeFilter, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { location.href = '/login'; return false; }
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d === false) return;
        if (d) boot(d);
        else bootOfflineFallback(true);
      })
      .catch(function () { bootOfflineFallback(true); });
  }
  if (window.fetch && location.protocol !== 'file:') loadLeads();
  else bootOfflineFallback(false);

  syncTypeUI();
  var typeBox = document.getElementById('typeSwitch');
  if (typeBox) {
    typeBox.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.type-btn') : null;
      if (!b) return;
      var t = b.getAttribute('data-type');
      if (t === typeFilter) return;
      typeFilter = t;
      try { sessionStorage.setItem('vs_type', t); } catch (err) {}
      syncTypeUI();
      loadLeads();
    });
  }
  var capSel = document.getElementById('capCat');
  if (capSel) {
    capSel.addEventListener('change', function () {
      captureCat = capSel.value;
      try { sessionStorage.setItem('vs_capture_cat', captureCat); } catch (err) {}
      syncTypeUI();
    });
  }

  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'capRun') {
      if (capModal) openCaptureModal();
      else startCapture();
    }
  });

  /* ---------- captura: modal NLP ---------- */
  var capModal = document.getElementById('capModal');
  var capPrompt = document.getElementById('capPrompt');
  var capInterpret = document.getElementById('capInterpret');
  var capModalClose = document.getElementById('capModalClose');
  var capErrorEl = document.getElementById('capError');
  var CAP_LOW_SIGNAL = 'Não entendi. Cite o nicho (ex.: tapeçaria) e o lugar (ex.: Águas Claras ou DF).';

  function capShowError(msg) {
    if (!capErrorEl) return;
    capErrorEl.textContent = msg;
    capErrorEl.hidden = false;
  }
  function capClearError() {
    if (!capErrorEl) return;
    capErrorEl.textContent = '';
    capErrorEl.hidden = true;
  }
  function capResetCTA() {
    if (!capInterpret) return;
    capInterpret.disabled = false;
    capInterpret.textContent = 'Interpretar e capturar';
  }
  function closeCaptureModal() {
    if (!capModal) return;
    capModal.hidden = true;
    capClearError();
  }
  function openCaptureModal() {
    if (!capModal) { startCapture(); return; }
    capClearError();
    capResetCTA();
    capModal.hidden = false;
    if (capPrompt) capPrompt.focus();
  }

  if (capModal) {
    capModal.addEventListener('click', function (e) {
      if (e.target === capModal) closeCaptureModal();
    });
    var capChips = capModal.querySelectorAll('.cap-chip');
    for (var ci = 0; ci < capChips.length; ci++) {
      capChips[ci].addEventListener('click', function (e) {
        var chip = e.currentTarget;
        if (capPrompt) { capPrompt.value = chip.textContent; capPrompt.focus(); }
        capClearError();
      });
    }
    if (capModalClose) capModalClose.addEventListener('click', closeCaptureModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !capModal.hidden) closeCaptureModal();
    });
    if (capInterpret) {
      capInterpret.addEventListener('click', function () {
        var prompt = capPrompt ? String(capPrompt.value || '').trim() : '';
        capClearError();
        capInterpret.disabled = true;
        capInterpret.textContent = 'Interpretando...';
        fetch('/api/capture/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt }) })
          .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, status: r.status, b: b }; }); })
          .then(function (res) {
            capResetCTA();
            var b = res.b || {};
            var itp = b.interpretation;
            if (res.ok && b.ok && itp) {
              var job = b.job || { status: 'running', done: 0, total: 0 };
              if (!job.total && itp.queriesTotal) job.total = itp.queriesTotal;
              closeCaptureModal();
              toast('Captura iniciada: ' + itp.label + ' \u00B7 ' + (itp.placeType === 'df' ? 'DF' : (itp.place || 'DF')), 'ok');
              setCaptureUI(job);
              return;
            }
            if (b.error === 'low_signal') { capShowError(CAP_LOW_SIGNAL); return; }
            capShowError(b.error ? String(b.error) : CAP_LOW_SIGNAL);
          })
          .catch(function () {
            capResetCTA();
            capShowError(CAP_LOW_SIGNAL);
          });
      });
    }
  }
})();
