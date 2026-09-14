import test from 'node:test';import assert from 'node:assert/strict';
import {collectorSafety} from '../apps-script/scripts/collector-safety.mjs';
import {isolatedCandidateBackend} from './helpers/isolated-candidate-backend.mjs';
function fixture(){const f=isolatedCandidateBackend('v56');return {f,
  rows:Object.fromEntries(f.book.workbook.getSheets().map(s=>[s.getName(),s.getDataRange().getValues()])),
  capture:{financial:{issues:[],numeric:[],businessFindings:[]}},
  native:{adapter:'native-ui-challenge-v1',inspector:{durableOperations:{pending:0,stale:0,manualReview:0}}}};}
test('collector safety includes duplicate IDs and every financial issue without a drift exception',()=>{
  const {f,rows,capture,native}=fixture();rows.Клиенты.push([...rows.Клиенты[4]]);
  capture.financial.businessFindings.push({kind:'queue_journal_ownership',ref:'fixture'});
  const result=collectorSafety(rows,capture,native,f.context);
  assert.equal(result.duplicateClientIds.length,1);assert.equal(result.finance.length,1);assert.equal(result.clientBlockLink.length,1);
  assert.equal(f.book.writes.length,0);
});
test('collector safety refuses missing native input or financial calculation',()=>{
  const {f,rows,capture,native}=fixture();delete native.inspector.durableOperations.pending;
  assert.throws(()=>collectorSafety(rows,capture,native,f.context));
  assert.throws(()=>collectorSafety(rows,{},native,f.context));
});
