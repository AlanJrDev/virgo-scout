/* Virgo Scout — login local (sessão por cookie via /api/login) */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGsap = typeof window.gsap !== 'undefined' && !reduceMotion;
  var $ = function (s) { return document.querySelector(s); };

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

  /* céu: vídeo hero da LP — fade suave quando o stream responde */
  var video = document.querySelector('.login-video');
  if (video && !reduceMotion) {
    var ready = function () { video.classList.add('ready'); };
    if (video.readyState >= 3) ready();
    else video.addEventListener('canplay', ready, { once: true });
    video.play().catch(function () { /* poster permanece */ });
  } else if (video) {
    video.classList.add('ready');
  }

  /* entrada: momento único */
  if (hasGsap) {
    window.gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from('.login-card', { y: 22, autoAlpha: 0, duration: 0.5 }, 0.1)
      .from('.login-pill', { y: 8, autoAlpha: 0, duration: 0.3 }, 0.22)
      .from('.login-brand', { y: 10, autoAlpha: 0, duration: 0.35 }, 0.28)
      .from('.field', { y: 12, autoAlpha: 0, duration: 0.32, stagger: 0.07 }, 0.38)
      .from('.login-row', { autoAlpha: 0, duration: 0.3 }, 0.56)
      .from('.login-btn', { y: 10, autoAlpha: 0, duration: 0.35 }, 0.62)
      .from('.login-foot', { autoAlpha: 0, duration: 0.3 }, 0.72);
  }

  var form = $('#loginForm'), user = $('#loginUser'), pass = $('#loginPass');
  var btn = $('#loginSubmit'), err = $('#loginErr');

  $('#togglePass').addEventListener('click', function () {
    var show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    this.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });

  $('#forgot').addEventListener('click', function () {
    toast('Contate o administrador do painel para redefinir sua senha', 'ok');
  });

  function showError(msg) {
    err.textContent = msg;
    err.hidden = false;
    if (hasGsap) window.gsap.fromTo('.login-card', { x: -7 }, { x: 0, duration: 0.45, ease: 'elastic.out(1,0.45)' });
    else if (!reduceMotion) { form.classList.add('shake'); setTimeout(function () { form.classList.remove('shake'); }, 400); }
  }

  function setBusy(on) {
    btn.disabled = on;
    btn.innerHTML = on
      ? '<span class="spin" aria-hidden="true"></span><span>Entrando…</span>'
      : '<span>Entrar</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var u = user.value.trim(), p = pass.value;
    if (!u || !p) { showError('Preencha e-mail e senha para continuar.'); return; }
    setBusy(true);
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: u, pass: p, keep: !!($('#keep') && $('#keep').checked) })
    }).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, b: b }; });
    }).then(function (res) {
      if (!res.ok) {
        setBusy(false);
        var e = res.b && res.b.error;
        showError(
          e === 'locked' ? 'Muitas tentativas — aguarde 30s.' :
          e === 'setup_required' ? 'Painel não configurado — rode scripts/init-users.js' :
          'E-mail ou senha inválidos — tente novamente.'
        );
        pass.value = '';
        pass.focus();
        return;
      }
      btn.classList.add('ok');
      btn.innerHTML = '<span>Bem-vindo ✓</span>';
      setTimeout(function () { location.href = '/'; }, 420);
    }).catch(function () {
      setBusy(false);
      showError('Servidor indisponível — tente de novo.');
    });
  });

  user.focus();
})();
