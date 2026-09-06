import assert from 'node:assert/strict';
import fs from 'node:fs';
import {googleJson} from '../../scripts/google-auth.mjs';
import {verifyBackupManifest} from '../../scripts/verify-backup-manifest.mjs';
import {planConfirmationMigration} from './preflight.mjs';

// This function is invoked only by an explicitly selected release/test runner.
// It preserves every existing row and is safe to restart after either API boundary.
export async function applyConfirmationSchemaV2({accessToken, spreadsheetId, backupManifest,
  appliedLedger, legacyStates, dryRun = true, fetchImpl = fetch}) {
  verifyBackupManifest(backupManifest);
  assert.ok(appliedLedger.applied.some(entry => entry.id === 'telegram-confirmations-v1'));
  const schema = JSON.parse(fs.readFileSync(new URL('./schema.json', import.meta.url)));
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId);
  const range = "'" + schema.sheet.name.replaceAll("'", "''") + "'";
  const read = () => googleJson(accessToken, base + '/values/' + encodeURIComponent(range), {}, fetchImpl);
  const before = (await read()).values || [];
  const plan = planConfirmationMigration({appliedV1: true, recoveryVerified: true,
    headers: before[0] || [], extensionHasData: before.slice(1).some(row => row.slice(13).some(Boolean)), legacyStates});
  if (dryRun || plan.alreadyApplied) return {...plan, remoteStateVerified: true, writes: 0};
  const metadata = await googleJson(accessToken, base + '?fields=sheets.properties', {}, fetchImpl);
  const matches = metadata.sheets.filter(s => s.properties.title === schema.sheet.name);
  assert.equal(matches.length, 1, 'ledger must exist exactly once');
  const properties = matches[0].properties;
  const requests = [];
  if (properties.gridProperties.columnCount < 17) requests.push({appendDimension: {
    sheetId: properties.sheetId, dimension: 'COLUMNS', length: 17 - properties.gridProperties.columnCount}});
  requests.push({updateCells: {start: {sheetId: properties.sheetId, rowIndex: 0, columnIndex: 13},
    rows: [{values: plan.addHeaders.map(stringValue => ({userEnteredValue: {stringValue}}))}],
    fields: 'userEnteredValue'}});
  await googleJson(accessToken, base + ':batchUpdate', {method: 'POST', body: JSON.stringify({requests})}, fetchImpl);
  const after = (await read()).values || [];
  assert.deepEqual(after[0], schema.sheet.columns.map(c => c.name), 'migration header read-back differs');
  assert.deepEqual(after.slice(1), before.slice(1), 'migration changed historical rows');
  return {...plan, remoteStateVerified: true, writes: 1, historicalRowsPreserved: before.length - 1};
}
