/* Estado vs evento da captura: o servidor pode devolver 'done' de forma permanente
   (job finalizado). Só a transição ao vivo running→done pode recarregar a página —
   senão o painel entra em loop de reload após o login. UMD: browser + node (testes). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CaptureState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function decide(status, ctx) {
    var c = ctx || {};
    if (status === 'done') {
      if (!c.sawRunning) return { render: 'done', reload: false, toast: false };
      var key = 'vs_reloaded_' + (c.startedAt || 'x');
      var guard = false;
      try {
        if (c.storage) {
          if (c.storage.getItem(key)) guard = true;
          else c.storage.setItem(key, '1');
        }
      } catch (e) { /* storage indisponível: segue sem guarda */ }
      if (guard) return { render: 'done', reload: false, toast: false };
      return { render: 'done', reload: true, toast: true };
    }
    if (status === 'running') return { render: 'running', reload: false, toast: false };
    if (status === 'failed') return { render: 'failed', reload: false, toast: false };
    return { render: 'idle', reload: false, toast: false };
  }
  return { decide: decide };
});
