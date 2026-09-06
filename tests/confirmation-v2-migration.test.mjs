import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {planConfirmationMigration} from '../apps-script/migrations/telegram-confirmations-v2/preflight.mjs';

const headers = JSON.parse(fs.readFileSync('apps-script/migrations/telegram-confirmations-v2/schema.json'))
  .sheet.columns.map(c => c.name);

test('v2 additive migration preserves legacy unknown/pending and permits idempotent rerun', () => {
  const input = {appliedV1: true, recoveryVerified: true, headers: headers.slice(0, 13),
    extensionHasData: false, legacyStates: [{status: 'pending', hasPendingOperation: true}, {status: 'unknown'}]};
  const plan = planConfirmationMigration(input);
  assert.equal(plan.manualReview, 2);
  assert.equal(plan.deleteHistory, false);
  assert.equal(plan.addHeaders.length, 4);
  assert.equal(plan.deployable, false);
  assert.equal(plan.remoteStateVerified, false);
  assert.deepEqual(planConfirmationMigration({...input, headers}).addHeaders, []);
});

test('v2 migration refuses absent recovery, unapplied v1, and occupied extension', () => {
  const input = {appliedV1: true, recoveryVerified: true, headers: headers.slice(0, 13), extensionHasData: false, legacyStates: []};
  for (const change of [{appliedV1: false}, {recoveryVerified: false}, {extensionHasData: true}, {headers: ['wrong']}]) {
    assert.throws(() => planConfirmationMigration({...input, ...change}));
  }
});
