/* Virgo Tech — tabela densa da base de leads (Trilha A)
   IIFE independente, carregada antes de app.js. Recebe o payload via
   window.VS_TABLE.render(payload) chamado pelo render() de app.js. */
(function () {
  'use strict';

  var hasGsap = typeof window.gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  function typesOf(l) { return (l.types && l.types.length ? l.types : ['advogados']).slice().sort(function (a, b) { return TIPO_ORDER.indexOf(a) - TIPO_ORDER.indexOf(b); }); }
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
  function hasChannel(l) { return hasPhone(l) || !!l.email || !!l.instagram; }
  function channelCount(l) {
    var n = 0;
    if (hasSite(l)) n++;
    if (l.instagram) n++;
    if (l.email) n++;
    if (l.wa) n++;
    return n;
  }
  function capturedTs(l) { var t = Date.parse(l.captured_at); return isFinite(t) ? t : 0; }
  function normPhone(d) {
    if (d.length > 11 && d.slice(0, 2) === '55') d = d.slice(2);
    if (d.length === 12 && d.charAt(0) === '0') d = d.slice(1);
    return d;
  }
  function fmtPhone(p) {
    var d = normPhone(String(p || '').replace(/\D/g, ''));
    if (d.length === 10) return d.slice(0, 2) + ' ' + d.slice(2, 6) + '-' + d.slice(6);
    if (d.length === 11) return d.slice(0, 2) + ' ' + d.slice(2, 7) + '-' + d.slice(7);
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
    q: '', region: '', area: '', minRating: 0, phone: false, noSite: false, status: '',
    sortKey: '', sortDir: 'asc',
    page: 1, pageSize: 25
  };
  var withCaptured = false;
  var withSince = false;
  var firstRender = true;
  var els = {};

  var TIPO_LABEL = { advogados: 'Advogado', arquitetura: 'Arquitetura', tapecaria: 'Tapeçaria', estofado: 'Estofado' };
  var TIPO_ORDER = ['advogados', 'arquitetura', 'tapecaria', 'estofado'];

  var COLS = [
    { key: 'name', label: 'Empresa', w: 22 },
    { key: 'rating', label: 'Nota / Reviews', w: 11 },
    { key: 'region', label: 'Cidade / Região', w: 13 },
    { key: 'area', label: 'Área', w: 12 },
    { key: 'tipo', label: 'Tipo', w: 10 },
    { key: 'phone', label: 'Telefone', w: 16 },
    { key: 'channels', label: 'Canais', w: 13 },
    { key: 'since', label: 'Desde', w: 7, optional: true },
    { key: 'captured', label: 'Capturado em', w: 10, optional: true }
  ];
  function activeCols() {
    return COLS.filter(function (c) {
      if (c.optional) return c.key === 'captured' ? withCaptured : withSince;
      return true;
    });
  }

  /* ---------- filtro / ordenação ---------- */
  function matches(l) {
    if (state.region && regionOf(l) !== state.region) return false;
    if (state.area && (l.area || 'Geral') !== state.area) return false;
    if (state.phone && !hasChannel(l)) return false;
    if (state.noSite && hasSite(l)) return false;
    if (state.status && (l.status || 'novo') !== state.status) return false;
    if (state.minRating > 0 && !(typeof l.rating === 'number' && isFinite(l.rating) && l.rating >= state.minRating)) return false;
    if (state.q) {
      var tipoLabels = typesOf(l).map(function (t) { return TIPO_LABEL[t] || t; }).join(' ');
      var hay = norm([l.name, l.area, regionOf(l), l.cat, phoneOf(l), siteUrl(l), l.email, l.instagram, tipoLabels].join(' '));
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }
  function sortVal(l, key) {
    if (key === 'name') return norm(l.name);
    if (key === 'rating') return ((typeof l.rating === 'number' && isFinite(l.rating)) ? l.rating : -1) * 100000 + (l.reviews || 0);
    if (key === 'region') return norm(regionOf(l));
    if (key === 'area') return norm(l.area || 'Geral');
    if (key === 'tipo') return norm(TIPO_LABEL[typesOf(l)[0]] || typesOf(l)[0]);
    if (key === 'phone') return phoneDigits(l) || '0';
    if (key === 'channels') return channelCount(l);
    if (key === 'since') return l.since_year || 0;
    if (key === 'captured') return capturedTs(l);
    return 0;
  }
  function isMissing(l, key) {
    if (key === 'rating') return !(typeof l.rating === 'number' && isFinite(l.rating));
    if (key === 'captured') return !capturedTs(l);
    if (key === 'phone') return !hasPhone(l);
    if (key === 'channels') return channelCount(l) === 0;
    if (key === 'since') return !l.since_year;
    if (key === 'region') return !regionOf(l);
    if (key === 'area') return !(l.area);
    if (key === 'tipo') return false;
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
    return !!(state.q || state.region || state.area || state.minRating || state.phone || state.noSite || state.status);
  }

  /* ---------- células ---------- */
  var CH_SVG = {
    site: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="3.8"/><circle cx="16.8" cy="7.2" r="1.1" fill="currentColor" stroke="none"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 5.5 8.5-5.5"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16.5v2.6a1.9 1.9 0 0 1-2.1 1.9 18.8 18.8 0 0 1-8.2-2.9 18.5 18.5 0 0 1-5.7-5.7A18.8 18.8 0 0 1 2.1 4.1 1.9 1.9 0 0 1 4 2h2.6a1.9 1.9 0 0 1 1.9 1.6c.1.9.3 1.8.7 2.7a1.9 1.9 0 0 1-.4 2L7.7 9.4a15 15 0 0 0 6.9 6.9l1.1-1.1a1.9 1.9 0 0 1 2-.4c.9.4 1.8.6 2.7.7a1.9 1.9 0 0 1 1.6 1.9z"/></svg>'
  };
  function nameCell(l) {
    var badge = '';
    if (l.status && l.status !== 'novo') {
      var st = esc(String(l.status).charAt(0).toUpperCase() + String(l.status).slice(1));
      badge = '<span class="badge Contatado">' + st + '</span>';
    } else if (l.badge) {
      badge = '<span class="badge ' + esc(l.badge) + '">' + esc(l.badge) + '</span>';
    }
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
      var cid = l.id ? ' data-contact-id="' + esc(l.id) + '"' : '';
      return '<a class="cell-wa" href="' + esc(l.wa) + '"' + cid + ' target="_blank" rel="noopener noreferrer" title="Conversar no WhatsApp" aria-label="Abrir WhatsApp de ' + esc(l.name) + '">' + esc(fmtPhone(d)) + '</a>';
    }
    if (d.length >= 8) {
      return '<a class="cell-tel" href="tel:+55' + esc(normPhone(d)) + '" title="Ligar" aria-label="Ligar para ' + esc(l.name) + '">' + esc(fmtPhone(d)) + '</a>';
    }
    return '<span class="cell-none">' + esc(fmtPhone(d)) + '</span>';
  }
  function channelsCell(l) {
    var out = [];
    var url = siteUrl(l);
    if (url) {
      var href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
      out.push('<a class="ch-ico" data-ch="site" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" title="' + esc(siteLabel(url)) + '" aria-label="Abrir site de ' + esc(l.name) + '">' + CH_SVG.site + '</a>');
    } else if (hasSite(l)) {
      out.push('<span class="ch-ico" data-ch="site" role="img" title="Site informado na base; a URL não veio no payload" aria-label="' + esc(l.name) + ' tem site">' + CH_SVG.site + '</span>');
    }
    if (l.instagram) {
      var ig = String(l.instagram).trim().replace(/^@/, '');
      var igHref = /^https?:\/\//i.test(ig) ? ig : 'https://instagram.com/' + ig;
      out.push('<a class="ch-ico" data-ch="ig" href="' + esc(igHref) + '" target="_blank" rel="noopener noreferrer" title="Instagram" aria-label="Abrir Instagram de ' + esc(l.name) + '">' + CH_SVG.ig + '</a>');
    }
    if (l.email) {
      out.push('<a class="ch-ico" data-ch="email" href="mailto:' + esc(l.email) + '" title="' + esc(l.email) + '" aria-label="Enviar e-mail para ' + esc(l.name) + '">' + CH_SVG.email + '</a>');
    }
    if (l.wa) {
      var cid = l.id ? ' data-contact-id="' + esc(l.id) + '"' : '';
      out.push('<a class="ch-ico" data-ch="wa" href="' + esc(l.wa) + '"' + cid + ' target="_blank" rel="noopener noreferrer" title="Conversar no WhatsApp" aria-label="Abrir WhatsApp de ' + esc(l.name) + '">' + CH_SVG.wa + '</a>');
    }
    if (!out.length) return '<span class="cell-none">—</span><span class="sr-only"> sem canal</span>';
    return out.join('');
  }
  function sinceCell(l) {
    if (!l.since_year) return '<span class="cell-none">—</span><span class="sr-only"> sem ano</span>';
    return '<span title="Atuando desde ' + esc(l.since_year) + '">' + esc(String(l.since_year)) + '</span>';
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
    tipo: function (l) {
      return typesOf(l).map(function (t) {
        var label = TIPO_LABEL[t] || t;
        return '<span class="tipo t-' + esc(t) + '">' + esc(label) + '</span>';
      }).join(' ');
    },
    phone: phoneCell, channels: channelsCell, since: sinceCell, captured: capturedCell
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
      /* stagger só em re-render por interação (filtro/página/sort) — nunca no boot */
      if (hasGsap && !firstRender) {
        window.gsap.fromTo(els.body.children, { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.18, stagger: 0.012, ease: 'expo.out', overwrite: true });
      }
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
        .sort(function (a, b) { return parseInt(b.label.split('·')[1], 10) - parseInt(a.label.split('·')[1], 10) || (a.value < b.value ? -1 : 1); });
    };
    var regItems = toItems(regions);
    if (state.region && !regItems.some(function (it) { return it.value === state.region; })) state.region = '';
    if (state.area && !Object.prototype.hasOwnProperty.call(areas, state.area)) state.area = '';
    fillSelect(els.region, regItems, state.region, 'Todas as regiões');
    fillSelect(els.area, toItems(areas), state.area, 'Todas as áreas');
  }

  function syncChecks() {
    els.phone.checked = state.phone;
    els.noSite.checked = state.noSite;
    els.status.value = state.status;
    document.getElementById('tblPhoneBox').classList.toggle('on', state.phone);
    document.getElementById('tblNoSiteBox').classList.toggle('on', state.noSite);
  }

  function clearFilters() {
    state.q = ''; state.region = ''; state.area = ''; state.minRating = 0;
    state.phone = false; state.noSite = false; state.status = ''; state.page = 1;
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
      state.sortDir = (key === 'rating' || key === 'captured' || key === 'phone' || key === 'channels') ? 'desc' : 'asc';
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
    els.noSite.addEventListener('change', function () { state.noSite = els.noSite.checked; state.page = 1; syncChecks(); renderRows(); });
    els.status.addEventListener('change', function () { state.status = els.status.value; state.page = 1; renderRows(); });
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
    withSince = state.rows.some(function (l) { return !!l.since_year; });
    fillFilters();
    syncChecks();
    renderHead();
    renderSummary();
    renderRows();
    firstRender = false;
  }

  els = {
    root: $('leadsSection'), table: $('leadTable'), cols: $('tblCols'), head: $('tblHead'), body: $('tblBody'),
    empty: $('tblEmpty'), count: $('tblCount'), page: $('tblPage'), prev: $('tblPrev'), next: $('tblNext'),
    search: $('tblSearch'), region: $('tblRegion'), area: $('tblArea'), minRating: $('tblMinRating'),
    phone: $('tblHasPhone'), noSite: $('tblNoSite'), status: $('tblStatus'), clear: $('tblClear'), pageSize: $('tblPageSize'),
    summary: $('tblSummary'), scroll: $('tblScroll')
  };
  if (els.root && els.head && els.search) bind();

  window.VS_TABLE = { render: render };
})();
