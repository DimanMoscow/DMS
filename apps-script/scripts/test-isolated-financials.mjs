import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {loadBundle} from '../../tests/helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from '../../tests/helpers/memory-workbook.mjs';
import {financialFixture, financialMismatches} from '../../tests/helpers/financial-fixture.mjs';
import {googleJson, loadAuthorizationProfile, refreshGoogleAccessToken} from './google-auth.mjs';
import {sourceTreeSha256} from './source-integrity.mjs';
import {assertPrivateRegularFile} from '../../scripts/path-policy.mjs';
import {applyFinancialMigration} from '../migrations/financial-formulas-v1/apply.mjs';

const privateRoot = process.argv[2]; assert.ok(privateRoot && path.isAbsolute(privateRoot));
const targetPath = path.join(privateRoot, 'p1-isolated-target.json');
const profile = path.join(privateRoot, 'writer-profile.json');
assertPrivateRegularFile(targetPath, process.cwd(), 'isolated target'); assertPrivateRegularFile(profile, process.cwd(), 'writer profile');
const target = JSON.parse(fs.readFileSync(targetPath));
assert.equal(target.purpose, 'p1-isolated-validation'); assert.notEqual(target.isolatedSpreadsheetId, target.sourceSpreadsheetId);
const token = await refreshGoogleAccessToken(loadAuthorizationProfile(profile, 'writer'));
const purpose = await googleJson(token, 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(target.isolatedSpreadsheetId) + '?fields=appProperties,trashed');
assert.equal(purpose.appProperties?.dmsPurpose, target.purpose); assert.equal(purpose.trashed, false);
const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(target.isolatedSpreadsheetId);
const names = ['Клиенты', 'Блоки', 'Оплаты', 'Журнал тренировок'];
const read = async render => {
  const response = await googleJson(token, base + '/values:batchGet?' + names.map(n => 'ranges=' + encodeURIComponent("'" + n + "'")).join('&') + '&valueRenderOption=' + render);
  return Object.fromEntries(response.valueRanges.map((r, i) => [names[i], r.values || []]));
};
const plan = loadBundle('v51').context.getDmsFinancialFormulaPlan_();
const backupManifest = JSON.parse(fs.readFileSync(path.join(privateRoot, 'dms-v50-backup-2026-09-06.json')));
const appliedLedger = JSON.parse(fs.readFileSync('apps-script/migrations/ledger.json'));
// This is the isolated workbook's ledger state, not a production applied claim.
const ledgerHeaders = await googleJson(token, base + '/values/' + encodeURIComponent("'Журнал операций Telegram'!A1:Q1"));
assert.equal(ledgerHeaders.values[0].length, 17);
appliedLedger.applied.push({id: 'telegram-confirmations-v2'});
const results = [];
for (const scenario of ['old-boundaries', 'boundaries', 'production-size', 'tenfold']) {
  const fixture = financialFixture(scenario === 'tenfold' ? 10 : 1, scenario.includes('boundar'));
  const meta = await googleJson(token, base + '?fields=sheets.properties');
  const resize = [];
  for (const sheet of meta.sheets) {
    const needed = fixture.data[sheet.properties.title]?.length;
    if (needed && needed > sheet.properties.gridProperties.rowCount) resize.push({appendDimension: {
      sheetId: sheet.properties.sheetId, dimension: 'ROWS', length: needed - sheet.properties.gridProperties.rowCount + 100}});
  }
  if (resize.length) await googleJson(token, base + ':batchUpdate', {method: 'POST', body: JSON.stringify({requests: resize})});
  await googleJson(token, base + '/values:batchClear', {method: 'POST', body: JSON.stringify({ranges: names.map(n => "'" + n + "'")})});
  await googleJson(token, base + '/values:batchUpdate', {method: 'POST', body: JSON.stringify({valueInputOption: 'RAW',
    data: names.map(name => ({range: "'" + name + "'!A1", values: fixture.data[name]}))})});
  let formulas = Object.entries(plan).flatMap(([name, cells]) => Object.entries(cells).map(([address, formula]) => ({range: "'" + name + "'!" + address, values: [[formula]]})));
  if (scenario === 'old-boundaries') {
    const book = memoryWorkbook(fixture.data); const c = loadBundle('v50', {SpreadsheetApp: book.service}).context;
    c.repairBlockFormulas_(book.sheets.get('Блоки')); c.repairClientDebtFormulas_(book.sheets.get('Клиенты'));
    formulas = book.writes.map(event => ({range: "'" + event.sheet + "'!" + String.fromCharCode(64 + event.col) + event.row, values: event.values}));
  }
  const started = performance.now();
  if (scenario === 'old-boundaries') {
    await googleJson(token, base + '/values:batchClear', {method: 'POST', body: JSON.stringify({
      ranges: ["'Клиенты'!F5:J", "'Блоки'!I4:J", "'Блоки'!N4:O"]})});
    await googleJson(token, base + '/values:batchUpdate', {method: 'POST', body: JSON.stringify({valueInputOption: 'USER_ENTERED', data: formulas})});
  } else {
    const args = {accessToken: token, spreadsheetId: target.isolatedSpreadsheetId, backupManifest, appliedLedger,
      dryRun: false, executionsDrained: true};
    const migration = await applyFinancialMigration(args); assert.equal(migration.writes, 1);
    assert.equal((await applyFinancialMigration(args)).writes, 0, 'Financial migration must be idempotent');
  }
  let actual, errors;
  for (let attempt = 0; attempt < 8; attempt++) {
    actual = await read('UNFORMATTED_VALUE'); errors = financialMismatches(actual, fixture.expected);
    if (scenario === 'old-boundaries' || !errors.length) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const elapsedMs = Math.round(performance.now() - started);
  if (scenario === 'old-boundaries') assert.ok(errors.length > 0, 'Old financial truncation must reproduce');
  else assert.equal(errors.length, 0, 'Native Google Sheets financial values differ: ' + JSON.stringify(errors.slice(0, 3)));
  if (scenario !== 'old-boundaries') {
    const grid = await read('FORMULA'); const book = memoryWorkbook(actual);
    for (const [name, sheet] of book.sheets) {
      const getRange = sheet.getRange.bind(sheet);
      sheet.getRange = (...args) => {
        const range = getRange(...args);
        const formulasAt = () => Array.from({length: range.getNumRows()}, (_, i) => Array.from({length: range.getNumColumns()}, (_, j) => {
          const v = grid[name]?.[range.getRow() + i - 1]?.[range.getColumn() + j - 1];
          return typeof v === 'string' && v.startsWith('=') ? v : '';
        }));
        return {...range, getFormulas: formulasAt, getFormula: () => formulasAt()[0][0]};
      };
    }
    const c = loadBundle('v51', {SpreadsheetApp: book.service}).context;
    const health = c.getDmsFinancialHealth_(); assert.equal(health.ok, true, JSON.stringify(health));
    const row = Object.values(fixture.expected.clients)[0].row;
    book.sheets.get('Клиенты').rows[row - 1][9] += 1;
    assert.equal(c.getDmsFinancialHealth_().ok, false, 'Guard must detect a wrong number even with the correct formula');
  }
  results.push({scenario, matched: errors.length === 0, mismatchCount: errors.length, writeAndReadMs: elapsedMs});
  console.log(JSON.stringify(results.at(-1)));
  if (scenario === 'boundaries') {
    const growthStart = performance.now();
    const metadata = await googleJson(token, base + '?fields=sheets.properties');
    const limits = {'Клиенты': 1200, 'Блоки': 1200, 'Оплаты': 2800, 'Журнал тренировок': 2800};
    const requests = metadata.sheets.filter(s => limits[s.properties.title] > s.properties.gridProperties.rowCount).map(s => ({
      appendDimension: {sheetId: s.properties.sheetId, dimension: 'ROWS', length: limits[s.properties.title] - s.properties.gridProperties.rowCount}}));
    if (requests.length) await googleJson(token, base + ':batchUpdate', {method: 'POST', body: JSON.stringify({requests})});
    await googleJson(token, base + '/values:batchUpdate', {method: 'POST', body: JSON.stringify({valueInputOption: 'RAW', data: [
      {range: "'Клиенты'!A1105:E1105", values: [['CL-growth', 'Synthetic growth', 'Активен', 'BL-growth', 'Блок 10']]},
      {range: "'Блоки'!A1105:H1105", values: [['BL-growth', 'CL-growth', 'Блок 10', 'Активен', '', '', '', 10]]},
      {range: "'Блоки'!K1105:L1105", values: [[30000, 3000]]},
      {range: "'Журнал тренировок'!A2700:H2700", values: [['TR-growth', '', 'CL-growth', 'BL-growth', 'Блок 10', '', 'Проведена', 3000]]},
      {range: "'Оплаты'!A2700:J2700", values: [['PAY-growth', '', 'CL-growth', 'BL-growth', 'Оплата', 'Перевод', 777, 'Подтверждён', '', '']]}
    ]})});
    fixture.expected.clients['CL-growth'] = {row: 1105, columns: {6: 1, 7: 9, 8: 30000, 9: 777, 10: 29223}};
    fixture.expected.blocks['BL-growth'] = {row: 1105, columns: {9: 1, 10: 9, 14: 777, 15: 29223}};
    let growthErrors;
    for (let attempt = 0; attempt < 6; attempt++) {
      growthErrors = financialMismatches(await read('UNFORMATTED_VALUE'), fixture.expected);
      if (!growthErrors.length) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(growthErrors.length, 0, 'Growth must work without reinstalling formulas: ' + JSON.stringify(growthErrors.slice(0, 2)));
    results.push({scenario: 'growth-after-install', matched: true, mismatchCount: 0, formulaReinstalls: 0, writeAndReadMs: Math.round(performance.now() - growthStart)});
    console.log(JSON.stringify(results.at(-1)));
  }
}
const root = 'apps-script/candidates/v51';
const report = {verifiedAt: new Date().toISOString(), candidateTreeSha256: sourceTreeSha256(root, fs.readdirSync(root)),
  results, formulaEngine: 'Native Google Sheets', guard: 'Full Apps Script bundle with actual values/formulas through a service adapter', productionWrites: 0};
fs.writeFileSync(path.join(privateRoot, 'p1-isolated-financials-' + Date.now() + '.json'), JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
