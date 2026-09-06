import fs from 'node:fs';
import {parentPort, workerData} from 'node:worker_threads';
import {googleJson, loadAuthorizationProfile, refreshGoogleAccessToken} from './google-auth.mjs';

// Deliberately no arbitrary URL/RPC capability. The sole write target is the
// private, purpose-marked isolated workbook, checked independently of the parent.
const ready = new Int32Array(workerData.ready);
let target, token, base, allowed;
function signal(buffer, value) {
  const state = new Int32Array(buffer);
  Atomics.store(state, 0, value); Atomics.notify(state, 0);
}
function convert(value) {
  if (value instanceof Date) return value.getTime() / 86400000 + 25569;
  return value ?? '';
}
function column(value) {
  let label = '';
  while (value > 0) {value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26);}
  return label;
}
try {
  target = JSON.parse(fs.readFileSync(workerData.target));
  if (target.purpose !== 'p1-isolated-validation' || !target.isolatedSpreadsheetId ||
      target.isolatedSpreadsheetId === target.sourceSpreadsheetId) throw new Error('Isolated target required');
  token = await refreshGoogleAccessToken(loadAuthorizationProfile(workerData.profile, 'writer'));
  const metadata = await googleJson(token, 'https://www.googleapis.com/drive/v3/files/' +
    encodeURIComponent(target.isolatedSpreadsheetId) + '?fields=appProperties,trashed');
  if (metadata.trashed || metadata.appProperties?.dmsPurpose !== 'p1-isolated-validation') throw new Error('Target purpose differs');
  base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(target.isolatedSpreadsheetId);
  const sheets = await googleJson(token, base + '?fields=sheets.properties(title)');
  allowed = new Set(sheets.sheets.map(s => s.properties.title));
  signal(workerData.ready, 1);
} catch {
  signal(workerData.ready, -1);
}

if (Atomics.load(ready, 0) === 1) parentPort.on('message', async request => {
  try {
    if (request.op === 'reset') {
      const entries = Object.entries(request.initial);
      if (entries.some(([name]) => !allowed.has(name))) throw new Error('Unknown test sheet');
      await googleJson(token, base + '/values:batchClear', {method: 'POST', body: JSON.stringify({
        ranges: entries.map(([name]) => "'" + name.replaceAll("'", "''") + "'")})});
      await googleJson(token, base + '/values:batchUpdate', {method: 'POST', body: JSON.stringify({
        valueInputOption: 'RAW', data: entries.map(([name, rows]) => ({
          range: "'" + name.replaceAll("'", "''") + "'!A1", values: rows.map(row => row.map(convert))}))})});
    } else if (request.op === 'write') {
      const {sheet, row, col, values} = request.event;
      if (!allowed.has(sheet) || !Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) throw new Error('Invalid test range');
      const range = "'" + sheet.replaceAll("'", "''") + "'!" + column(col) + row;
      await googleJson(token, base + '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW', {
        method: 'PUT', body: JSON.stringify({values: values.map(r => r.map(convert))})});
    } else throw new Error('Unknown isolated operation');
    signal(request.signal, 1);
  } catch {
    signal(request.signal, -1);
  }
});
