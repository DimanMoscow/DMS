import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appendActivation, readActivationJournal} from '../apps-script/scripts/release-acceptance-cli.mjs';
import {preflightBaseline, verifyPreparedTarget} from '../apps-script/scripts/production-target.mjs';
import {releaseBudget, admitWindow, rehearse} from '../apps-script/scripts/release-choreography.mjs';
import {runtimeSourceRelease, runtimeSourceHashes} from '../apps-script/scripts/runtime-source-hashes.mjs';
import {verifyRuntimeIdentity} from '../apps-script/scripts/runtime-identity.mjs';

test('prepared target pins 57 without claiming live acceptance; preflight still uses 56', () => {
  const target = JSON.parse(fs.readFileSync('apps-script/production.json', 'utf8'));
  assert.equal(verifyPreparedTarget(target), true);
  assert.equal(preflightBaseline(target).numberedVersion, 56);
  assert.equal(target.lastVerified, undefined);
  verifyRuntimeIdentity(target.runtimeIdentity, runtimeSourceHashes('apps-script/versions/v57'),
    {requireOk: false, expectedRelease: runtimeSourceRelease('apps-script/versions/v57')});
  assert.throws(() => verifyRuntimeIdentity(target.baseline.runtimeIdentity,
    runtimeSourceHashes('apps-script/versions/v57'), {requireOk: false,
      expectedRelease: runtimeSourceRelease('apps-script/versions/v57')}));
  target.releaseGate.postSyncReconciliationIssues = 3;
  assert.throws(() => verifyPreparedTarget(target));
});
test('activation journal preserves failure state, rejects corruption and refuses reinitialization', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-release-journal-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'activation.jsonl');
  assert.throws(() => readActivationJournal(file));
  appendActivation(file, {state: {phase: 'pre'}, verdict: 'ADMITTED'}, {initial: true});
  assert.throws(() => appendActivation(file, {state: {}}, {initial: true}));
  appendActivation(file, {state: {phase: 'post'}, verdict: 'NO_GO'});
  assert.equal(readActivationJournal(file).state.phase, 'post');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('NO_GO', 'PASS'));
  assert.throws(() => readActivationJournal(file), /hash differs/);
  fs.writeFileSync(file, original.trimEnd());
  assert.throws(() => readActivationJournal(file), /incomplete/);
});
test('window retains both drains/slack and rejects the old oversized budget even in a longer gap', () => {
  const budget = releaseBudget();
  assert.equal(budget.activationSeconds, 1710);
  assert.equal(budget.rollbackSeconds, 1710);
  assert.equal(budget.requiredSeconds, 4320);
  assert.equal(admitWindow({availableSeconds: 3600, downstreamReady: true, scheduledConflict: false}).admitted, false);
  assert.equal(admitWindow({availableSeconds: 4320, downstreamReady: true, scheduledConflict: false}).admitted, false);
  assert.equal(admitWindow({availableSeconds: 4320, downstreamReady: false, scheduledConflict: false}).admitted, false);
});
test('rehearsal opens before signed smoke; regression rehearses close and a fresh drain', () => {
  const normal = rehearse(); assert.equal(normal.productionMutations, 0);
  const names = normal.trace.map(x => x.step);
  assert.ok(names.indexOf('guarded-open-readback') < names.indexOf('signed-read-only-smoke'));
  const failed = rehearse({failureAt: 'signed-read-only-smoke'});
  assert.equal(failed.outcome, 'ROLLBACK_REHEARSED');
  assert.deepEqual(failed.trace.filter(x => x.phase === 'rollback').slice(0, 2).map(x => x.step), ['close-readback', 'drain']);
  assert.equal(failed.trace.filter(x => x.step === 'drain').length, 2);
});
