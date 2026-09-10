import assert from 'node:assert/strict';
import test from 'node:test';
import {undoFixture} from './helpers/undo-fixture.mjs';

test('real Calendar onboarding writes Block 5 total and unit price together', () => {
  const f = undoFixture({candidate:'stabilization',product:{code:'block5',count:5,price:16000,format:'Блок 5',support:0}});
  const block = f.book.sheets.get('Блоки').getRange(4,1,1,17).getValues()[0];
  assert.equal(block[7],5);
  assert.equal(block[10],16000);
  assert.equal(block[11],3200);
});

function singleFixture() {
  const f = undoFixture({candidate:'stabilization',block:false});
  const queue=f.book.sheets.get('Очередь подтверждения');
  queue.getRange(4,13).setValue('Проведена');
  const run=()=>f.context.withTelegramDocumentLock_(()=>f.context.processQueueDate_(
    f.originalQueue[1],'Telegram',false,{lockHeld:true,queueIds:['Q-1']}));
  return {...f,queue,run};
}

test('conducted single creates one transfer payment dated to training and replay adds nothing', () => {
  const f=singleFixture();
  assert.equal(f.run().added,1);
  const payments=f.book.sheets.get('Оплаты').rows.slice(3).filter(r=>r[0]);
  assert.equal(payments.length,1);
  assert.equal(payments[0][6],3500);
  assert.equal(payments[0][5],'Перевод');
  assert.equal(payments[0][1].getTime(),f.originalQueue[5].getTime());
  assert.match(payments[0][9],/\[single:Q-1\]/);
  assert.match(f.book.sheets.get('Журнал тренировок').getRange(4,10).getValue(),/\[single:Q-1\]/);
  f.run();
  assert.equal(f.book.sheets.get('Оплаты').rows.slice(3).filter(r=>r[0]).length,1);
});

test('existing complete single prepayment is not duplicated', () => {
  const f=singleFixture(); const client=f.queue.getRange(4,9).getValue();
  f.book.sheets.get('Оплаты').getRange(4,1,1,10).setValues([
    ['OP-PREPAID',f.originalQueue[1],client,'','Оплата','Перевод',3500,'Подтверждён',new Date(),'Existing prepayment']]);
  assert.equal(f.run().added,1);
  assert.equal(f.book.sheets.get('Оплаты').rows.slice(3).filter(r=>r[0]).length,1);
  assert.match(f.book.sheets.get('Журнал тренировок').getRange(4,10).getValue(),/single-credit/);
});

for(const after of [false,true]) {
  test(`payment write failure ${after?'after':'before'} durability cannot create duplicate on a new confirmation`,()=>{
    const f=singleFixture(); let failed=false;
    f.book.hooks[after?'after':'before']=event=>{
      if(!failed && event.sheet==='Оплаты') {failed=true;throw new Error('network failure');}
    };
    assert.throws(f.run,/network failure/);
    f.book.hooks.before=null; f.book.hooks.after=null;
    if(after) assert.equal(f.run().alreadyLogged,1);
    else assert.throws(f.run,/manual review/);
    assert.equal(f.book.sheets.get('Оплаты').rows.slice(3).filter(r=>r[0]).length,after?1:0);
  });
}

test('ten conducted block rows count once and close the exhausted block',()=>{
  const f=undoFixture({candidate:'stabilization'});const q=f.book.sheets.get('Очередь подтверждения');
  const row=q.getRange(4,1,1,17).getValues()[0];row[12]='Проведена';
  for(let i=0;i<10;i++) {const v=[...row];v[0]='Q-'+(i+1);q.getRange(i+4,1,1,17).setValues([v]);}
  const result=f.context.withTelegramDocumentLock_(()=>f.context.processQueueDate_(
    row[1],'Telegram',false,{lockHeld:true,queueIds:Array.from({length:10},(_,i)=>'Q-'+(i+1))}));
  assert.equal(result.added,10);
  assert.equal(f.book.sheets.get('Журнал тренировок').rows.slice(3).filter(r=>r[0]).length,10);
  assert.equal(f.book.sheets.get('Блоки').getRange(4,4).getValue(),'Закрыт');
  assert.equal(f.book.sheets.get('Клиенты').getRange(5,4).getValue(),'');
});
