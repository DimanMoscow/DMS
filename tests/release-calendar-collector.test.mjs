import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collectPlans, decodeRows, writeImmutableEvidence} from '../apps-script/scripts/collect-calendar-release.mjs';
import {loadBundle} from './helpers/apps-script-bundle.mjs';

function fixture() {
  const calendarId = 'fixture@example.test'; const now = '2026-09-14T11:30:00.000Z';
  const rows = {'Клиенты': [[], [], [], []], 'Блоки': [[], [], []], 'Оплаты': [[], [], []],
    'Журнал тренировок': [[], [], []], 'Очередь подтверждения': [[], [], []],
    'Настройки': Array.from({length: 19}, () => [])};
  rows['Настройки'][13] = ['Календарь для учёта', calendarId];
  rows['Настройки'][14] = ['Начало автоматического учёта', new Date('2026-09-01T00:00:00Z')];
  const f = loadBundle('v57');
  const native = {scan: {version: 1, calendarFingerprint: f.context.getDmsCalendarFingerprint_(calendarId),
    lastSuccessfulAt: '2026-09-14T11:21:00.000Z', lastWideVerificationAt: '2026-09-14T00:00:00.000Z'},
  generation: {syncGeneration: 114}};
  return {rows, native, now};
}
test('collector runs actual fixed-time planners and follows all raw pages including deletes without apply', async () => {
  const f = fixture(); const calls = [];
  const result = await collectPlans({...f, readCalendar: async q => {
    calls.push(q); assert.equal(q.params.showDeleted, true);
    return q.params.pageToken ? {items: []} : {items: [{id: 'deleted', status: 'cancelled'}], nextPageToken: 'last'};
  }});
  assert.ok(calls.some(q => q.params.updatedMin)); assert.ok(calls.some(q => q.params.timeMin));
  assert.equal(calls.length, 4); assert.equal(result.rawCalendar.length, 4);
  assert.equal(result.paginationComplete, true); assert.equal(result.events[0].status, 'cancelled');
  assert.deepEqual(result.candidateWrites, []); assert.deepEqual(result.baselineWrites, []);
  assert.equal(result.productionMutations, 0); assert.equal(result.before.issueCount, 0);
});
test('collector refuses incomplete API capture and redirected bundle', async () => {
  await assert.rejects(collectPlans({...fixture(), readCalendar: async () => {throw new Error('service unavailable');}}));
  const original = process.env.DMS_AUDIT_BUNDLE;
  process.env.DMS_AUDIT_BUNDLE = 'v57';
  try { await assert.rejects(collectPlans({...fixture(), readCalendar: async () => ({items: []})}), /redirect/); }
  finally { if (original === undefined) delete process.env.DMS_AUDIT_BUNDLE; else process.env.DMS_AUDIT_BUNDLE = original; }
});

test('Calendar pagination cycle fails before re-entering the synchronous planner loop', async () => {
  await assert.rejects(collectPlans({...fixture(), readCalendar: async () =>
    ({items: [], nextPageToken: 'same'})}), /pagination cycle/);
});
test('Sheet date conversion preserves dates for bundle instanceof checks; evidence is immutable and private', t => {
  const rows = decodeRows([{range: "'Очередь подтверждения'!A1:Q5", values: [['Q', 46279]]}]);
  assert.ok(rows['Очередь подтверждения'][0][1] instanceof Date);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-calendar-capture-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'capture.json');
  const hash = writeImmutableEvidence(file, {productionMutations: 0});
  assert.match(hash, /^[a-f0-9]{64}$/); assert.throws(() => writeImmutableEvidence(file, {}));
  assert.throws(() => writeImmutableEvidence(path.resolve('leaked-evidence.json'), {}), /private output/);
});
