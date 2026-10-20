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
    if (isConfirmedWa(l)) n++;
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

  /* ---------- verificação de WhatsApp autêntico/confirmado ---------- */
  function isConfirmedWa(l) {
    if (!l) return false;
    if (l.has_confirmed_wa === true) return true;
    if (l.wa_confidence === 'suspect') return false;
    if (l.wa_source === 'site' || l.wa_source === 'instagram' || l.wa_confidence === 'official_maps' || l.wa_confidence === 'official_site') return true;
    if (l.wa && typeof l.wa === 'string') return true;
    return false;
  }

  /* ---------- gancho dinâmico e mensagem de abordagem (loss of money hook) ---------- */
  function segmentOfLead(l) {
    var area = (l.area || '').toLowerCase();
    var cat = (l.cat || l.category || '').toLowerCase();
    var name = (l.name || '').toLowerCase();
    var txt = area + ' ' + cat + ' ' + name;
    if (/topograf|agrimens/.test(txt)) return 'topografia';
    if (/arquit|urbanis/.test(txt)) return 'arquitetura e topografia';
    if (/tapec|tapet|cortina/.test(txt)) return 'tapeçaria';
    if (/estofad|sofa|colch/.test(txt)) return 'estofados';
    return 'advocacia';
  }

  function waMessageClient(l) {
    var quem = String(l.name || '').trim() || 'seu escritório';
    var segmento = segmentOfLead(l);
    var nota = (typeof l.rating === 'number' && isFinite(l.rating)) ? String(l.rating).replace('.', ',') : '';
    
    var intro = nota
      ? 'Olá! Sou Alan, da Virgo Tech. Vi ' + quem + ' no Google Maps — nota ' + nota + '★, parabéns!'
      : 'Olá! Sou Alan, da Virgo Tech. Encontrei ' + quem + ' no Google Maps.';

    if (!hasSite(l)) {
      return intro + ' Notei que vocês ainda não têm site próprio — hoje estão perdendo clientes e contratos todos os dias para outros de ' + segmento + ' no DF. Posso te mandar 2 referências rápidas de sites que trazem resultados?';
    } else {
      return intro + ' Analisei a presença de vocês em ' + segmento + ' no DF e notei pontos onde estão deixando dinheiro na mesa para a concorrência. Posso te mandar 2 ideias rápidas para dobrar seus contatos?';
    }
  }

  function buildWaLink(l) {
    var d = l.wa_digits || phoneDigits(l);
    if (!d) return '';
    var norm = normPhone(d);
    var digits = norm.length <= 11 ? '55' + norm : norm;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(waMessageClient(l));
  }

  /* ---------- estado ---------- */
  var state = {
    rows: [], total: 0, updated: '',
    q: '', region: '', area: '', minRating: 0, phone: false, noSite: false, status: '',
    alta: false, ideal: false,
    sortKey: '', sortDir: 'asc',
    page: 1, pageSize: 25
  };
  var withCaptured = false;
  var withSince = false;
  var firstRender = true;
  var els = {};

  var selectedMap = {}; // key -> lead

  function leadKey(l) {
    return String(l.id || (l.name + '_' + phoneDigits(l)));
  }

  function getSelectedCount() {
    return Object.keys(selectedMap).length;
  }

  function updateSelectPill() {
    var count = getSelectedCount();
    var counterEl = $('shareCounter');
    var lblSel = $('lblCountSelected');
    if (counterEl) {
      counterEl.textContent = String(count);
      counterEl.hidden = count === 0;
    }
    if (lblSel) {
      lblSel.textContent = String(count);
    }
  }

  var TIPO_LABEL = { advogados: 'Advogado', arquitetura: 'Arquitetura', tapecaria: 'Tapeçaria', estofado: 'Estofado', topografia: 'Topografia' };
  var TIPO_ORDER = ['advogados', 'arquitetura', 'tapecaria', 'estofado', 'topografia'];
  function tipoLabel(t) {
    if (TIPO_LABEL[t]) return TIPO_LABEL[t];
    var s = String(t || '');
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
  }

  var COLS = [
    { key: 'select', label: '', w: 3 },
    { key: 'name', label: 'Empresa', w: 21 },
    { key: 'rating', label: 'Nota / Reviews', w: 10 },
    { key: 'region', label: 'Cidade / Região', w: 13 },
    { key: 'area', label: 'Área', w: 12 },
    { key: 'tipo', label: 'Tipo', w: 10 },
    { key: 'phone', label: 'Telefone', w: 15 },
    { key: 'channels', label: 'Canais', w: 12 },
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
    if (state.area) {
      var tags = typesOf(l);
      if (state.area === 'outros' ? tags.length > 0 : tags.indexOf(state.area) === -1) return false;
    }
    if (state.alta && l.badge !== 'Alta') return false;
    if (state.ideal && !((l.icp || []).length > 0)) return false;
    if (state.phone && !hasChannel(l)) return false;
    if (state.noSite && hasSite(l)) return false;
    if (state.status && (l.status || 'novo') !== state.status) return false;
    if (state.minRating > 0 && !(typeof l.rating === 'number' && isFinite(l.rating) && l.rating >= state.minRating)) return false;
    if (state.q) {
      var tipoLabels = typesOf(l).map(function (t) { return tipoLabel(t); }).join(' ');
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
    return !!(state.q || state.region || state.area || state.minRating || state.phone || state.noSite || state.status || state.alta || state.ideal);
  }

  /* ---------- células ---------- */
  var CH_SVG = {
    site: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="3.8"/><circle cx="16.8" cy="7.2" r="1.1" fill="currentColor" stroke="none"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 5.5 8.5-5.5"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c4.55 0 8.24 3.7 8.24 8.24 0 2.2-.86 4.28-2.42 5.84a8.18 8.18 0 0 1-5.83 2.41c-1.46 0-2.88-.38-4.14-1.11l-.3-.17-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.44c0-4.55 3.7-8.25 8.25-8.25zm4.56 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.07-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.14-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08s.89 2.41 1.01 2.58c.13.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.53.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.59.21-1.09.15-1.19-.07-.09-.23-.15-.48-.28z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
  };

  function nameCell(l) {
    var badge = '';
    if (l.status && l.status !== 'novo') {
      var st = esc(String(l.status).charAt(0).toUpperCase() + String(l.status).slice(1));
      badge = '<span class="badge Contatado">' + st + '</span>';
    } else if (l.badge) {
      badge = '<span class="badge ' + esc(l.badge) + '">' + esc(l.badge) + '</span>';
    }
    var noSiteTag = !hasSite(l) ? '<span class="tag-nosite" title="Oportunidade Forte: Empresa sem site próprio">Sem site</span>' : '';
    return '<div class="nm-in"><span class="nm" title="' + esc(l.name) + '">' + esc(l.name) + '</span>' + noSiteTag + badge + '</div>';
  }

  function ratingCell(l) {
    var r = fmtRating(l.rating);
    if (!r) return '<span class="cell-none">—</span><span class="sr-only"> sem avaliação</span>';
    var rev = (typeof l.reviews === 'number' && isFinite(l.reviews)) ? l.reviews : null;
    return '<span class="rate">' + r + '<i aria-hidden="true">★</i></span>' +
      '<span class="rev"> · ' + (rev == null ? '—' : fmtInt(rev)) + '</span>' +
      '<span class="sr-only">' + (rev == null ? ' sem resenhas' : ' com ' + fmtInt(rev) + ' avaliações') + '</span>';
  }

  function waBadge(l) {
    var src = l.wa_source;
    var conf = l.wa_confidence;
    var ev = l.wa_evidence ? ' · Evidência: ' + l.wa_evidence : '';
    if (conf === 'suspect') {
      return '<span class="wa-badge wa-suspect" title="Atenção: Número suspeito ou compartilhado' + esc(ev) + '">⚠️ Compartilhado</span>';
    }
    if (src === 'maps' || conf === 'official_maps') {
      return '<span class="wa-badge wa-maps" title="WhatsApp verificado direto do Google Maps' + esc(ev) + '"><i class="wa-dot"></i> Maps Oficial</span>';
    }
    if (src === 'site' || conf === 'official_site') {
      return '<span class="wa-badge wa-site" title="WhatsApp declarado no site oficial' + esc(ev) + '"><i class="wa-dot"></i> Site Oficial</span>';
    }
    if (src === 'instagram' || conf === 'instagram') {
      return '<span class="wa-badge wa-ig" title="WhatsApp extraído da bio do Instagram' + esc(ev) + '"><i class="wa-dot"></i> Instagram</span>';
    }
    if (isConfirmedWa(l)) {
      return '<span class="wa-badge wa-cell" title="Celular direto compatível com WhatsApp' + esc(ev) + '"><i class="wa-dot"></i> Celular</span>';
    }
    return '';
  }

  function phoneCell(l) {
    var d = phoneDigits(l);
    if (!d) return '<span class="cell-none">—</span><span class="sr-only"> sem telefone</span>';
    var badge = waBadge(l);
    if (isConfirmedWa(l)) {
      var waUrl = l.wa || buildWaLink(l);
      var cid = l.id ? ' data-contact-id="' + esc(l.id) + '"' : '';
      return '<div class="phone-wrap"><a class="cell-wa" href="' + esc(waUrl) + '"' + cid + ' target="_blank" rel="noopener noreferrer" title="WhatsApp Confirmado: Iniciar conversa" aria-label="Abrir WhatsApp de ' + esc(l.name) + '">' +
        '<span class="cell-wa-ico" style="display:inline-flex;width:15px;height:15px;margin-right:5px;vertical-align:-2px;color:#25d366;">' + CH_SVG.wa + '</span>' +
        '<span>' + esc(fmtPhone(d)) + '</span></a>' + badge + '</div>';
    }
    // Telefone comum do Google Maps — NÃO exibe link de WhatsApp nem ícone falso de zap
    return '<div class="phone-wrap"><a class="cell-tel" href="tel:+55' + esc(normPhone(d)) + '" title="Telefone Google Maps (WhatsApp não confirmado)" aria-label="Ligar para ' + esc(l.name) + '">' +
      '<span class="cell-phone-ico" style="display:inline-flex;width:14px;height:14px;margin-right:5px;vertical-align:-2px;color:#7d90ac;">' + CH_SVG.phone + '</span>' +
      '<span>' + esc(fmtPhone(d)) + '</span></a>' + badge + '</div>';
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
    // WhatsApp oficial/confirmado SOMENTE:
    if (isConfirmedWa(l)) {
      var waUrl = l.wa || buildWaLink(l);
      var cid = l.id ? ' data-contact-id="' + esc(l.id) + '"' : '';
      out.push('<a class="ch-ico is-wa-confirmed" data-ch="wa" href="' + esc(waUrl) + '"' + cid + ' target="_blank" rel="noopener noreferrer" title="WhatsApp Confirmado: Conversar no WhatsApp" aria-label="Abrir WhatsApp confirmado de ' + esc(l.name) + '">' + CH_SVG.wa + '</a>');
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

  function selectCell(l) {
    var k = leadKey(l);
    var isSel = !!selectedMap[k];
    return '<input type="checkbox" class="c-row-check" data-lead-key="' + esc(k) + '"' + (isSel ? ' checked' : '') + ' aria-label="Selecionar lead ' + esc(l.name) + '">';
  }

  var CELLS = {
    select: selectCell,
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
        return '<span class="tipo t-' + esc(t) + '">' + esc(tipoLabel(t)) + '</span>';
      }).join(' ');
    },
    phone: phoneCell, channels: channelsCell, since: sinceCell, captured: capturedCell
  };

  /* ---------- render ---------- */
  function renderHead() {
    var cols = activeCols();
    var html = '<tr>';
    cols.forEach(function (c) {
      if (c.key === 'select') {
        html += '<th scope="col" class="c-select"><input type="checkbox" id="selectAllRows" title="Selecionar todos os leads visíveis" aria-label="Selecionar todas as linhas"></th>';
        return;
      }
      var sort = state.sortKey === c.key ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
      html += '<th scope="col" class="c-' + c.key + '" aria-sort="' + sort + '">' +
        '<button type="button" class="th-sort" data-key="' + c.key + '">' + esc(c.label) +
        '<svg class="sort-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button></th>';
    });
    els.head.innerHTML = html + '</tr>';
    els.cols.innerHTML = cols.map(function (c) { return '<col style="width:' + c.w + '%">'; }).join('');

    var selAll = $('selectAllRows');
    if (selAll) {
      selAll.addEventListener('change', function () {
        var visibleSlice = currentSlice();
        var chk = selAll.checked;
        visibleSlice.forEach(function (l) {
          var k = leadKey(l);
          if (chk) selectedMap[k] = l;
          else delete selectedMap[k];
        });
        updateSelectPill();
        renderRows(true);
      });
    }
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

  function currentSlice() {
    var list = sortList(filtered());
    var start = (state.page - 1) * state.pageSize;
    return list.slice(start, start + state.pageSize);
  }

  function renderRows(skipGsap) {
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

      /* sync select all checkbox */
      var selAll = $('selectAllRows');
      if (selAll) {
        var allChecked = slice.length > 0 && slice.every(function (l) { return !!selectedMap[leadKey(l)]; });
        selAll.checked = allChecked;
      }

      /* stagger só em re-render por interação (filtro/página/sort) — nunca no boot */
      if (hasGsap && !firstRender && !skipGsap) {
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

    updateSelectPill();
  }

  /* ---------- exportar para sócio via WhatsApp ---------- */
  function generateShareText(leads, targetName) {
    var lines = [];
    var now = new Date();
    var dateStr = pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear();
    var currentCat = $('capCat') ? $('capCat').value : '';
    var catLabel = tipoLabel(currentCat) || 'Prospecção DF';
    
    lines.push('*VIRGO TECH — LISTA DE LEADS PARA CONTACTAÇÃO*');
    lines.push('📅 Data: ' + dateStr);
    lines.push('🎯 Nicho: ' + catLabel);
    lines.push('👥 Total: ' + leads.length + ' leads (' + targetName + ')');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    leads.forEach(function (l, i) {
      var num = i + 1;
      var r = fmtRating(l.rating);
      var rev = (typeof l.reviews === 'number' && isFinite(l.reviews)) ? l.reviews : 0;
      var ratingStr = r ? r + '★ (' + rev + ' avaliações)' : 'Sem avaliação';
      var reg = regionOf(l) || 'Brasília/DF';
      var d = phoneDigits(l);
      var foneStr = d ? fmtPhone(d) : 'Não informado';
      var waUrl = buildWaLink(l);
      var msg = waMessageClient(l);

      lines.push('*[' + num + '] ' + (l.name || 'Empresa') + '*');
      lines.push('⭐ Avaliação: ' + ratingStr);
      lines.push('📍 Região: ' + reg);
      lines.push('🌐 Site: ' + (hasSite(l) ? siteUrl(l) || 'Tem site' : '❌ SEM SITE (Oportunidade Forte)'));
      lines.push('📱 WhatsApp: ' + foneStr + (isConfirmedWa(l) ? ' ✅ Confirmado' : ' ⚠️ Maps'));
      if (waUrl) {
        lines.push('🔗 Abrir Zap: ' + waUrl);
      }
      lines.push('💬 *Mensagem sugerida (Gancho Perda de Clientes)*:');
      lines.push('"' + msg + '"');
      lines.push('─────────────────────────────────');
      lines.push('');
    });

    lines.push('🚀 *Recomendação*: Começar pelos leads com nota acima de 4,5 e sem site.');
    lines.push('Virgo Tech Scout — Automação de Prospecção');
    return lines.join('\n');
  }

  function updateSharePreview() {
    var modal = $('shareModalBackdrop');
    if (!modal || modal.hidden) return;

    var optSelected = $('optSelected');
    var optAlta = $('optAlta');
    var optIdeal = $('optIdeal');
    var shareOnlyWa = $('shareOnlyWa');
    var preview = $('sharePreviewText');
    var totalLbl = $('shareTotalItems');
    var btnOpen = $('btnOpenWaDirect');

    var targetName = 'Selecionados';
    var candidateLeads = [];

    if (optSelected && optSelected.checked) {
      targetName = 'Selecionados manualmente';
      candidateLeads = Object.keys(selectedMap).map(function (k) { return selectedMap[k]; });
    } else if (optAlta && optAlta.checked) {
      targetName = 'Alta Oportunidade';
      candidateLeads = state.rows.filter(function (l) { return l.badge === 'Alta'; });
    } else if (optIdeal && optIdeal.checked) {
      targetName = 'Oportunidades Ideais (ICP)';
      candidateLeads = state.rows.filter(function (l) { return (l.icp || []).length > 0; });
    } else {
      targetName = 'Todos da categoria';
      candidateLeads = state.rows.slice();
    }

    if (shareOnlyWa && shareOnlyWa.checked) {
      candidateLeads = candidateLeads.filter(function (l) { return isConfirmedWa(l); });
    }

    if (totalLbl) totalLbl.textContent = String(candidateLeads.length);

    var text = candidateLeads.length
      ? generateShareText(candidateLeads, targetName)
      : 'Nenhum lead encontrado com os critérios escolhidos.';
    
    if (preview) preview.value = text;
    if (btnOpen) {
      btnOpen.href = 'https://wa.me/?text=' + encodeURIComponent(text);
    }
  }

  function initShareModal() {
    var shareBtn = $('tblShareBtn');
    var modal = $('shareModalBackdrop');
    var closeBtn = $('shareModalClose');
    var cancelBtn = $('btnShareCancel');
    var copyBtn = $('btnCopyWaText');
    var copyLabel = $('btnCopyWaLabel');

    if (!shareBtn || !modal) return;

    shareBtn.addEventListener('click', function () {
      var selCount = getSelectedCount();
      var optSelected = $('optSelected');
      var optAlta = $('optAlta');
      var optAll = $('optAll');
      var lblAll = $('lblCountAll');

      if (lblAll) lblAll.textContent = String(state.rows.length);
      updateSelectPill();

      if (selCount > 0 && optSelected) {
        optSelected.checked = true;
      } else if (optAlta) {
        optAlta.checked = true;
      } else if (optAll) {
        optAll.checked = true;
      }

      modal.hidden = false;
      updateSharePreview();
    });

    var closeModal = function () {
      modal.hidden = true;
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    ['optSelected', 'optAlta', 'optIdeal', 'optAll', 'shareOnlyWa'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', updateSharePreview);
    });

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var preview = $('sharePreviewText');
        if (!preview) return;
        var text = preview.value;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            if (copyLabel) copyLabel.textContent = '✓ Copiado!';
            setTimeout(function () { if (copyLabel) copyLabel.textContent = 'Copiar Texto'; }, 2200);
          }).catch(function () {
            preview.select();
            document.execCommand('copy');
            if (copyLabel) copyLabel.textContent = '✓ Copiado!';
            setTimeout(function () { if (copyLabel) copyLabel.textContent = 'Copiar Texto'; }, 2200);
          });
        } else {
          preview.select();
          document.execCommand('copy');
          if (copyLabel) copyLabel.textContent = '✓ Copiado!';
          setTimeout(function () { if (copyLabel) copyLabel.textContent = 'Copiar Texto'; }, 2200);
        }
      });
    }
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
    var regions = {}, nichos = {};
    state.rows.forEach(function (l) {
      var r = regionOf(l);
      if (r) regions[r] = (regions[r] || 0) + 1;
      var tags = typesOf(l);
      var seen = {};
      tags.forEach(function (t) {
        if (t && !seen[t]) { seen[t] = 1; nichos[t] = (nichos[t] || 0) + 1; }
      });
    });
    var toItems = function (map, labelOf) {
      return Object.keys(map).map(function (k) { return { value: k, label: (labelOf(k) || k) + ' · ' + map[k] }; })
        .sort(function (a, b) { return parseInt(b.label.split('·')[1], 10) - parseInt(a.label.split('·')[1], 10) || (a.value < b.value ? -1 : 1); });
    };
    var regItems = toItems(regions, function (k) { return k; });
    var nichoItems = toItems(nichos, tipoLabel);
    if (state.region && !regItems.some(function (it) { return it.value === state.region; })) state.region = '';
    if (state.area && !nichoItems.some(function (it) { return it.value === state.area; })) state.area = '';
    fillSelect(els.region, regItems, state.region, 'Todas as regiões');
    fillSelect(els.area, nichoItems, state.area, 'Todos os nichos');
  }

  function syncChecks() {
    els.phone.checked = state.phone;
    els.noSite.checked = state.noSite;
    els.status.value = state.status;
    els.alta.checked = state.alta;
    els.ideal.checked = state.ideal;
    document.getElementById('tblPhoneBox').classList.toggle('on', state.phone);
    document.getElementById('tblNoSiteBox').classList.toggle('on', state.noSite);
    document.getElementById('tblAltaBox').classList.toggle('on', state.alta);
    document.getElementById('tblIdealBox').classList.toggle('on', state.ideal);
  }

  function clearFilters() {
    state.q = ''; state.region = ''; state.area = ''; state.minRating = 0;
    state.phone = false; state.noSite = false; state.status = '';
    state.alta = false; state.ideal = false; state.page = 1;
    els.search.value = '';
    els.minRating.value = '0';
    fillFilters();
    syncChecks();
    renderRows();
    els.search.focus();
  }

  function toggleSort(key) {
    if (key === 'select') return;
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
    els.alta.addEventListener('change', function () { state.alta = els.alta.checked; state.page = 1; syncChecks(); renderRows(); });
    els.ideal.addEventListener('change', function () { state.ideal = els.ideal.checked; state.page = 1; syncChecks(); renderRows(); });
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
    els.body.addEventListener('change', function (e) {
      var chk = e.target && e.target.closest ? e.target.closest('.c-row-check') : null;
      if (chk) {
        var key = chk.getAttribute('data-lead-key');
        if (chk.checked) {
          var found = state.rows.find(function (l) { return leadKey(l) === key; });
          if (found) selectedMap[key] = found;
        } else {
          delete selectedMap[key];
        }
        updateSelectPill();
        var selAll = $('selectAllRows');
        if (selAll) {
          var slice = currentSlice();
          selAll.checked = slice.length > 0 && slice.every(function (l) { return !!selectedMap[leadKey(l)]; });
        }
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('#tblClear') || e.target.closest('#tblEmptyClear')) clearFilters();
    });

    initShareModal();
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
    alta: $('tblAlta'), ideal: $('tblIdeal'),
    summary: $('tblSummary'), scroll: $('tblScroll')
  };
  if (els.root && els.head && els.search) bind();

  window.VS_TABLE = { render: render };
})();
