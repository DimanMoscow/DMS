import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {loadBundle} from '../../tests/helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from '../../tests/helpers/memory-workbook.mjs';
import {googleJson, loadAuthorizationProfile, refreshGoogleAccessToken} from './google-auth.mjs';
import {sourceTreeSha256} from './source-integrity.mjs';
import {assertPrivateRegularFile} from '../../scripts/path-policy.mjs';
import {applyConfirmationSchemaV2} from '../migrations/telegram-confirmations-v2/apply.mjs';

const privateRoot = process.argv[2];
assert.ok(privateRoot && path.isAbsolute(privateRoot), 'absolute private operations directory required');
const targetFile = path.join(privateRoot, 'p1-isolated-target.json');
assertPrivateRegularFile(targetFile, process.cwd(), 'isolated target');
const target = JSON.parse(fs.readFileSync(targetFile));
assert.notEqual(target.isolatedSpreadsheetId, target.sourceSpreadsheetId);
assert.equal(target.purpose, 'p1-isolated-validation');
const profile = path.join(privateRoot, 'writer-profile.json');
assertPrivateRegularFile(profile, process.cwd(), 'writer profile');
const token = await refreshGoogleAccessToken(loadAuthorizationProfile(profile, 'writer'));
const metadata = await googleJson(token, 'https://www.googleapis.com/drive/v3/files/' +
  encodeURIComponent(target.isolatedSpreadsheetId) + '?fields=appProperties,trashed');
assert.equal(metadata.appProperties?.dmsPurpose, 'p1-isolated-validation');
assert.equal(metadata.trashed, false);
const backupManifest = JSON.parse(fs.readFileSync(path.join(privateRoot, 'dms-v50-backup-2026-09-06.json')));
const appliedLedger = JSON.parse(fs.readFileSync('apps-script/migrations/ledger.json'));
const migrationArgs = {accessToken: token, spreadsheetId: target.isolatedSpreadsheetId, backupManifest,
  appliedLedger, legacyStates: [], dryRun: false};
const migration = await applyConfirmationSchemaV2(migrationArgs);
const rerun = await applyConfirmationSchemaV2(migrationArgs);
assert.equal(rerun.writes, 0);

const ready = new SharedArrayBuffer(4);
const worker = new Worker(new URL('./isolated-sheets-worker.mjs', import.meta.url), {
  workerData: {ready, target: targetFile, profile}});
function wait(buffer) {
  const signal = new Int32Array(buffer);
  Atomics.wait(signal, 0, 0, 35000);
  assert.equal(Atomics.load(signal, 0), 1, 'Isolated Google Sheets operation failed or timed out');
}
function rpc(message) {
  const signal = new SharedArrayBuffer(4);
  worker.postMessage({...message, signal}); wait(signal);
}
const headers = JSON.parse(fs.readFileSync('apps-script/migrations/telegram-confirmations-v2/schema.json'))
  .sheet.columns.map(c => c.name);
const results = [];
try {
  wait(ready);
  for (const boundary of ['none', 'pending', 'started', 'business', 'result', 'committed']) {
    const initial = {
      'Клиенты': [[], [], [], [], ['CL-A', 'Synthetic isolated client', 'Активен', '', '', 0, 0, 0, 0, 0, 'Разовые — 3500']],
      'Оплаты': [[], [], ['ID']], 'Журнал действий бота': [['ID']], 'Журнал операций Telegram': [headers],
      'Журнал тренировок': [[], [], ['ID']], 'Блоки': [[], [], ['ID']],
      'Очередь подтверждения': [[], [], ['ID']], 'Настройки': [['Key', 'Value']],
    };
    rpc({op: 'reset', initial});
    const book = memoryWorkbook(initial);
    book.hooks.before = event => rpc({op: 'write', event});
    let properties;
    const execute = () => {
      const fixture = loadBundle('v51', {SpreadsheetApp: book.service,
        LockService: {getDocumentLock: () => null, getScriptLock: () => ({tryLock: () => true, releaseLock() {}})},
        UrlFetchApp: {fetch: () => ({getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ok: true, result: {message_id: 7}})})}});
      if (properties) for (const [key, value] of properties) fixture.properties.set(key, value);
      fixture.properties.set('DMS_TG_BOT_TOKEN', 'fixture');
      properties = fixture.properties; return fixture.context;
    };
    let context = execute();
    const state = {phase: 'confirm', clientId: 'CL-A', clientName: 'Synthetic isolated client', blockId: '', amount: 100, method: 'Перевод'};
    context.putTelegramPaymentState_('1001', '2002', state);
    const ticket = context.createTelegramConfirmation_('1001', '2002', '7', 'payment',
      context.makeTelegramStateConfirmationPayload_('pc:yes', 'payment', state));
    const parsed = context.parseTelegramConfirmationCallback_(ticket.callbackData);
    const query = {id: 'isolated-query', from: {id: '1001'}, message: {message_id: 7, chat: {id: '2002'}}};
    context.putTelegramPaymentState_('1001', '2002', {...state, amount: 999});
    book.hooks.after = event => {
      if ((boundary === 'business' && event.sheet === 'Оплаты') ||
          (event.sheet === 'Журнал операций Telegram' && event.values[0][4] === boundary)) throw new Error('injected boundary');
    };
    if (boundary === 'none') context.processTelegramSecureCallback_(query, parsed);
    else assert.throws(() => context.processTelegramSecureCallback_(query, parsed), /injected boundary/);
    book.hooks.after = null;
    context = execute();
    const result = context.processTelegramSecureCallback_(query, parsed);
    context.processTelegramSecureCallback_(query, parsed);
    const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(target.isolatedSpreadsheetId);
    const actual = await googleJson(token, base + '/values/' + encodeURIComponent("'Оплаты'!A4:J") + '?valueRenderOption=UNFORMATTED_VALUE');
    const payments = (actual.values || []).filter(row => row[0]);
    assert.equal(payments.length, boundary === 'started' ? 0 : 1);
    if (payments.length) assert.equal(payments[0][6], 100);
    results.push({boundary, status: result.status || result.code, paymentRows: payments.length, passed: true});
    console.log('Isolated Sheets boundary passed: ' + boundary);
  }
  const directory = 'apps-script/candidates/v51';
  const report = {verifiedAt: new Date().toISOString(), candidateTreeSha256: sourceTreeSha256(directory, fs.readdirSync(directory).sort()),
    migration: {writes: migration.writes, idempotentRerun: true}, results,
    execution: 'Complete Apps Script bundle in Node VM; actual isolated Sheets API writes and read-back',
    limitations: ['ScriptLock is emulated; concurrency is covered by separate shared-mutex tests',
      'Telegram and Calendar transports are fixtures; no production mutations'], productionWrites: 0};
  fs.writeFileSync(path.join(privateRoot, 'p1-isolated-operations-' + Date.now() + '.json'), JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({isolatedWriteTestsPassed: results.length, migrationIdempotent: true, productionWrites: 0}));
} finally {await worker.terminate();}
