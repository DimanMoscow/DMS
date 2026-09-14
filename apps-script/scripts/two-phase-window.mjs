import assert from 'node:assert/strict';

// Admission ceilings, not measurements or promises that Google/browser will
// finish in time. Never report a live worst-case until every transport is proved.
export const TWO_PHASE_BUDGET=Object.freeze({
  closeAndReadback:60,drain:420,inventory:30,headAndReadback:30,
  mappingAndReadback:30,runtime:30,openAndReadback:60,signedSmoke:180,reconciliation:30,
});
export function assessTwoPhaseWindow({receipts,startAt,nextNaturalAt}) {
  const activation=Object.values(TWO_PHASE_BUDGET).reduce((a,b)=>a+b,0);
  const rollback=activation+30; // unchanged Web READY/SHA read, no switch/build
  const missing=Object.keys(TWO_PHASE_BUDGET).filter(key=>key!=='drain'&&
    !(receipts[key]?.live===true&&receipts[key]?.passed===true&&
      Number.isFinite(receipts[key]?.maximumSeconds)&&receipts[key].maximumSeconds<=TWO_PHASE_BUDGET[key]));
  assert.ok(Date.parse(nextNaturalAt)>Date.parse(startAt));
  return {activationSeconds:activation,rollbackSeconds:rollback,totalSeconds:activation+rollback,
    maximumSeconds:1800,missing,admitted:missing.length===0&&activation+rollback<=1800&&
      Date.parse(nextNaturalAt)-Date.parse(startAt)>=(activation+rollback)*1000};
}
