import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {googleJson} from './google-auth.mjs';
import {sha256} from './source-integrity.mjs';
import {verifyBackupManifest} from './verify-backup-manifest.mjs';
import {isOutsidePath} from '../../scripts/path-policy.mjs';

const drive = 'https://www.googleapis.com/drive/v3/files/';
export async function createP1PrivateRecovery({accessToken, sourceSpreadsheetId, privateRoot, label,
  appsScriptVersion = 'v50', fetchImpl = fetch}) {
  assert.ok(path.isAbsolute(privateRoot) && isOutsidePath(process.cwd(), privateRoot));
  assert.match(label, /^[a-z0-9-]+$/);
  const contract = JSON.parse(fs.readFileSync('apps-script/backup/contract.json'));
  const createdAt = new Date().toISOString();
  const stamp = Date.now();
  const read = id => googleJson(accessToken, 'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(id) + '?includeGridData=true&fields=' + encodeURIComponent(
    'properties(locale,timeZone),sheets(properties(title,gridProperties),merges,data(startRow,startColumn,rowData(values(userEnteredValue,userEnteredFormat,dataValidation,note))))'), {}, fetchImpl);
  const copy = async (id, suffix) => {
    const file = await googleJson(accessToken, drive + encodeURIComponent(id) + '/copy?fields=id', {
      method: 'POST', body: JSON.stringify({name: 'DMS P1 ' + label + ' ' + suffix + ' ' + stamp,
        appProperties: {dmsPurpose: 'p1-private-recovery'}})}, fetchImpl);
    assert.ok(file.id && file.id !== id && file.id !== sourceSpreadsheetId);
    const permissions = await googleJson(accessToken, drive + encodeURIComponent(file.id) + '/permissions?fields=permissions(type,role)', {}, fetchImpl);
    assert.ok(permissions.permissions.length > 0);
    assert.ok(permissions.permissions.every(p => p.type === 'user' && p.role === 'owner'), 'Recovery copy must be owner-only');
    return file.id;
  };
  const normalize = payload => ({properties: payload.properties,
    sheets: payload.sheets.map(s => ({...s, merges: (s.merges || []).map(m => {
      const value = {...m}; delete value.sheetId; return value;
    })})).sort((a, b) => a.properties.title.localeCompare(b.properties.title, 'ru'))});
  const fingerprint = payload => sha256(JSON.stringify(normalize(payload)));
  const source = await read(sourceSpreadsheetId);
  assert.deepEqual(source.sheets.map(s => s.properties.title).sort(), [...contract.requiredSheets].sort());
  const backupId = await copy(sourceSpreadsheetId, 'backup');
  const backup = await read(backupId);
  assert.equal(fingerprint(backup), fingerprint(source), 'Backup differs from source');
  assert.equal(fingerprint(await read(sourceSpreadsheetId)), fingerprint(source), 'Source changed while copying');
  const copyVerifiedAt = new Date().toISOString();
  const restoreId = await copy(backupId, 'restore');
  assert.equal(fingerprint(await read(restoreId)), fingerprint(backup), 'Isolated restore differs');
  const restoredAt = new Date().toISOString();
  const hash = value => sha256(JSON.stringify(value));
  const sheets = source.sheets.map(s => {
    const rows = (s.data || []).flatMap(d => d.rowData || []);
    return {name: s.properties.title, rowCount: s.properties.gridProperties.rowCount,
      headerSha256: hash(rows.slice(0, 4).map(r => (r.values || []).map(v => v.userEnteredValue || {}))),
      formulaSha256: hash(rows.map(r => (r.values || []).map(v => v.userEnteredValue?.formulaValue || ''))),
      validationSha256: hash(rows.map(r => (r.values || []).map(v => v.dataValidation || {})))};
  });
  const structure = [...sheets].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(s => JSON.stringify(s)).join('\n') + '\n';
  const manifest = {formatVersion: 1, provider: contract.provider, appsScriptVersion,
    sourceSpreadsheetRefSha256: sha256(sourceSpreadsheetId), backupFileRefSha256: sha256(backupId),
    createdAt, copyVerifiedAt, migrationLedgerSha256: sha256(fs.readFileSync('apps-script/migrations/ledger.json')),
    sheetStructureSha256: sha256(structure), sheets, retention: contract.retention,
    restoreTest: {isolatedWorkbook: true, status: 'verified', verifiedAt: restoredAt}};
  verifyBackupManifest(manifest, {productionPointer: {numberedVersion: Number(appsScriptVersion.slice(1))}});
  const prefix = path.join(privateRoot, 'p1-' + label + '-' + stamp);
  fs.writeFileSync(prefix + '-recovery.json', JSON.stringify({sourceSpreadsheetId, backupId, restoreId,
    sourceFingerprint: fingerprint(source), restoredAt, source}, null, 2), {flag: 'wx', mode: 0o600});
  fs.writeFileSync(prefix + '-manifest.json', JSON.stringify(manifest, null, 2), {flag: 'wx', mode: 0o600});
  return {manifest, manifestPath: prefix + '-manifest.json', sheetCount: sheets.length,
    copyVerifiedAt, restoredAt, sourceFingerprint: fingerprint(source)};
}
