const L = require('../data/advogados-df-max.json');
const n = L.length;
const pct = (arr) => Math.round((100 * arr.length) / n);
console.log('total=' + n);
console.log('junkResultados=' + L.filter((l) => /^resultados?$/i.test((l.name || '').trim())).length);
console.log('phone=' + pct(L.filter((l) => /\d{8,}/.test(l.phone || ''))) + '%');
console.log('site=' + pct(L.filter((l) => l.website)) + '%');
console.log('addr=' + pct(L.filter((l) => l.address)) + '%');
console.log('rating=' + pct(L.filter((l) => l.rating != null)) + '%');
