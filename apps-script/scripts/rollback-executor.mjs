import assert from 'node:assert/strict';
import {fingerprint} from './release-reconciliation.mjs';

export const V56_SAFE_COMMANDS = Object.freeze(['/start', '/clients', '/balances', '/debt', '/report']);
export const ROLLBACK_ADAPTERS = Object.freeze(['close', 'readInterlock', 'inventory', 'putHead',
  'readHead', 'putMapping', 'readMapping', 'rollbackWeb', 'readWeb', 'readRuntime',
  'open', 'signedReads', 'reconcile']);

// Every adapter is prepared/authenticated before admission. This executor has no
// browser fallback hidden in the window, no credential discovery and no build.
// readHead/readMapping expose normalized source/config, not deployment labels.
export async function executeRollback({adapters, expected, authorization, clock, record, transitionalWeb}) {
  assert.equal(authorization, 'EXECUTE_EXACT_V56_ROLLBACK');
  for (const name of ROLLBACK_ADAPTERS.filter(name=>!transitionalWeb||name!=='rollbackWeb')) assert.equal(typeof adapters[name], 'function', 'missing adapter: ' + name);
  for (const name of ['now', 'sleep']) assert.equal(typeof clock[name], 'function');
  assert.equal(typeof record, 'function');
  assert.equal(expected.mapping.versionNumber, 56);
  assert.match(expected.web.sha, /^[a-f0-9]{40}$/);
  assert.ok(expected.web.deploymentId && expected.head.length > 0);
  if(transitionalWeb){
    assert.equal(transitionalWeb.phase,'v56-v57-transition');
    assert.equal(transitionalWeb.webSha,expected.web.sha);
    assert.deepEqual(transitionalWeb.numberedTrees,[
      '873ec728daf92883c31f67eed8857b092360a7fe1fbba3e3d30d316379470a7d',
      '332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c']);
    assert.equal(transitionalWeb.compatibilityPassed,true);
  }
  const trace = [];
  async function step(name, run, verify, timeoutMs = 30000) {
    const started = clock.now(); const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(); reject(new Error(name + ' transport deadline; outstanding effects require readback'));
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([run(controller.signal), deadline]);
      assert.ok(clock.now() - started <= timeoutMs, name + ' deadline exceeded');
      await verify(result);
      const receipt = {name, status: 'PASS', durationMs: clock.now() - started};
      await record(receipt); trace.push(receipt); return result;
    } catch (error) {
      await record({name, status: 'STOP', durationMs: clock.now() - started});
      throw error;
    } finally { clearTimeout(timer); }
  }
  // Mutation responses are not proof. Lost responses go to independent readback;
  // never repeat a PUT merely because its response was lost. Adapters must settle
  // on AbortSignal before readback; a non-settling transport is not admissible.
  async function effectThenRead(name, effect, read, verify) {
    return step(name, async signal => {
      let ambiguous = false;
      try { await effect(signal); } catch { ambiguous = true; }
      if (signal.aborted) throw new Error(name + ' transport deadline; reconcile before resuming');
      const result = await read(signal);
      return {result, ambiguous};
    }, receipt => verify(receipt.result));
  }
  const verifyWeb=result=>{assert.equal(result.state,'READY');assert.equal(result.sha,expected.web.sha);
    assert.equal(result.deploymentId,expected.web.deploymentId);};
  if(transitionalWeb)await step('preflight-transitional-web',adapters.readWeb,verifyWeb);
  const closed = await effectThenRead('closed-readback', adapters.close, adapters.readInterlock, state => {
    assert.equal(state.open, false); assert.ok(Number.isFinite(state.drainStartedAt));
    assert.ok(state.drainStartedAt >= clock.now() - 30000 && state.drainStartedAt <= clock.now(), 'fresh drain required');
  });
  const drainStart = closed.result.drainStartedAt;
  while (clock.now() - drainStart < 420000) await clock.sleep(Math.min(30000, 420000 - (clock.now() - drainStart)));
  await step('drained-inventory', adapters.inventory, result => {
    assert.equal(result.open, false); assert.equal(result.drainStartedAt, drainStart);
    assert.ok(clock.now() - result.drainStartedAt >= 420000);
    assert.equal(result.originalDocumentContext, true);
    for (const key of ['mutatingExecutions', 'pending', 'stale', 'manualReview', 'startedWithoutResult'])
      assert.equal(result[key], 0, key + ' blocks rollback');
  });
  await effectThenRead('restore-head', signal => adapters.putHead(expected.head, signal), adapters.readHead,
    result => assert.equal(fingerprint(result), fingerprint(expected.head), 'HEAD source differs'));
  await effectThenRead('restore-mapping', signal => adapters.putMapping(expected.mapping, signal), adapters.readMapping,
    result => assert.deepEqual(result, expected.mapping, 'mapping differs'));
  if(transitionalWeb)await step('unchanged-transitional-web',adapters.readWeb,verifyWeb);
  else await effectThenRead('restore-web', signal => adapters.rollbackWeb(expected.web.deploymentId, signal), adapters.readWeb,verifyWeb);
  await step('closed-runtime', adapters.readRuntime, result => assert.deepEqual(result, expected.runtime));
  await step('closed-reconciliation', adapters.reconcile, result => {
    assert.equal(result.businessEffects, 0); assert.equal(result.safetyClean, true);
    assert.equal(result.exactApprovedV56IssueFingerprint, expected.v56IssueFingerprint);
  });
  try {
    await effectThenRead('guarded-open', adapters.open, adapters.readInterlock, result => assert.equal(result.open, true));
    await step('v56-signed-reads', signal => adapters.signedReads([...V56_SAFE_COMMANDS], signal), result => {
      assert.deepEqual(result.commands, [...V56_SAFE_COMMANDS]); assert.equal(result.ok, true);
      assert.equal(result.businessEffects, 0);
    }, 180000);
    await step('final-reconciliation', adapters.reconcile, result => {
      assert.equal(result.businessEffects, 0); assert.equal(result.safetyClean, true);
      assert.equal(result.exactApprovedV56IssueFingerprint, expected.v56IssueFingerprint);
    });
  } catch (error) {
    // A proven failed post-open check closes again; do not claim restored safety.
    await effectThenRead('reclose-after-failed-smoke', adapters.close, adapters.readInterlock,
      result => assert.equal(result.open, false));
    throw error;
  }
  return {status: 'V56_RESTORED', trace};
}
