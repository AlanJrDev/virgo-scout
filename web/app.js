/* Virgo Tech dashboard — dados reais + motion GSAP (momento único de entrada) */
(function () {
  'use strict';
  var D = window.VIRGO_DATA || { stats: {}, top: [], dots: [], series: { days: [], values: [] }, donut: [], recent: [] };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGsap = typeof window.gsap !== 'undefined' && !reduceMotion;
  var $ = function (s, c) { return (c || document).querySelector(s); };

  /* ---------- saudação / relógio ---------- */
  var h = new Date().getHours();
  $('#greeting').textContent = (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + ', Alan!';
  var now = new Date();
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var days = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  $('#todayLine').textContent = days[now.getDay()] + ', ' + now.getDate() + ' de ' + months[now.getMonth()] + ' de ' + now.getFullYear();
  function tick() {
    var d = new Date();
    $('#clockLine').textContent = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  tick(); setInterval(tick, 15000);

  /* ---------- KPIs ---------- */
  var S = D.stats;
  $('#capSub').textContent = 'Brasília/DF · ' + (S.total || 0) + ' empresas';
  $('#capPct').textContent = '68%';
  $('#kSiteSub').textContent = (S.pctSite || 0) + '% do total';
  $('#kAltaSub').textContent = (S.pctAlta || 0) + '% do total';
  $('#kQualSub').textContent = (S.pctQualif || 0) + '% do total';

  function countUp(el, target) {
    if (!hasGsap) { el.textContent = target; return; }
    var o = { v: 0 };
    window.gsap.to(o, { v: target, duration: 0.9, ease: 'expo.out', onUpdate: function () { el.textContent = Math.round(o.v); } });
  }

  /* ---------- anel de score ---------- */
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

  /* ---------- destaques ---------- */
  $('#featList').innerHTML = D.top.map(function (l) {
    return '<li><span class="feat-ava"><svg viewBox="0 0 24 24"><path d="M4 21V8l6-5v18"/><path d="M10 21V12l8-4v13"/><path d="M2 21h20"/></svg></span>' +
      '<div class="feat-info"><strong>' + escapeHtml(l.name) + '</strong><span>' + escapeHtml(l.cat) + '</span></div>' +
      ring(l.score) + '<span class="badge ' + l.badge + '">' + l.badge + '</span>' +
      '<button class="kebab" data-copy="' + escapeHtml(l.name) + '" aria-label="Copiar nome do lead" title="Copiar nome">⋮</button></li>';
  }).join('');
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(b.getAttribute('data-copy')).catch(function () {});
      if (hasGsap) window.gsap.fromTo(b, { scale: 0.8 }, { scale: 1, duration: 0.16, ease: 'expo.out' });
    });
  });

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- IA: top 3 ---------- */
  function describe(l) {
    var parts = [];
    if (l.rating) parts.push('reputação ' + String(l.rating).replace('.', ',') + '★' + (l.reviews ? ' com ' + l.reviews + ' avaliações' : ''));
    parts.push(l.site ? 'site profissional' : 'sem site detectado');
    parts.push(l.phone ? 'telefone captado' : 'sem telefone');
    return cap(parts.join(', ')) + '. Alta probabilidade de interesse em soluções digitais.';
  }
  $('#aiList').innerHTML = D.top.slice(0, 3).map(function (l) {
    return '<li><div class="ai-lead-head"><strong>' + escapeHtml(l.name) + '</strong>' + ring(l.score) + '</div><p>' + escapeHtml(describe(l)) + '</p></li>';
  }).join('');

  /* ---------- legenda do mapa ---------- */
  var legend = [
    { label: 'Total', value: S.total || 0, color: '#38bdf8' },
    { label: 'Com site', value: S.comSite || 0, color: '#2e7cf6' },
    { label: 'Sem site', value: S.semSite || 0, color: '#7dd3fc' },
    { label: 'Alta prioridade', value: S.alta || 0, color: '#f87171' }
  ];
  $('#mapLegend').innerHTML = legend.map(function (l) {
    return '<li><i style="background:' + l.color + '"></i>' + l.label + '<b>' + l.value + '</b></li>';
  }).join('');

  /* ---------- mapa estilizado ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  var map = $('#leadMap');
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    (parent || map).appendChild(n);
    return n;
  }
  el('rect', { x: 0, y: 0, width: 600, height: 330, fill: '#060c18' });
  var streets = ['M0,60 L600,40', 'M0,120 L600,110', 'M0,190 L600,200', 'M0,260 L600,250', 'M80,0 L60,330', 'M200,0 L210,330', 'M330,0 L320,330', 'M460,0 L470,330', 'M0,150 C150,130 250,180 400,150 S550,160 600,150', 'M100,0 C120,100 90,220 130,330'];
  streets.forEach(function (d) { el('path', { d: d, stroke: 'rgba(90,130,200,.13)', 'stroke-width': 1.2, fill: 'none' }); });
  var river = el('path', { d: 'M0,300 C120,280 220,310 340,290 S520,300 600,285', stroke: 'rgba(56,189,248,.16)', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' });
  var label1 = el('text', { x: 300, y: 150, 'text-anchor': 'middle', fill: 'rgba(200,215,235,.5)', 'font-size': 17, 'font-weight': 600 }); label1.textContent = 'Brasília';
  var label2 = el('text', { x: 300, y: 205, 'text-anchor': 'middle', fill: 'rgba(200,215,235,.32)', 'font-size': 15 }); label2.textContent = 'Brasília';
  D.dots.forEach(function (p, i) {
    var g = el('g', { class: 'map-dot' + (p.hot ? ' hot' : ''), transform: 'translate(' + (p.x * 6) + ',' + (p.y * 3.3) + ')' });
    el('circle', { r: p.hot ? 9 : 6, fill: 'rgba(56,189,248,.18)' }, g);
    el('circle', { r: p.hot ? 3.6 : 2.6, fill: '#38bdf8' }, g);
    if (p.hot) { var h = el('circle', { r: 3.6, fill: 'none', stroke: '#38bdf8', 'stroke-width': 1, opacity: .7 }, g); h.classList.add('ping'); }
  });

  /* ---------- evolução (linha) ---------- */
  var evo = $('#evoLine');
  var vals = D.series.values, maxV = Math.max.apply(null, vals.concat([200]));
  var W = 420, H = 190, PL = 34, PB = 24, PT = 10;
  function X(i) { return PL + (i * (W - PL - 10)) / (vals.length - 1); }
  function Y(v) { return PT + (H - PT - PB) * (1 - v / (maxV * 1.08)); }
  var NS2 = NS;
  function e2(tag, attrs) { var n = document.createElementNS(NS2, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); evo.appendChild(n); return n; }
  var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return Math.round((maxV * f) / 10) * 10; });
  ticks.forEach(function (t) {
    e2('line', { x1: PL, y1: Y(t), x2: W - 4, y2: Y(t), stroke: 'rgba(120,160,255,.10)' });
    var tx = e2('text', { x: 4, y: Y(t) + 4, fill: '#5b6b85', 'font-size': 10 }); tx.textContent = t >= 1000 ? (t / 1000).toFixed(1) + 'k' : t;
  });
  var d = 'M' + X(0).toFixed(1) + ',' + Y(vals[0]).toFixed(1);
  for (var i = 1; i < vals.length; i++) {
    var x0 = X(i - 1), y0 = Y(vals[i - 1]), x1 = X(i), y1 = Y(vals[i]), mx = (x0 + x1) / 2;
    d += ' C' + mx.toFixed(1) + ',' + y0.toFixed(1) + ' ' + mx.toFixed(1) + ',' + y1.toFixed(1) + ' ' + x1.toFixed(1) + ',' + y1.toFixed(1);
  }
  e2('path', { d: d + ' L' + X(vals.length - 1).toFixed(1) + ',' + (H - PB) + ' L' + X(0).toFixed(1) + ',' + (H - PB) + ' Z', fill: 'url(#areaGrad)' });
  var line = e2('path', { d: d, fill: 'none', stroke: '#38bdf8', 'stroke-width': 2.2, 'stroke-linecap': 'round', id: 'evoPath' });
  var endDot = e2('circle', { cx: X(vals.length - 1), cy: Y(vals[vals.length - 1]), r: 4, fill: '#38bdf8', id: 'evoDot' });
  D.series.days.forEach(function (day, j) { var t = e2('text', { x: X(j), y: H - 6, 'text-anchor': 'middle', fill: '#5b6b85', 'font-size': 10 }); t.textContent = day; });

  /* ---------- donut ---------- */
  var donut = $('#donut'), R = 54, CC = 2 * Math.PI * R;
  var tot3 = D.donut.reduce(function (a, s) { return a + s.value; }, 0) || 1;
  var acc = 0;
  D.donut.forEach(function (s) {
    var frac = s.value / tot3;
    var c = document.createElementNS(NS, 'circle');
    [['cx', 70], ['cy', 70], ['r', R], ['fill', 'none'], ['stroke', s.color], ['stroke-width', 13],
     ['stroke-dasharray', (frac * CC).toFixed(1) + ' ' + CC.toFixed(1)],
     ['stroke-dashoffset', (-acc * CC).toFixed(1)], ['transform', 'rotate(-90 70 70)'], ['data-donut', '1']].forEach(function (a) { c.setAttribute(a[0], a[1]); });
    donut.appendChild(c);
    acc += frac;
  });
  $('#donutTotal').textContent = S.total || 0;
  $('#donutLegend').innerHTML = D.donut.map(function (s) {
    var pct = Math.round((100 * s.value) / (S.total || 1));
    return '<li><i style="background:' + s.color + '"></i>' + s.label + '<b>' + s.value + ' <span style="color:var(--faint)">(' + pct + '%)</span></b></li>';
  }).join('');

  /* ---------- recentes ---------- */
  var icons = {
    active: '<svg viewBox="0 0 24 24"><path d="M12 3v10"/><path d="m8 9 4-4 4 4"/><path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/></svg>',
    done: '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>'
  };
  $('#recentList').innerHTML = D.recent.map(function (r) {
    var inner = r.status === 'active'
      ? '<span>' + escapeHtml(r.detail.split('·')[0].trim() + ' ·') + '</span><span class="track"><i data-w="68"></i></span>'
      : '<span>' + escapeHtml(r.detail) + '</span>';
    return '<li><span class="rec-ico ' + r.status + '">' + icons[r.status] + '</span>' +
      '<div class="rec-info"><strong>' + escapeHtml(r.tag) + '</strong>' + inner + '</div>' +
      '<span class="rec-when">' + escapeHtml(r.when) + '</span></li>';
  }).join('');

  /* ---------- motion: momento único de entrada ---------- */
  function finalStates() {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var map = { kTotal: S.total, kSite: S.comSite, kAlta: S.alta, kQual: S.qualif };
      el.textContent = map[el.id] || 0;
    });
    var bar = $('#capBar'); if (bar) bar.style.width = '68%';
    drawRings(document);
    document.querySelectorAll('[data-w]').forEach(function (t) { t.style.width = t.getAttribute('data-w') + '%'; });
  }
  if (!hasGsap) { finalStates(); }
  else {
    var tl = window.gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from('.sidebar', { x: -16, autoAlpha: 0, duration: 0.28 })
      .from('.topbar', { y: -12, autoAlpha: 0, duration: 0.26 }, 0.05)
      .from('.greet', { y: 10, autoAlpha: 0, duration: 0.26 }, 0.08)
      .from('.hero .card', { y: 12, autoAlpha: 0, duration: 0.28, stagger: 0.07 }, 0.12)
      .from('.kpi', { y: 12, autoAlpha: 0, duration: 0.26, stagger: 0.06 }, 0.18)
      .from('.row-2 .card, .row-3 .card', { y: 14, autoAlpha: 0, duration: 0.28, stagger: 0.07 }, 0.24)
      .from('.ia > *', { x: 14, autoAlpha: 0, duration: 0.26, stagger: 0.06 }, 0.2)
      .from('.feat-list li, .recent-list li', { x: 10, autoAlpha: 0, duration: 0.24, stagger: 0.045 }, 0.4)
      .from('.map-dot', { scale: 0.3, autoAlpha: 0, duration: 0.3, stagger: 0.025, transformOrigin: 'center' }, 0.45);
    countUp($('#kTotal'), S.total || 0); countUp($('#kSite'), S.comSite || 0);
    countUp($('#kAlta'), S.alta || 0); countUp($('#kQual'), S.qualif || 0);
    window.gsap.to('#capBar', { width: '68%', duration: 0.8, ease: 'expo.out', delay: 0.3 });
    document.querySelectorAll('[data-w]').forEach(function (t) {
      window.gsap.to(t, { width: t.getAttribute('data-w') + '%', duration: 0.7, ease: 'expo.out', delay: 0.4 });
    });
    drawRings(document);
    try {
      var len = line.getTotalLength();
      line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
      window.gsap.to(line.style, { strokeDashoffset: 0, duration: 0.9, ease: 'expo.out', delay: 0.35 });
      window.gsap.from(endDot, { scale: 0, transformOrigin: 'center', duration: 0.3, delay: 1.1 });
    } catch (e) { /* SVG sem getTotalLength: mantém visível */ }
  }

  /* ---------- busca Ctrl+K ---------- */
  var search = $('#globalSearch');
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape' && document.activeElement === search) search.blur();
  });
  search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    document.querySelectorAll('#featList li').forEach(function (li) {
      li.style.display = !q || li.textContent.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
    });
  });
})();
