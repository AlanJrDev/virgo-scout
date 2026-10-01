const fs = require('node:fs');
const path = require('node:path');
const { toCSV } = require('./leads');

async function saveLeads(leads = [], opts = {}) {
  const outDir = opts.outDir || './data';
  const basename = opts.basename || `leads-${new Date().toISOString().slice(0, 10)}`;
  const formats = opts.formats || ['csv', 'json', 'xlsx'];
  fs.mkdirSync(outDir, { recursive: true });
  const out = { count: leads.length };

  if (formats.includes('csv')) {
    const p = path.join(outDir, `${basename}.csv`);
    fs.writeFileSync(p, '\uFEFF' + toCSV(leads), 'utf8');
    out.csv = p;
  }
  if (formats.includes('json')) {
    const p = path.join(outDir, `${basename}.json`);
    fs.writeFileSync(p, JSON.stringify(leads, null, 2), 'utf8');
    out.json = p;
  }
  if (formats.includes('xlsx')) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.columns = [
      { header: 'name', key: 'name', width: 40 },
      { header: 'rating', key: 'rating', width: 10 },
      { header: 'reviews', key: 'reviews', width: 12 },
      { header: 'address', key: 'address', width: 50 },
      { header: 'phone', key: 'phone', width: 20 },
      { header: 'website', key: 'website', width: 40 },
      { header: 'source', key: 'source', width: 30 },
      { header: 'captured_at', key: 'captured_at', width: 25 },
    ];
    ws.addRows(leads);
    ws.getRow(1).font = { bold: true };
    const p = path.join(outDir, `${basename}.xlsx`);
    await wb.xlsx.writeFile(p);
    out.xlsx = p;
  }
  return out;
}

module.exports = { saveLeads };
