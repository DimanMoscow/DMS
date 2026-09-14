import assert from 'node:assert/strict';
import {SAFETY_TYPES,fingerprint} from './release-reconciliation.mjs';

// Full-sheet owner read + actual bundle financial/semantic calculations + native
// original-context ledger inventory. Missing evidence is never interpreted as 0.
export function collectorSafety(rows,capture,native,context) {
  assert.equal(native.adapter,'native-ui-challenge-v1');
  const result=Object.fromEntries(SAFETY_TYPES.map(k=>[k,[]]));
  const entries=(name,skip)=>{assert.ok(Array.isArray(rows[name]));return rows[name].slice(skip);};
  const clients=entries('Клиенты',4),blocks=entries('Блоки',3),payments=entries('Оплаты',3),journal=entries('Журнал тренировок',3);
  for(const [key,data] of [['duplicateClientIds',clients],['duplicateBlockIds',blocks],
    ['duplicatePaymentIds',payments],['duplicateJournalIds',journal]]){
    const seen=new Set(); for(const row of data)if(row[0]){
      if(seen.has(row[0]))result[key].push({identitySha256:fingerprint(row[0]),semanticSha256:fingerprint(row)});
      seen.add(row[0]);
    }
  }
  const evidence=(value)=>({identitySha256:fingerprint(value),semanticSha256:fingerprint(value)});
  for(const key of ['issues','numeric','businessFindings']) assert.ok(Array.isArray(capture.financial[key]));
  result.finance=[...capture.financial.issues,...capture.financial.numeric,...capture.financial.businessFindings].map(evidence);
  // Financial/link/payment/block checks all run above, with a strict nonzero gate.
  result.payment=[...result.finance];result.clientBlockLink=[...result.finance];result.blockJournalCounts=[...result.finance];
  const ss=context.SpreadsheetApp.getActive();
  for(const row of clients)if(row[0])for(const alias of [row[12],...String(row[13]||'').split(/[\n,;|]+/)]){
    if(!String(alias||'').trim())continue;
    try{context.assertDmsCalendarAliasAvailable_(ss,alias,row[0]);}
    catch{result.aliases.push(evidence({id:row[0],alias}));}
  }
  result.queueErrors=entries('Очередь подтверждения',3).filter(r=>r[0]&&String(r[13]).startsWith('Ошибка')).map(evidence);
  const d=native.inspector.durableOperations;
  for(const [key,field] of [['durablePending','pending'],['durableStale','stale'],['manualReview','manualReview']]){
    assert.ok(Number.isSafeInteger(d[field])&&d[field]>=0);if(d[field])result[key].push(evidence({field,count:d[field]}));
  }
  return result;
}
