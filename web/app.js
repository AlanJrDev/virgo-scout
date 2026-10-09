/* Virgo Tech dashboard — dados ao vivo (/api/leads) + motion GSAP (momento único de entrada) */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGsap = typeof window.gsap !== 'undefined' && !reduceMotion;
  var $ = function (s, c) { return (c || document).querySelector(s); };

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function hhmm() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fmtInt(n) { return (typeof n === 'number' && isFinite(n) ? Math.round(n) : 0).toLocaleString('pt-BR'); }

  var WA_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>';
  var SITE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 4 5.6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.6-4-9s1.5-6.4 4-9z"/></svg>';

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
  var category = 'advogados';
  try { if (sessionStorage.getItem('vs_category') === 'arquitetura') category = 'arquitetura'; } catch (e) {}
  function syncCatUI() {
    var box = document.querySelector('.cat-switch');
    if (box) {
      var btns = box.querySelectorAll('.cat-btn');
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].getAttribute('data-cat') === category;
        btns[i].classList.toggle('active', on);
        btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    var t = document.getElementById('capTitle');
    if (t) t.textContent = 'Captura — ' + (category === 'arquitetura' ? 'Arquitetura' : 'Advocacia');
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
    fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: category }) })
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
  function renderQuality(q) {
    var row = document.getElementById('qualityRow');
    if (!row) return;
    var chips = [];
    function n(v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : null; }
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
    renderQuality(D.quality);

    /* destaques + filtro por área */
    var pool = D.pool && D.pool.length ? D.pool : (D.top || []);
    var activeArea = '';
    function waBtn(l) {
      if (l.wa) {
        var cid = l.id ? ' data-contact-id="' + escapeHtml(l.id) + '"' : '';
        return '<a class="wa-btn" href="' + escapeHtml(l.wa) + '"' + cid + ' target="_blank" rel="noopener noreferrer" aria-label="Conversar no WhatsApp com ' + escapeHtml(l.name) + '" title="Abrir WhatsApp">' + WA_SVG + '</a>';
      }
      return '<span class="wa-btn disabled" role="img" aria-label="Sem telefone na base" title="Sem telefone na base">' + WA_SVG + '</span>';
    }
    function featRows(area) {
      var rows = pool.filter(function (l) { return !area || l.area === area; }).slice(0, 5);
      $('#featList').innerHTML = rows.map(function (l) {
        return '<li data-area="' + escapeHtml(l.area) + '"><span class="feat-ava"><svg viewBox="0 0 24 24"><path d="M4 21V8l6-5v18"/><path d="M10 21V12l8-4v13"/><path d="M2 21h20"/></svg></span>' +
          '<div class="feat-info"><strong>' + escapeHtml(l.name) + '</strong><span>' + escapeHtml(l.cat) + '</span></div>' +
          ring(l.score) + '<span class="badge ' + l.badge + '">' + l.badge + '</span>' +
          waBtn(l) +
          '<button class="kebab" data-copy="' + escapeHtml(l.name) + '" aria-label="Copiar nome do lead" title="Copiar nome">⋮</button></li>';
      }).join('') || '<li class="feat-empty">Nenhum lead nesta área</li>';
      bindCopy();
      drawRings($('#featList'));
    }
    function bindCopy() {
      document.querySelectorAll('[data-copy]').forEach(function (b) {
        if (b._bound) return; b._bound = true;
        b.addEventListener('click', function () {
          if (navigator.clipboard) navigator.clipboard.writeText(b.getAttribute('data-copy')).catch(function () {});
          toast('Nome copiado', 'ok');
          if (hasGsap) window.gsap.fromTo(b, { scale: 0.8 }, { scale: 1, duration: 0.16, ease: 'expo.out' });
        });
      });
    }
    var areas = (D.areas || []).filter(function (a) { return a.label !== 'Geral'; }).slice(0, 5);
    var fRow = $('#areaFilter');
    if (fRow && areas.length) {
      fRow.innerHTML = ['<button class="chip active" type="button" data-area="">Todas</button>']
        .concat(areas.map(function (a) {
          return '<button class="chip" type="button" data-area="' + escapeHtml(a.label) + '">' + escapeHtml(a.label) + ' <b>' + a.value + '</b></button>';
        })).join('');
      fRow.querySelectorAll('.chip').forEach(function (c) {
        c.addEventListener('click', function () {
          fRow.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active'); });
          c.classList.add('active');
          activeArea = c.getAttribute('data-area') || '';
          featRows(activeArea);
        });
      });
    }
    featRows('');

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
      var list = chartData[key] || [];
      var host = $('#barsChart');
      if (!host) return;
      var sum = list.reduce(function (a, x) { return a + (x.value || 0); }, 0);
      var max = Math.max.apply(null, list.map(function (x) { return x.value; }).concat([1]));
      host.innerHTML = list.map(function (x, i) {
        var pct = sum ? Math.round((100 * (x.value || 0)) / sum) : 0;
        var sub = pct + '%' + (x.sub ? ' · ' + x.sub : '');
        return '<div class="bar-row" role="img" aria-label="' + escapeHtml(x.label) + ': ' + x.value + ' (' + pct + '%)" style="animation-delay:' + (i * 45) + 'ms" title="' + escapeHtml(x.label) + ': ' + x.value + ' (' + pct + '%)">' +
          '<span class="bar-label">' + escapeHtml(x.label) + '</span>' +
          '<div class="bar-track"><i class="bar-fill" data-frac="' + (x.value / max).toFixed(3) + '" style="transition-delay:' + (i * 45) + 'ms"></i></div>' +
          '<span class="bar-val">' + x.value + '<small>' + sub + '</small></span>' +
          '</div>';
      }).join('') || emptyBox('Sem dados para este recorte', 'Os números desta aba aparecem quando a categoria tem leads.');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          host.querySelectorAll('.bar-fill').forEach(function (f) {
            f.style.transform = 'scaleX(' + f.getAttribute('data-frac') + ')';
          });
        });
      });
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
    var NS = 'http://www.w3.org/2000/svg';
    var donut = $('#donut'), R = 54, CC = 2 * Math.PI * R;
    var donutData = (D.donut || []).filter(function (s) { return s && s.value > 0; });
    if (donut) donut.innerHTML = '';
    $('#donutTotal').textContent = fmtInt(S.total || 0);
    if (!donutData.length) {
      $('#donutLegend').innerHTML = '<li class="empty-box"><strong>Sem composição ainda</strong><p>Os segmentos aparecem quando a categoria tem leads.</p></li>';
    } else {
      var acc = 0;
      var donutSum = donutData.reduce(function (a, x) { return a + x.value; }, 0) || 1;
      donutData.forEach(function (s) {
        var frac = s.value / donutSum;
        var pct = Math.round((100 * s.value) / (S.total || 1));
        var c = document.createElementNS(NS, 'circle');
        [['cx', 70], ['cy', 70], ['r', R], ['fill', 'none'], ['stroke', s.color], ['stroke-width', 13],
         ['stroke-dasharray', (frac * CC).toFixed(1) + ' ' + CC.toFixed(1)],
         ['stroke-dashoffset', (-acc * CC).toFixed(1)], ['transform', 'rotate(-90 70 70)'], ['data-donut', '1']].forEach(function (a) { c.setAttribute(a[0], a[1]); });
        var t = document.createElementNS(NS, 'title');
        t.textContent = s.label + ': ' + fmtInt(s.value) + ' (' + pct + '%)';
        c.appendChild(t);
        if (donut) donut.appendChild(c);
        acc += frac;
      });
      $('#donutLegend').innerHTML = donutData.map(function (s) {
        var pct = Math.round((100 * s.value) / (S.total || 1));
        return '<li><i style="background:' + s.color + '"></i>' + escapeHtml(s.label) + '<b>' + fmtInt(s.value) + ' <span style="color:var(--faint)">(' + pct + '%)</span></b></li>';
      }).join('');
    }

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
      var tl = window.gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.from('.sidebar', { x: -16, autoAlpha: 0, duration: 0.28 })
        .from('.topbar', { y: -12, autoAlpha: 0, duration: 0.26 }, 0.05)
        .from('.greet', { y: 10, autoAlpha: 0, duration: 0.26 }, 0.08)
        .from('.hero .card', { y: 12, autoAlpha: 0, duration: 0.28, stagger: 0.07 }, 0.12)
        .from('.kpi', { y: 12, autoAlpha: 0, duration: 0.26, stagger: 0.06 }, 0.18)
        .from('.leads-sec', { y: 14, autoAlpha: 0, duration: 0.28 }, 0.26)
        .from('.filter-row .chip', { y: 6, autoAlpha: 0, duration: 0.22, stagger: 0.04 }, 0.34)
        .from('.row-2 .card, .row-3 .card', { y: 14, autoAlpha: 0, duration: 0.28, stagger: 0.07 }, 0.24)
        .from('.ia > *', { x: 14, autoAlpha: 0, duration: 0.26, stagger: 0.06 }, 0.2)
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
  function showView(v) {
    var d = document.getElementById('viewDashboard');
    var l = document.getElementById('viewLeads');
    if (!d || !l) return;
    d.hidden = v === 'leads';
    l.hidden = v !== 'leads';
    document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
      var on = n.getAttribute('data-view') === v;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
    document.querySelectorAll('.viewbar-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === v);
    });
    try { sessionStorage.setItem('vs_view', v); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var t = e.target.closest('[data-view]');
    if (!t) return;
    e.preventDefault();
    showView(t.getAttribute('data-view'));
  });
  (function restoreView() {
    var v = null;
    try { v = sessionStorage.getItem('vs_view'); } catch (e) {}
    showView(v === 'leads' ? 'leads' : 'dashboard');
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
    markContact(id);
  });

  /* ---------- navegação: páginas restantes em breve ---------- */
  document.querySelectorAll('.nav-item').forEach(function (n) {
    n.addEventListener('click', function (e) {
      if (n.hasAttribute('data-view')) return; // telas reais têm handler próprio
      if (n.classList.contains('active')) return;
      e.preventDefault();
      var label = (n.textContent || '').trim().split('\n')[0];
      toast(label + ' — página em breve');
    });
  });

  /* ---------- IA: respondedor local sobre a base real ---------- */
  function aiAnswer(q) {
    var P = currentPayload || {};
    var S = P.stats || {};
    var areas = P.areas || [];
    var top = P.top || [];
    var n = norm(q);
    var areaHit = null;
    var nq = norm(q);
    (areas || []).forEach(function (a) {
      if (a.value && nq.indexOf(norm(a.label).split(' ')[0].slice(0, 7)) !== -1) areaHit = a.label;
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
      body: JSON.stringify({ q: q, history: chatHistory.slice(0, -1).slice(-6), category: category })
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
    fetch('/api/leads?category=' + category, { cache: 'no-store' })
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

  syncCatUI();
  var catBox = document.querySelector('.cat-switch');
  if (catBox) {
    catBox.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.cat-btn') : null;
      if (!b) return;
      var cat = b.getAttribute('data-cat');
      if (cat !== 'advogados' && cat !== 'arquitetura') return;
      if (cat === category) return;
      category = cat;
      try { sessionStorage.setItem('vs_category', cat); } catch (err) {}
      syncCatUI();
      loadLeads();
    });
  }

  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'capRun') startCapture();
  });
})();
