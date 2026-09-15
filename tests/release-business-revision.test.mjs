import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetBusinessRevision} from '../apps-script/scripts/business-revision.mjs';
function fixture(){
  const values=[{range:"'Оплаты'!A1:K1000",values:[[],[],[],['fixture-payment',1,'fixture-client',10,'fixture-block','','','',46000]]}];
  const formulas=structuredClone(values);formulas[0].values[3][8]='=NOW()';
  return {values,formulas};
}
test('exact legacy NOW timestamp recalculation preserves revision, with formula evidence retained',()=>{
  const f=fixture(),before=sheetBusinessRevision(f.values,f.formulas);f.values[0].values[3][8]+=1;
  assert.equal(sheetBusinessRevision(f.values,f.formulas),before);
});
test('business, binding, formula and row identity changes cannot hide behind a volatile timestamp',()=>{
  const f=fixture(),before=sheetBusinessRevision(f.values,f.formulas);
  for(const column of [0,2,3,4]){const g=fixture();g.values[0].values[3][column]='changed';g.formulas[0].values[3][column]='changed';assert.notEqual(sheetBusinessRevision(g.values,g.formulas),before);}
  for(const expression of ['=NOW()+1','=IF(TRUE,NOW(),0)',46000]){const g=fixture();g.formulas[0].values[3][8]=expression;assert.notEqual(sheetBusinessRevision(g.values,g.formulas),before);}
  const g=fixture();g.formulas[0].values[3][3]='=5+5';assert.notEqual(sheetBusinessRevision(g.values,g.formulas),before);
});
test('missing, partial, inconsistent or invalid formula receipts fail closed',()=>{
  const f=fixture();for(const mutate of [g=>{g.formulas=[];},g=>{g.formulas[0].values.pop();},g=>{g.formulas[0].values[3].pop();},g=>{g.formulas[0].values[3][3]=99;},g=>{g.values[0].values[3][8]='invalid';}]){const g=structuredClone(f);mutate(g);assert.throws(()=>sheetBusinessRevision(g.values,g.formulas));}
});
test('NOW outside the exact technical timestamp columns remains part of the business revision',()=>{
  const f=fixture();f.values[0].values[3][3]=46000;f.formulas[0].values[3][3]='=NOW()';const before=sheetBusinessRevision(f.values,f.formulas);f.values[0].values[3][3]+=1;assert.notEqual(sheetBusinessRevision(f.values,f.formulas),before);
});
test('known ARRAYFORMULA spill cells preserve evaluated financial values in the revision',()=>{
  const values=[{range:"'Клиенты'!A1:N1000",values:[[],[],[],[],['','','','','',1],['fixture','','','','',2]]}];
  const formulas=structuredClone(values);formulas[0].values[4][5]='=ARRAYFORMULA(fixture)';formulas[0].values[5][5]='';
  const before=sheetBusinessRevision(values,formulas);values[0].values[5][5]=3;
  assert.notEqual(sheetBusinessRevision(values,formulas),before);
  formulas[0].values[4][5]='';assert.throws(()=>sheetBusinessRevision(values,formulas));
});
