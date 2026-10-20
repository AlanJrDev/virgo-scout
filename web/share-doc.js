/* Virgo Tech — gera documento .doc (Word HTML) da lista de leads p/ o sócio.
   Carregada antes de table.js; também require-ável no node para o teste (mesmo padrão do wa-quote.js). */
(function () {
  'use strict';

  var DOC_TITLE = 'VIRGO TECH — LISTA DE LEADS';
  var DOC_FOOTER = 'Virgo Tech Scout — Automação de Prospecção';
  var CAT_FALLBACK = 'Prospecção DF';

  /* escapa <>"' e & para não injetar HTML nem quebrar o atributo href */
  var ESC_MAP = { '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '39' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&' + ESC_MAP[c] + ';'; }); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* arquivo: leads-virgo-YYYY-MM-DD.doc (prefixo opcional do nicho entra no meio) */
  function buildDocFileName(prefix, d) {
    var now = (d instanceof Date) ? d : new Date();
    var mid = String(prefix == null ? '' : prefix).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'leads-virgo-' + (mid ? mid + '-' : '') + ymd(now) + '.doc';
  }

  /* leads: [{ name, msg, bloco (texto com \n), waUrl }] — payload já montado pelo chamador */
  function buildDocHtml(leads, targetName, socio, catLabel) {
    var list = Array.isArray(leads) ? leads : [];
    var now = new Date();
    var dateStr = pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear();
    var h = '';

    h += '<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>' + esc(DOC_TITLE) + '</title></head><body>';
    h += '<h2 style="margin:0 0 4pt">' + esc(DOC_TITLE) + '</h2>';
    h += '<p>📅 Data: ' + dateStr + '</p>';
    h += '<p>🎯 Nicho: ' + esc(catLabel || CAT_FALLBACK) + '</p>';
    h += '<p>👥 Total: ' + list.length + ' leads (' + esc(targetName || '') + ')</p>';
    if (String(socio || '').trim()) {
      h += '<p>👤 Enviado por: ' + esc(socio) + '</p>';
    }
    h += '<hr>';

    list.forEach(function (l, i) {
      var bloco = String((l && l.bloco) || '').split('\n');
      var k;
      h += '<h3 style="margin:14pt 0 2pt">' + (i + 1) + ' — ' + esc((l && l.name) || 'Empresa') + '</h3>';
      h += '<p style="margin:0 0 6pt">"' + esc((l && l.msg) || '') + '"</p>';
      h += '<ul style="margin:0;padding-left:16pt">';
      for (k = 0; k < bloco.length; k++) {
        if (!bloco[k].trim()) continue;
        h += '<li>' + esc(bloco[k]) + '</li>';
      }
      if (l && l.waUrl) {
        h += '<li>🔗 Abrir Zap: <a href="' + esc(l.waUrl) + '">' + esc(l.waUrl) + '</a></li>';
      }
      h += '</ul>';
      if (i < list.length - 1) h += '<hr>';
    });

    h += '<hr>';
    h += '<p style="margin-top:8pt;color:#6b7280">' + esc(DOC_FOOTER) + '</p>';
    h += '</body></html>';
    return h;
  }

  var api = { DOC_TITLE: DOC_TITLE, buildDocHtml: buildDocHtml, buildDocFileName: buildDocFileName };

  if (typeof window !== 'undefined') window.SHARE_DOC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
