/* Virgo Scout — revisão de cadastros (fundador). Guarda real é a API (/api/signups 403). */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var pend = $('#cadPendList'), hist = $('#cadHistList'), pendCount = $('#cadPendCount');

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function toast(msg, kind) {
    var box = $('#toasts');
    if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.setAttribute('role', 'status');
    t.innerHTML = '<i></i><span>' + escapeHtml(msg) + '</span>';
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    var timer = setTimeout(close, 3000);
    function close() { clearTimeout(timer); if (!t.parentNode) return; t.classList.add('out'); setTimeout(function () { t.remove(); }, 170); }
    t.addEventListener('click', close);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return escapeHtml(String(iso)); }
  }

  function badge(status) {
    var label = status === 'pending' ? 'Pendente' : status === 'approved' ? 'Aprovado' : 'Recusado';
    return '<span class="cad-badge cad-' + escapeHtml(status) + '">' + label + '</span>';
  }

  function fmtPhone(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return escapeHtml(tel);
  }

  function card(s) {
    return '<div class="cad-card" data-id="' + escapeHtml(s.id) + '">' +
        '<div class="cad-card-head">' +
          '<strong class="cad-card-name">' + escapeHtml(s.full_name) + badge(s.status) + '</strong>' +
          '<span class="cad-card-date">' + fmtDate(s.created_at) + '</span>' +
        '</div>' +
        '<dl class="cad-info">' +
          '<div><dt>E-mail</dt><dd>' + escapeHtml(s.email) + '</dd></div>' +
          '<div><dt>Telefone</dt><dd>' + fmtPhone(s.phone) + '</dd></div>' +
          '<div><dt>CPF</dt><dd>' + escapeHtml(s.cpf_masked) + '</dd></div>' +
          '<div><dt>Enviado em</dt><dd>' + fmtDate(s.created_at) + '</dd></div>' +
          (s.reviewed_at ? '<div><dt>Revisado por</dt><dd>' + escapeHtml(s.reviewed_by || '—') + ' · ' + fmtDate(s.reviewed_at) + '</dd></div>' : '') +
        '</dl>' +
        (s.status === 'pending' ? actionsFor(s) : '') +
      '</div>';
  }

  function errMsg(code) {
    return code === 'already_reviewed' ? 'Cadastro já revisado — recarregando.'
      : code === 'user_exists' ? 'Usuário já existe — cadastro recusado para revisão.'
      : code === 'not_found' ? 'Cadastro não encontrado.'
      : code === 'invalid_action' ? 'Ação inválida.'
      : 'Erro de servidor — tente novamente.';
  }

  function actionsFor(s) {
    return '<div class="cad-acts">' +
      '<button type="button" class="cad-act cad-act-ok" data-id="' + escapeHtml(s.id) + '" data-action="approve" data-name="' + escapeHtml(s.full_name) + '">Aprovar</button>' +
      '<button type="button" class="cad-act cad-act-no" data-id="' + escapeHtml(s.id) + '" data-action="reject" data-name="' + escapeHtml(s.full_name) + '">Recusar</button>' +
    '</div>';
  }

  function render(items) {
    var p = [], h = [];
    (items || []).forEach(function (s) { (s.status === 'pending' ? p : h).push(s); });
    pendCount.textContent = p.length ? '(' + p.length + ')' : '';
    pend.innerHTML = p.length ? p.map(card).join('') : '<p class="cad-empty">Nenhum cadastro pendente.</p>';
    hist.innerHTML = h.length ? h.map(card).join('') : '<p class="cad-empty">Sem histórico ainda.</p>';
    bind();
  }

  function bind() {
    pend.querySelectorAll('.cad-act').forEach(function (b) {
      b.addEventListener('click', function () { review(b.dataset.id, b.dataset.action, b.dataset.name); });
    });
  }

  function review(id, action, name) {
    var ok = confirm(action === 'approve'
      ? 'Aprovar cadastro de ' + name + ' e criar acesso de cofounder?'
      : 'Recusar o cadastro de ' + name + '?');
    if (!ok) return;
    fetch('/api/signup-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, action: action })
    }).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, b: b }; });
    }).then(function (res) {
      if (!res.ok) {
        toast(errMsg(res.b && res.b.error), res.b && (res.b.error === 'already_reviewed' || res.b.error === 'user_exists') ? 'warn' : 'err');
        load();
        return;
      }
      toast(action === 'approve' ? 'Aprovado — acesso criado.' : 'Cadastro recusado.', 'ok');
      load();
    }).catch(function () { toast('Servidor indisponível — tente de novo.', 'err'); });
  }

  function load() {
    fetch('/api/signups', { cache: 'no-store' }).then(function (r) {
      if (r.status === 401 || r.status === 403) { location.href = '/'; return null; }
      return r.json().then(function (b) { return { ok: r.ok, b: b }; });
    }).then(function (res) {
      if (!res) return;
      if (!res.ok) { toast('Erro de servidor — tente recarregar a página.', 'err'); return; }
      render(res.b.items || []);
      if (res.b.truncated) toast('Exibindo os 200 cadastros mais recentes.', 'warn');
    }).catch(function () { toast('Servidor indisponível — tente recarregar a página.', 'err'); });
  }

  load();
})();
