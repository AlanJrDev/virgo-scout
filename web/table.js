/* Virgo Tech — tabela densa da base de leads (Trilha A)
   IIFE independente, carregada antes de app.js. Recebe o payload via
   window.VS_TABLE.render(payload) chamado pelo render() de app.js. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtInt(n) { return (typeof n === 'number' && isFinite(n) ? Math.round(n) : 0).toLocaleString('pt-BR'); }
  function fmtRating(v) { return (typeof v === 'number' && isFinite(v)) ? String(v).replace('.', ',') : ''; }

  /* ---------- leitura defensiva dos campos do lead ---------- */
  function regionOf(l) {
    if (l.region) return String(l.region);
    if (l.city) return String(l.city);
    if (l.cat) {
      var i = l.cat.indexOf('·');
      var r = i === -1 ? '' : l.cat.slice(i + 1).trim();
      if (r) return r;
    }
    if (l.address) {
      var seg = String(l.address).split(',');
      var last = seg[seg.length - 1].trim();
      if (/[A-Za-z\u00C0-\u024F]{3,}/.test(last)) return last.slice(0, 34);
    }
    return '';
  }
  function phoneOf(l) {
    if (l.phone_raw) return String(l.phone_raw);
    if (typeof l.phone === 'string') return l.phone;
    return '';
  }
  function phoneDigits(l) { return phoneOf(l).replace(/\D/g, ''); }
  function hasPhone(l) { return phoneDigits(l).length >= 8 || !!l.wa || l.phone === true; }
  function siteUrl(l) {
    if (typeof l.website === 'string' && l.website) return l.website;
    if (typeof l.site_url === 'string' && l.site_url) return l.site_url;
    return '';
  }
  function hasSite(l) { return !!siteUrl(l) || l.site === true || !!l.website; }
  function capturedTs(l) { var t = Date.parse(l.captured_at); return isFinite(t) ? t : 0; }
  function normPhone(d) {
    if (d.length > 11 && d.slice(0, 2) === '55') d = d.slice(2);
    if (d.length === 12 && d.charAt(0) === '0') d = d.slice(1);
    return d;
  }
  function fmtPhone(p) {
    var d = normPhone(String(p || '').replace(/\D/g, ''));
    if (d.length === 10 || d.length === 11) return d.slice(0, 2) + ' ' + d.slice(2, 7) + '-' + d.slice(7);
    return String(p || '');
  }
  function siteLabel(url) {
    return String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').slice(0, 22);
  }
  function fmtUpdated(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  /* ---------- estado ---------- */
  var state = {
    rows: [], total: 0, updated: '',
    q: '', region: '', area: '', minRating: 0, phone: false, site: false,
    sortKey: '', sortDir: 'asc',
    page: 1, pageSize: 25
  };
  var withCaptured = false;
  var els = {};

  var COLS = [
    { key: 'name', label: 'Empresa', w: 24 },
    { key: 'rating', label: 'Nota / Reviews', w: 12 },
    { key: 'region', label: 'Cidade / Região', w: 15 },
    { key: 'area', label: 'Área', w: 14 },
    { key: 'phone', label: 'Telefone', w: 17 },
    { key: 'site', label: 'Site', w: 8 },
    { key: 'captured', label: 'Capturado em', w: 10, optional: true }
  ];
  var COLS_NO_DATE = [
    { key: 'name', label: 'Empresa', w: 27 },
    { key: 'rating', label: 'Nota / Reviews', w: 14 },
    { key: 'region', label: 'Cidade / Região', w: 18 },
    { key: 'area', label: 'Área', w: 16 },
    { key: 'phone', label: 'Telefone', w: 18 },
    { key: 'site', label: 'Site', w: 7 }
  ];
  function activeCols() { return withCaptured ? COLS : COLS_NO_DATE; }

  /* ---------- filtro / ordenação ---------- */
  function matches(l) {
    if (state.region && regionOf(l) !== state.region) return false;
    if (state.area && (l.area || 'Geral') !== state.area) return false;
    if (state.phone && !hasPhone(l)) return false;
    if (state.site && !hasSite(l)) return false;
    if (state.minRating > 0 && !(typeof l.rating === 'number' && isFinite(l.rating) && l.rating >= state.minRating)) return false;
    if (state.q) {
      var hay = norm([l.name, l.area, regionOf(l), l.cat, phoneOf(l), siteUrl(l)].join(' '));
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }
  function sortVal(l, key) {
    if (key === 'name') return norm(l.name);
    if (key === 'rating') return ((typeof l.rating === 'number' && isFinite(l.rating)) ? l.rating : -1) * 100000 + (l.reviews || 0);
    if (key === 'region') return norm(regionOf(l));
    if (key === 'area') return norm(l.area || 'Geral');
    if (key === 'phone') return phoneDigits(l) || '0';
    if (key === 'site') return hasSite(l) ? 1 : 0;
    if (key === 'captured') return capturedTs(l);
    return 0;
  }
  function isMissing(l, key) {
    if (key === 'rating') return !(typeof l.rating === 'number' && isFinite(l.rating));
    if (key === 'captured') return !capturedTs(l);
    if (key === 'phone') return !hasPhone(l);
    if (key === 'site') return !hasSite(l);
    if (key === 'region') return !regionOf(l);
    if (key === 'area') return !(l.area);
    return !norm(l.name);
  }
  function sortList(list) {
    if (!state.sortKey) return list;
    var key = state.sortKey, dir = state.sortDir === 'desc' ? -1 : 1;
    return list.slice().sort(function (a, b) {
      var ma = isMissing(a, key), mb = isMissing(b, key);
      if (ma !== mb) return ma ? 1 : -1;
      var va = sortVal(a, key), vb = sortVal(b, key);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return norm(a.name) < norm(b.name) ? -1 : norm(a.name) > norm(b.name) ? 1 : 0;
    });
  }
  function filtered() { return state.rows.filter(matches); }
  function hasFilters() {
    return !!(state.q || state.region || state.area || state.minRating || state.phone || state.site);
  }

  /* ---------- células ---------- */
  function nameCell(l) {
    var badge = l.badge ? '<span class="badge ' + esc(l.badge) + '">' + esc(l.badge) + '</span>' : '';
    return '<div class="nm-in"><span class="nm" title="' + esc(l.name) + '">' + esc(l.name) + '</span>' + badge + '</div>';
  }
  function ratingCell(l) {
    var r = fmtRating(l.rating);
    if (!r) return '<span class="cell-none">—</span><span class="sr-only"> sem avaliação</span>';
    var rev = (typeof l.reviews === 'number' && isFinite(l.reviews)) ? l.reviews : null;
    return '<span class="rate">' + r + '<i aria-hidden="true">★</i></span>' +
      '<span class="rev"> · ' + (rev == null ? '—' : fmtInt(rev)) + '</span>' +
      '<span class="sr-only">' + (rev == null ? ' sem resenhas' : ' com ' + fmtInt(rev) + ' avaliações') + '</span>';
  }
  function phoneCell(l) {
    var d = phoneDigits(l);
    if (!d) return '<span class="cell-none">—</span><span class="sr-only"> sem telefone</span>';
    if (l.wa) {
      return '<a class="cell-wa" href="' + esc(l.wa) + '" target="_blank" rel="noopener noreferrer" title="Conversar no WhatsApp" aria-label="Abrir WhatsApp de ' + esc(l.name) + '">' + esc(fmtPhone(d)) + '</a>';
    }
    if (d.length >= 8) {
      return '<a class="cell-tel" href="tel:+55' + esc(normPhone(d)) + '" title="Ligar" aria-label="Ligar para ' + esc(l.name) + '">' + esc(fmtPhone(d)) + '</a>';
    }
    return '<span class="cell-none">' + esc(fmtPhone(d)) + '</span>';
  }
  function siteCell(l) {
    var url = siteUrl(l);
    if (url) {
      var href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
      return '<a class="cell-site" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" title="' + esc(url) + '">' + esc(siteLabel(url)) + '</a>';
    }
    if (hasSite(l)) return '<span class="cell-yes" title="Site informado na base; a URL não veio no payload">Sim</span>';
    return '<span class="cell-none">—</span><span class="sr-only"> sem site</span>';
  }
  function capturedCell(l) {
    var ts = capturedTs(l);
    if (!ts) return '<span class="cell-none">—</span><span class="sr-only"> sem data</span>';
    return '<time datetime="' + esc(String(l.captured_at)) + '">' + fmtDate(ts) + '</time>';
  }
  var CELLS = {
    name: nameCell, rating: ratingCell, region: function (l) {
      var r = regionOf(l);
      return r ? '<span title="' + esc(r) + '">' + esc(r) + '</span>' : '<span class="cell-none">—</span>';
    },
    area: function (l) {
      var a = l.area || 'Geral';
      return '<span title="' + esc(a) + '">' + esc(a) + '</span>';
    },
    phone: phoneCell, site: siteCell, captured: capturedCell
  };

  /* ---------- render ---------- */
  function renderHead() {
    var cols = activeCols();
    var html = '<tr>';
    cols.forEach(function (c) {
      var sort = state.sortKey === c.key ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
      html += '<th scope="col" class="c-' + c.key + '" aria-sort="' + sort + '">' +
        '<button type="button" class="th-sort" data-key="' + c.key + '">' + esc(c.label) +
        '<svg class="sort-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button></th>';
    });
    els.head.innerHTML = html + '</tr>';
    els.cols.innerHTML = cols.map(function (c) { return '<col style="width:' + c.w + '%">'; }).join('');
  }

  function renderSummary() {
    var parts = [];
    if (state.rows.length) {
      parts.push(state.rows.length < state.total
        ? state.rows.length + ' melhores de ' + fmtInt(state.total) + ' leads'
        : fmtInt(state.total) + ' leads');
    } else {
      parts.push('Sem leads nesta categoria');
    }
    if (state.updated) parts.push('atualizado ' + state.updated);
    els.summary.textContent = parts.join(' · ');
  }

  function showEmpty(kind, avail) {
    var title = $('tblEmptyTitle'), text = $('tblEmptyText'), btn = $('tblEmptyClear');
    if (kind === 'base') {
      title.textContent = 'Nenhum lead nesta categoria';
      text.textContent = 'Execute uma captura para começar a preencher a base.';
      btn.hidden = true;
    } else {
      title.textContent = 'Nenhum lead com esses filtros';
      text.textContent = 'Ajuste a busca ou limpe os filtros para ver ' + (avail ? 'os ' + avail + ' leads disponíveis.' : 'a base completa.');
      btn.hidden = false;
    }
    els.table.style.display = 'none';
    els.empty.hidden = false;
  }

  function renderRows() {
    var list = sortList(filtered());
    var pages = Math.max(1, Math.ceil(list.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;
    var start = (state.page - 1) * state.pageSize;
    var slice = list.slice(start, start + state.pageSize);
    var cols = activeCols();

    if (!slice.length) {
      els.body.innerHTML = '';
      showEmpty(state.rows.length ? 'filters' : 'base', state.rows.length);
    } else {
      els.table.style.display = '';
      els.empty.hidden = true;
      els.body.innerHTML = slice.map(function (l) {
        var html = '<tr>';
        cols.forEach(function (c) {
          var cell = CELLS[c.key](l);
          html += c.key === 'name'
            ? '<th scope="row" class="c-name">' + cell + '</th>'
            : '<td class="c-' + c.key + '">' + cell + '</td>';
        });
        return html + '</tr>';
      }).join('');
    }

    var from = list.length ? start + 1 : 0;
    var to = Math.min(start + state.pageSize, list.length);
    var extra = (hasFilters() && list.length !== state.rows.length) || !list.length
      ? ' · <b>' + fmtInt(state.rows.length) + '</b> na base' : '';
    els.count.innerHTML = list.length
      ? 'Exibindo <b>' + from + '–' + to + '</b> de <b>' + fmtInt(list.length) + '</b> leads' + extra
      : 'Nenhum resultado' + extra;
    els.page.textContent = 'Página ' + state.page + ' de ' + pages;
    els.prev.disabled = state.page <= 1;
    els.next.disabled = state.page >= pages;
    els.clear.hidden = !hasFilters();
  }

  /* ---------- filtros ---------- */
  function fillSelect(sel, items, current, allLabel) {
    var html = '<option value="">' + allLabel + '</option>';
    items.forEach(function (it) {
      html += '<option value="' + esc(it.value) + '"' + (it.value === current ? ' selected' : '') + '>' + esc(it.label) + '</option>';
    });
    sel.innerHTML = html;
  }
  function fillFilters() {
    var regions = {}, areas = {};
    state.rows.forEach(function (l) {
      var r = regionOf(l);
      if (r) regions[r] = (regions[r] || 0) + 1;
      var a = l.area || 'Geral';
      areas[a] = (areas[a] || 0) + 1;
    });
    var toItems = function (map) {
      return Object.keys(map).map(function (k) { return { value: k, label: k + ' · ' + map[k] }; })
        .sort(function (a, b) { return b.value.length - a.value.length || (a.value < b.value ? -1 : 1); });
    };
    var regItems = toItems(regions);
    if (state.region && !regItems.some(function (it) { return it.value === state.region; })) state.region = '';
    if (state.area && !Object.prototype.hasOwnProperty.call(areas, state.area)) state.area = '';
    fillSelect(els.region, regItems, state.region, 'Todas as regiões');
    fillSelect(els.area, toItems(areas), state.area, 'Todas as áreas');
  }

  function syncChecks() {
    els.phone.checked = state.phone;
    els.site.checked = state.site;
    document.getElementById('tblPhoneBox').classList.toggle('on', state.phone);
    document.getElementById('tblSiteBox').classList.toggle('on', state.site);
  }

  function clearFilters() {
    state.q = ''; state.region = ''; state.area = ''; state.minRating = 0;
    state.phone = false; state.site = false; state.page = 1;
    els.search.value = '';
    els.minRating.value = '0';
    fillFilters();
    syncChecks();
    renderRows();
    els.search.focus();
  }

  function toggleSort(key) {
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = (key === 'rating' || key === 'captured' || key === 'phone') ? 'desc' : 'asc';
    }
    state.page = 1;
    renderHead();
    renderRows();
  }

  /* ---------- eventos ---------- */
  function bind() {
    els.search.addEventListener('input', function () {
      state.q = norm(els.search.value.trim());
      state.page = 1;
      renderRows();
    });
    els.search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { els.search.value = ''; state.q = ''; state.page = 1; renderRows(); }
    });
    els.region.addEventListener('change', function () { state.region = els.region.value; state.page = 1; renderRows(); });
    els.area.addEventListener('change', function () { state.area = els.area.value; state.page = 1; renderRows(); });
    els.minRating.addEventListener('change', function () { state.minRating = parseFloat(els.minRating.value) || 0; state.page = 1; renderRows(); });
    els.phone.addEventListener('change', function () { state.phone = els.phone.checked; state.page = 1; syncChecks(); renderRows(); });
    els.site.addEventListener('change', function () { state.site = els.site.checked; state.page = 1; syncChecks(); renderRows(); });
    els.pageSize.addEventListener('change', function () {
      state.pageSize = parseInt(els.pageSize.value, 10) || 25;
      state.page = 1;
      renderRows();
    });
    els.prev.addEventListener('click', function () { if (state.page > 1) { state.page--; renderRows(); els.scroll.scrollTop = 0; } });
    els.next.addEventListener('click', function () { state.page++; renderRows(); els.scroll.scrollTop = 0; });
    els.head.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.th-sort') : null;
      if (b) toggleSort(b.getAttribute('data-key'));
    });
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('#tblClear') || e.target.closest('#tblEmptyClear')) clearFilters();
    });
  }

  /* ---------- API pública ---------- */
  function render(P) {
    if (!els.root) return;
    state.rows = (P && P.pool) || [];
    state.total = (P && P.stats && typeof P.stats.total === 'number') ? P.stats.total : state.rows.length;
    state.updated = P && P.generated_at ? fmtUpdated(P.generated_at) : '';
    state.page = 1;
    withCaptured = state.rows.some(function (l) { return !!l.captured_at; });
    fillFilters();
    syncChecks();
    renderHead();
    renderSummary();
    renderRows();
  }

  els = {
    root: $('leadsSection'), table: $('leadTable'), cols: $('tblCols'), head: $('tblHead'), body: $('tblBody'),
    empty: $('tblEmpty'), count: $('tblCount'), page: $('tblPage'), prev: $('tblPrev'), next: $('tblNext'),
    search: $('tblSearch'), region: $('tblRegion'), area: $('tblArea'), minRating: $('tblMinRating'),
    phone: $('tblHasPhone'), site: $('tblHasSite'), clear: $('tblClear'), pageSize: $('tblPageSize'),
    summary: $('tblSummary'), scroll: $('tblScroll')
  };
  if (els.root && els.head && els.search) bind();

  window.VS_TABLE = { render: render };
})();
