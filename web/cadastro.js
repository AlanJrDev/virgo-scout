/* Virgo Scout — cadastro público (POST /api/signup, sem sessão) */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGsap = typeof window.gsap !== 'undefined' && !reduceMotion;
  var $ = function (s) { return document.querySelector(s); };

  /* céu: mesmo hero do login */
  var video = document.querySelector('.login-video');
  if (video && !reduceMotion) {
    var ready = function () { video.classList.add('ready'); };
    if (video.readyState >= 3) ready();
    else video.addEventListener('canplay', ready, { once: true });
    video.play().catch(function () {});
  } else if (video) {
    video.classList.add('ready');
  }

  if (hasGsap) {
    window.gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from('.login-card', { y: 22, autoAlpha: 0, duration: 0.5 }, 0.1)
      .from('.login-pill', { y: 8, autoAlpha: 0, duration: 0.3 }, 0.22)
      .from('.login-brand', { y: 10, autoAlpha: 0, duration: 0.35 }, 0.28)
      .from('.field', { y: 12, autoAlpha: 0, duration: 0.32, stagger: 0.06 }, 0.38)
      .from('.cad-consent', { autoAlpha: 0, duration: 0.3 }, 0.6)
      .from('.login-btn', { y: 10, autoAlpha: 0, duration: 0.35 }, 0.68)
      .from('.login-foot', { autoAlpha: 0, duration: 0.3 }, 0.76);
  }

  var form = $('#cadForm'), btn = $('#cadSubmit'), errBox = $('#cadErr'), okBox = $('#cadOk');
  var name = $('#cadName'), email = $('#cadEmail'), phone = $('#cadPhone'), cpf = $('#cadCpf');
  var pass = $('#cadPass'), pass2 = $('#cadPass2'), consent = $('#cadConsent');

  function digits(v) { return String(v || '').replace(/\D/g, ''); }

  /* máscaras leves */
  var maskPhone = function () {
    var d = digits(phone.value).slice(0, 11);
    if (d.length <= 2) { phone.value = d.length ? '(' + d : ''; return; }
    if (d.length <= 6) { phone.value = '(' + d.slice(0, 2) + ') ' + d.slice(2); return; }
    if (d.length <= 10) { phone.value = '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6); return; }
    phone.value = '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  };
  var maskCpf = function () {
    var d = digits(cpf.value).slice(0, 11);
    var out = d.slice(0, 3);
    if (d.length > 3) out += '.' + d.slice(3, 6);
    if (d.length > 6) out += '.' + d.slice(6, 9);
    if (d.length > 9) out += '-' + d.slice(9);
    cpf.value = out;
  };
  phone.addEventListener('input', maskPhone);
  cpf.addEventListener('input', maskCpf);

  function isValidCpf(c) {
    var s = digits(c);
    if (s.length !== 11) return false;
    var d = s.split('');
    var i, sum = 0, r;
    for (i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
    r = sum % 11;
    if ((r < 2 ? 0 : 11 - r) !== Number(d[9])) return false;
    if (/^(\d)\1+$/.test(s)) return false;
    sum = 0;
    for (i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
    r = sum % 11;
    return (r < 2 ? 0 : 11 - r) === Number(d[10]);
  }

  function showError(msg) {
    errBox.textContent = msg;
    errBox.hidden = false;
    if (hasGsap) window.gsap.fromTo('.login-card', { x: -7 }, { x: 0, duration: 0.45, ease: 'elastic.out(1,0.45)' });
    else if (!reduceMotion) { form.classList.add('shake'); setTimeout(function () { form.classList.remove('shake'); }, 400); }
  }

  function setBusy(on) {
    btn.disabled = on;
    btn.innerHTML = on
      ? '<span class="spin" aria-hidden="true"></span><span>Enviando…</span>'
      : '<span>Enviar cadastro</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
  }

  function msgFor(code) {
    return code === 'invalid_name' ? 'Informe nome e sobrenome.'
      : code === 'invalid_email' ? 'E-mail inválido.'
      : code === 'invalid_phone' ? 'Telefone inválido — use DDD + número.'
      : code === 'invalid_cpf' ? 'CPF inválido — confira os números.'
      : code === 'weak_pass' ? 'Senha deve ter entre 8 e 128 caracteres.'
      : code === 'duplicate' ? 'Não foi possível concluir o envio — verifique os dados ou tente novamente.'
      : code === 'locked' ? 'Muitas tentativas — aguarde alguns minutos.'
      : code === 'store_unavailable' ? 'Serviço temporariamente indisponível — tente mais tarde.'
      : code === 'too_large' ? 'Dados enviados acima do permitido.'
      : 'Não foi possível enviar — tente novamente.';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errBox.hidden = true;
    if (!consent.checked) { showError('É necessário autorizar o uso dos dados para contato.'); return; }
    if (pass.value !== pass2.value) { showError('As senhas não coincidem.'); pass2.value = ''; pass2.focus(); return; }
    if (!isValidCpf(cpf.value)) { showError(msgFor('invalid_cpf')); cpf.focus(); return; }
    var tel = digits(phone.value);
    var ddd = Number(tel.slice(0, 2));
    if ((tel.length !== 10 && tel.length !== 11) || ddd < 11 || ddd > 99) { showError(msgFor('invalid_phone')); phone.focus(); return; }
    var parts = name.value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (name.value.trim().length < 5 || parts.length < 2 || parts[0].length < 2 || parts[parts.length - 1].length < 2) { showError(msgFor('invalid_name')); name.focus(); return; }
    setBusy(true);
    fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value.trim(), email: email.value.trim(), phone: tel, cpf: digits(cpf.value), pass: pass.value })
    }).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, b: b }; });
    }).then(function (res) {
      if (!res.ok) {
        setBusy(false);
        showError(msgFor(res.b && res.b.error));
        pass.value = '';
        pass2.value = '';
        pass.focus();
        return;
      }
      form.hidden = true;
      okBox.hidden = false;
      okBox.focus();
    }).catch(function () {
      setBusy(false);
      showError('Servidor indisponível — tente de novo.');
      pass.value = '';
      pass2.value = '';
    });
  });

  name.focus();
})();
