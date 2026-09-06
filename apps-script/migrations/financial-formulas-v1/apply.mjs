import assert from 'node:assert/strict';
import {googleJson} from '../../scripts/google-auth.mjs';
import {verifyBackupManifest} from '../../scripts/verify-backup-manifest.mjs';
import {planFinancialMigration} from './preflight.mjs';

export async function applyFinancialMigration({accessToken, spreadsheetId, backupManifest, appliedLedger,
  dryRun = true, executionsDrained = false, fetchImpl = fetch}) {
  verifyBackupManifest(backupManifest);
  assert.ok(appliedLedger.applied.some(x => x.id === 'telegram-confirmations-v2'));
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId);
  const names = ['Клиенты', 'Блоки'];
  const read = async () => {
    const response = await googleJson(accessToken, base + '/values:batchGet?' + names.map(name =>
      'ranges=' + encodeURIComponent("'" + name + "'")).join('&') + '&valueRenderOption=FORMULA', {}, fetchImpl);
    return Object.fromEntries(response.valueRanges.map((range, i) => [names[i], range.values || []]));
  };
  const before = await read();
  const plan = planFinancialMigration({recoveryVerified: true, appliedLedgerVerified: true, formulas: before});
  function inputs(grid) {
    return Object.fromEntries(names.map(name => [name, grid[name].map((row, index) => row.map((value, column) => {
      const spec = Object.values(plan.schema.sheets).find(s => s.name === name);
      if (index + 1 >= spec.firstRow && spec.computedColumns.includes(column + 1)) return '';
      if (name === 'Клиенты' && column === 4 && index >= 4 && typeof value === 'string' && value.startsWith('=')) return '[format formula]';
      return value;
    }))]));
  }
  const anchors = Object.values(plan.schema.sheets).flatMap(s => Object.entries(s.anchors).map(([address, formula]) => ({name: s.name, address, formula})));
  const normalize = x => String(x || '').replace(/;/g, ',').replace(/\s/g, '');
  const alreadyApplied = anchors.every(a => {
    const row = Number(a.address.slice(1)); const col = a.address.charCodeAt(0) - 65;
    return normalize(before[a.name][row - 1]?.[col]) === normalize(a.formula) &&
      !before[a.name].slice(row).some(r => typeof r[col] === 'string' && r[col].startsWith('='));
  }) && plan.formatRepairs.length === 0;
  if (dryRun || alreadyApplied) return {alreadyApplied, remoteStateVerified: true, writes: 0, formatRepairs: plan.formatRepairs.length};
  assert.equal(executionsDrained, true, 'Old writer execution drain required');
  const metadata = await googleJson(accessToken, base + '?fields=sheets.properties', {}, fetchImpl);
  const requests = [];
  for (const spec of Object.values(plan.schema.sheets)) {
    const properties = metadata.sheets.find(s => s.properties.title === spec.name)?.properties;
    assert.ok(properties);
    for (const column of spec.computedColumns) requests.push({repeatCell: {
      range: {sheetId: properties.sheetId, startRowIndex: spec.firstRow - 1, startColumnIndex: column - 1, endColumnIndex: column},
      cell: {}, fields: 'userEnteredValue'}});
    for (const [address, formulaValue] of Object.entries(spec.anchors)) requests.push({updateCells: {
      start: {sheetId: properties.sheetId, rowIndex: Number(address.slice(1)) - 1, columnIndex: address.charCodeAt(0) - 65},
      rows: [{values: [{userEnteredValue: {formulaValue}}]}], fields: 'userEnteredValue'}});
    if (spec.name === 'Клиенты') for (const repair of plan.formatRepairs) requests.push({updateCells: {
      start: {sheetId: properties.sheetId, rowIndex: repair.row - 1, columnIndex: 4},
      rows: [{values: [{userEnteredValue: {formulaValue: repair.formula}}]}], fields: 'userEnteredValue'}});
  }
  await googleJson(accessToken, base + ':batchUpdate', {method: 'POST', body: JSON.stringify({requests})}, fetchImpl);
  const after = await read();
  // Compare entered input values/formulas, excluding only the declared derived columns.
  const trim = obj => JSON.stringify(obj, (_, value) => Array.isArray(value) ? (() => {
    const row = [...value]; while (row.length && (row.at(-1) === '' || Array.isArray(row.at(-1)) && row.at(-1).every(v => v === ''))) row.pop(); return row;
  })() : value);
  assert.equal(trim(inputs(after)), trim(inputs(before)), 'Financial migration changed an input cell');
  for (const a of anchors) assert.equal(normalize(after[a.name][Number(a.address.slice(1)) - 1]?.[a.address.charCodeAt(0) - 65]), normalize(a.formula));
  return {alreadyApplied: false, remoteStateVerified: true, writes: 1, inputCellsPreserved: true, numericPostCheckRequired: true};
}
