import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from './helpers/memory-workbook.mjs';

function fixture() {
  const book=memoryWorkbook({'Блоки':[[],[],[],['BL-001','CL-001']],
    'Оплаты':[[],[],[]], 'Журнал действий бота':[['ID']]});
  const f=loadBundle('stabilization',{SpreadsheetApp:book.service},{releaseReady:false});
  const date={date:'2026-09-01T09:00:00.000Z'};
  const patches=[{kind:'single_payment',sheet:'Оплаты',row:4,col:1,before:Array(10).fill(''),
    after:['OP-001',date,'CL-001','','Оплата','Перевод',3500,'Подтверждён',date,'Approved recovery']},
    {kind:'unit_price',sheet:'Блоки',row:4,col:12,before:[''],after:[3200]}];
  const hash='a'.repeat(64);
  f.context.loadDmsEmergencyRecoveryPlan_=()=>({hash,plan:{patches}});
  f.context.getDmsFinancialHealth_=()=>({ok:true,businessFindings:[]});
  f.properties.set('DMS_P1_DRAIN_STARTED_AT',new Date(Date.now()-421000).toISOString());
  f.context.previewDmsEmergencyRecovery();
  return {...f,book,patches,hash};
}

test('recovery requires exact acceptance, closed writers and completed drain before any business write',()=>{
  const f=fixture();const before=f.book.writes.length;
  f.properties.set('DMS_P1_RELEASE_READY','system-stabilization-2026-09');
  assert.throws(()=>f.context.applyDmsEmergencyRecovery(),/paused/);
  f.properties.delete('DMS_P1_RELEASE_READY');f.properties.delete('DMS_EMERGENCY_RECOVERY_ACCEPTED_V1');
  assert.throws(()=>f.context.applyDmsEmergencyRecovery(),/preview/);
  assert.equal(f.book.writes.length,before);
});

test('approved correction and replay preserve payment amount, one audit and one effect',()=>{
  const f=fixture();assert.equal(f.context.applyDmsEmergencyRecovery().status,'committed');
  const writes=f.book.writes.length;
  assert.equal(f.context.applyDmsEmergencyRecovery().status,'committed');
  assert.equal(f.book.writes.length,writes);
  assert.equal(f.book.sheets.get('Оплаты').getRange(4,7).getValue(),3500);
  assert.equal(f.book.sheets.get('Журнал действий бота').getLastRow(),2);
});

for (const boundary of ['before','after']) test(`recovery interruption ${boundary} durable payment write resumes only proved ranges`,()=>{
  const f=fixture();let failed=false;
  f.book.hooks[boundary]=e=>{if(!failed&&e.sheet==='Оплаты'){failed=true;throw new Error('process death');}};
  assert.throws(()=>f.context.applyDmsEmergencyRecovery(),/process death/);
  f.book.hooks[boundary]=null;
  assert.equal(f.context.applyDmsEmergencyRecovery().status,'committed');
  assert.equal(f.book.writes.filter(e=>e.sheet==='Оплаты').length,1);
});

test('an unexpected partial result is retained for manual review without overwrite',()=>{
  const f=fixture();f.book.sheets.get('Оплаты').getRange(4,1).setValue('OP-999');
  const writes=f.book.writes.length;
  assert.throws(()=>f.context.applyDmsEmergencyRecovery(),/manual review/);
  assert.equal(f.book.writes.length,writes);
});

test('advance correction cannot edit amount, date, client, status or overwrite formulas',()=>{
  const f=fixture();const before=f.patches[0].after;before[3]='BL-001';
  const patch={kind:'advance',sheet:'Оплаты',row:4,col:1,before:[...before],after:[...before]};
  patch.after[3]='BL-002';patch.after[9]='Advance for next planned block';
  f.context.validateDmsRecoveryPatch_(patch);
  for(const i of [0,1,2,4,5,6,7,8]) {
    const changed={...patch,after:[...patch.after]};changed.after[i]='changed';
    assert.throws(()=>f.context.validateDmsRecoveryPatch_(changed),/only/);
  }
  f.book.sheets.get('Блоки').getRange(4,12).setFormula('=1');
  assert.throws(()=>f.context.inspectDmsRecoveryPatch_(f.patches[1]),/formula/);
});
