import test from 'node:test';import assert from 'node:assert/strict';
import {TWO_PHASE_BUDGET,assessTwoPhaseWindow} from '../apps-script/scripts/two-phase-window.mjs';
const input={startAt:'2026-09-14T16:25:00Z',nextNaturalAt:'2026-09-14T17:21:00Z'};
test('two-phase budget is 1770s but unknown native transports cannot gain admission',()=>{
  const result=assessTwoPhaseWindow({...input,receipts:{}});
  assert.equal(result.totalSeconds,1770);assert.equal(result.admitted,false);assert.ok(result.missing.includes('closeAndReadback'));
});
test('full bounded proof must also fit natural schedule window',()=>{
  const receipts=Object.fromEntries(Object.entries(TWO_PHASE_BUDGET).map(([key,s])=>[key,{live:true,passed:true,maximumSeconds:s}]));
  assert.equal(assessTwoPhaseWindow({...input,receipts}).admitted,true);
  assert.equal(assessTwoPhaseWindow({...input,receipts,nextNaturalAt:'2026-09-14T16:50:00Z'}).admitted,false);
  receipts.signedSmoke.maximumSeconds=181;
  assert.equal(assessTwoPhaseWindow({...input,receipts}).admitted,false);
});
