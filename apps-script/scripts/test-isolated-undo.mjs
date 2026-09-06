import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {undoFixture} from '../../tests/helpers/undo-fixture.mjs';
import {googleJson, loadAuthorizationProfile, refreshGoogleAccessToken} from './google-auth.mjs';
import {sourceTreeSha256} from './source-integrity.mjs';
import {assertPrivateRegularFile} from '../../scripts/path-policy.mjs';

const privateRoot = process.argv[2];
assert.ok(privateRoot && path.isAbsolute(privateRoot));
const targetFile = path.join(privateRoot, 'p1-isolated-target.json');
const profile = path.join(privateRoot, 'writer-profile.json');
assertPrivateRegularFile(targetFile, process.cwd(), 'isolated target');
assertPrivateRegularFile(profile, process.cwd(), 'writer profile');
const target = JSON.parse(fs.readFileSync(targetFile));
assert.equal(target.purpose, 'p1-isolated-validation');
assert.notEqual(target.isolatedSpreadsheetId, target.sourceSpreadsheetId);
const token = await refreshGoogleAccessToken(loadAuthorizationProfile(profile, 'writer'));
const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(target.isolatedSpreadsheetId);
const ready = new SharedArrayBuffer(4);
const worker = new Worker(new URL('./isolated-sheets-worker.mjs', import.meta.url), {workerData: {ready, target: targetFile, profile}});
function wait(buffer) {
  const state = new Int32Array(buffer); Atomics.wait(state, 0, 0, 35000);
  assert.equal(Atomics.load(state, 0), 1, 'Isolated Sheets operation failed');
}
function rpc(message) {const signal = new SharedArrayBuffer(4); worker.postMessage({...message, signal}); wait(signal);}
function snapshot(f) {return Object.fromEntries([...f.book.sheets].map(([name, sheet]) => [name, sheet.rows]));}
const results = [];
try {
  wait(ready);
  for (const scenario of ['immediate', 'Journal', 'Payment', 'Block', 'changed original']) {
    const f = undoFixture({paid: true}); const id = f.result.clientId;
    if (scenario === 'Journal') f.book.sheets.get('Журнал тренировок').appendRow(['TR-1', '', id, 'BL-001']);
    if (scenario === 'Payment') f.book.sheets.get('Оплаты').appendRow(['PAY-later', '', id, 'BL-001']);
    if (scenario === 'Block') f.book.sheets.get('Блоки').appendRow(['BL-002', id, 'Блок 10', 'Активен']);
    if (scenario === 'changed original') f.book.sheets.get('Клиенты').getRange(5, 2).setValue('Changed name');
    rpc({op: 'reset', initial: snapshot(f)});
    let writes = 0;
    f.book.hooks.before = event => {rpc({op: 'write', event}); writes++;};
    if (scenario === 'immediate') {
      f.undo(); const firstWrites = writes;
      assert.throws(() => f.undo(), /уже отменено/); assert.equal(writes, firstWrites);
    } else {assert.throws(() => f.undo(), /state changed/); assert.equal(writes, 0);}
    const ranges = ['Клиенты', 'Блоки', 'Оплаты', 'Журнал тренировок', 'Очередь подтверждения'];
    const actual = await googleJson(token, base + '/values:batchGet?' + ranges.map(name =>
      'ranges=' + encodeURIComponent("'" + name + "'")).join('&') + '&valueRenderOption=UNFORMATTED_VALUE');
    const data = actual.valueRanges.map(x => x.values || []);
    assert.equal(data[0][4][0], id);
    assert.equal(data[0][4][2], scenario === 'immediate' ? 'Архив' : 'Активен');
    assert.equal(data[1][3][3], scenario === 'immediate' ? 'Закрыт' : 'Активен');
    assert.equal(data[2][3][7], scenario === 'immediate' ? 'Отменён' : 'Подтверждён');
    const clients = new Set(data[0].slice(4).map(r => r[0]));
    const blocks = new Set(data[1].slice(3).map(r => r[0]));
    for (const [index, clientCol, blockCol] of [[1, 1, null], [2, 2, 3], [3, 2, 3], [4, 8, 10]]) {
      for (const row of data[index].slice(3)) {
        if (row[clientCol]) assert.ok(clients.has(row[clientCol]));
        if (blockCol !== null && row[blockCol]) assert.ok(blocks.has(row[blockCol]));
      }
    }
    results.push({scenario, passed: true, undoWrites: writes, danglingReferences: 0});
    console.log('Isolated undo passed: ' + scenario);
  }
  const root = 'apps-script/candidates/v51';
  const report = {verifiedAt: new Date().toISOString(), candidateTreeSha256: sourceTreeSha256(root, fs.readdirSync(root)),
    results, productionWrites: 0, execution: 'Full bundle onboarding prepares synthetic state; undo performs actual isolated Sheets API writes/read-back',
    limitations: ['Node VM and emulated ScriptLock; separate independent-execution concurrency tests']};
  fs.writeFileSync(path.join(privateRoot, 'p1-isolated-undo-' + Date.now() + '.json'), JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({isolatedUndoPassed: results.length, productionWrites: 0}));
} finally {await worker.terminate();}
