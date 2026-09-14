import test from 'node:test';
import assert from 'node:assert/strict';
import {executeRollback, V56_SAFE_COMMANDS} from '../apps-script/scripts/rollback-executor.mjs';

function fixture() {
  let now = 1000000; const state = {open: true, drainStartedAt: null, head: [], mapping: {}, web: {}};
  const trace = []; const calls = [];
  const expected = {head: [{name: 'fixture', source: 'exact56'}], mapping: {versionNumber: 56},
    web: {sha: 'a'.repeat(40), deploymentId: 'dpl_fixture56'}, runtime: {version: 56}, v56IssueFingerprint: 'known'};
  const adapters = {
    close: async () => {calls.push('close'); state.open = false; state.drainStartedAt = now;},
    readInterlock: async () => ({open: state.open, drainStartedAt: state.drainStartedAt}),
    inventory: async () => ({open: false, drainStartedAt: state.drainStartedAt, originalDocumentContext: true,
      mutatingExecutions: 0, pending: 0, stale: 0, manualReview: 0, startedWithoutResult: 0}),
    putHead: async value => {calls.push('putHead'); state.head = value;}, readHead: async () => state.head,
    putMapping: async value => {calls.push('putMapping'); state.mapping = value;}, readMapping: async () => state.mapping,
    rollbackWeb: async id => {calls.push('rollbackWeb'); state.web = {...expected.web, deploymentId: id, state: 'READY'};},
    readWeb: async () => state.web, readRuntime: async () => expected.runtime,
    open: async () => {calls.push('open'); state.open = true;},
    signedReads: async commands => ({commands, ok: true, businessEffects: 0}),
    reconcile: async () => ({businessEffects: 0, safetyClean: true, exactApprovedV56IssueFingerprint: 'known'}),
  };
  return {adapters, state, calls, expected, trace, authorization: 'EXECUTE_EXACT_V56_ROLLBACK',
    advance: ms => {now += ms;},
    clock: {now: () => now, sleep: async ms => {assert.ok(ms <= 30000); now += ms;}},
    record: async x => trace.push(x)};
}
test('executable rollback waits a new full drain and independently checks every switch', async () => {
  const f = fixture(); assert.equal((await executeRollback(f)).status, 'V56_RESTORED');
  assert.equal(f.clock.now() - f.state.drainStartedAt, 420000); assert.equal(f.state.open, true);
  assert.deepEqual(f.calls, ['close', 'putHead', 'putMapping', 'rollbackWeb', 'open']);
  assert.equal(V56_SAFE_COMMANDS.includes('/today'), false); assert.equal(V56_SAFE_COMMANDS.includes('/attention'), false);
});

test('expired transport budget stops closed without advancing to mapping or OPEN', async () => {
  const f = fixture(); const put = f.adapters.putHead;
  f.adapters.putHead = async value => { await put(value); f.advance(30001); };
  await assert.rejects(executeRollback(f), /deadline exceeded/);
  assert.equal(f.state.open, false); assert.equal(f.calls.includes('putMapping'), false);
});
test('missing downstream adapter refuses before closing; failed readback never opens', async () => {
  const f = fixture(); delete f.adapters.rollbackWeb;
  await assert.rejects(executeRollback(f), /missing adapter/); assert.equal(f.state.open, true);
  const g = fixture(); g.adapters.readHead = async () => [];
  await assert.rejects(executeRollback(g), /HEAD source differs/); assert.equal(g.state.open, false);
  assert.equal(g.calls.includes('open'), false); assert.equal(g.calls.includes('putMapping'), false);
});
test('lost successful PUT response uses readback and does not duplicate the effect', async () => {
  const f = fixture(); const put = f.adapters.putHead;
  f.adapters.putHead = async value => {await put(value); throw new Error('response lost');};
  assert.equal((await executeRollback(f)).status, 'V56_RESTORED');
  assert.equal(f.calls.filter(x => x === 'putHead').length, 1);
});

test('verified transitional Web rollback restores HEAD and mapping without any Web switch',async()=>{
  const f=fixture();delete f.adapters.rollbackWeb;
  f.state.web={...f.expected.web,state:'READY'};
  f.transitionalWeb={phase:'v56-v57-transition',webSha:f.expected.web.sha,compatibilityPassed:true,numberedTrees:[
    '873ec728daf92883c31f67eed8857b092360a7fe1fbba3e3d30d316379470a7d',
    '332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c']};
  assert.equal((await executeRollback(f)).status,'V56_RESTORED');
  assert.deepEqual(f.calls,['close','putHead','putMapping','open']);
  assert.equal(f.clock.now()-f.state.drainStartedAt,420000);
  const bad=fixture();bad.transitionalWeb={...f.transitionalWeb,webSha:'b'.repeat(40)};
  await assert.rejects(executeRollback(bad));assert.deepEqual(bad.calls,[]);
});
test('in-flight operations block restore; signed failure closes again', async () => {
  const f = fixture(); const inventory = f.adapters.inventory;
  f.adapters.inventory = async () => ({...await inventory(), pending: 1});
  await assert.rejects(executeRollback(f), /blocks rollback/); assert.deepEqual(f.calls, ['close']);
  const g = fixture(); g.adapters.signedReads = async commands => ({commands, ok: false});
  await assert.rejects(executeRollback(g)); assert.equal(g.state.open, false); assert.equal(g.calls.at(-1), 'close');
});
