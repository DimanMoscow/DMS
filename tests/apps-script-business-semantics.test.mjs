import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';

function fixture() {
  const c = loadBundle('stabilization').context;
  const client = ['CL-A', 'Fixture', 'Активен', 'BL-A'];
  const block = ['BL-A', 'CL-A', 'Блок 5', 'Активен', '', '', '', 5, 0, 5, 16000, 3200];
  const payment = ['OP-A', '', 'CL-A', 'BL-A', 'Оплата', 'Перевод', 16000, 'Подтверждён'];
  const run = (clients=[client],blocks=[block],payments=[payment],journal=[],queue=[]) =>
    Array.from(c.computeDmsBusinessSemanticFindings_(clients,blocks,payments,journal,queue), x=>x.kind);
  return {run,client,block,payment};
}

test('business reconciliation detects missing price and a duplicated block payment independently', () => {
  const f=fixture(); assert.deepEqual(f.run(), []);
  f.block[11]=''; assert.deepEqual(f.run(), ['block_financial_fields']);
  f.block[11]=3200;
  assert.deepEqual(f.run([f.client],[f.block],[f.payment,[...f.payment]]), ['block_overpaid_requires_review']);
});

test('advance assigned to a separate planned block preserves total cash without overpaying the old block', () => {
  const f=fixture(); const next=[...f.block];next[0]='BL-B';next[3]='Запланирован';
  const advance=[...f.payment];advance[0]='OP-B';advance[3]='BL-B';
  assert.deepEqual(f.run([f.client],[f.block,next],[f.payment,advance]), []);
});

test('single payment gaps disappear only with confirmed matching client money; voided payments do not count', () => {
  const f=fixture(); f.client[3]='';
  const training=['TR-A','', 'CL-A','', 'Разовая','Фактически проведена','Проведена',3500];
  const payment=[...f.payment];payment[3]='';payment[6]=3500;
  assert.deepEqual(f.run([f.client],[],[],[training]), ['single_payment_gap']);
  assert.deepEqual(f.run([f.client],[],[payment],[training]), []);
  payment[7]='Отменён';
  assert.deepEqual(f.run([f.client],[],[payment],[training]), ['single_payment_gap']);
});

test('processed queue detects a missing, duplicate or differently owned journal effect', () => {
  const f=fixture(); const q=Array(17).fill('');q[0]='Q-A';q[8]='CL-A';q[10]='BL-A';q[12]='Проведена';q[13]='Обработано';
  const j=Array(19).fill('');j[0]='TR-A';j[2]='CL-A';j[3]='BL-A';j[6]='Проведена';j[18]='Q-A';
  assert.deepEqual(f.run([f.client],[f.block],[f.payment],[],[q]), ['queue_accounting_effect']);
  assert.deepEqual(f.run([f.client],[f.block],[f.payment],[j],[q]), []);
  assert.deepEqual(f.run([f.client],[f.block],[f.payment],[j,[...j]],[q]), ['queue_accounting_effect']);
  j[2]='CL-B';
  assert.deepEqual(f.run([f.client],[f.block],[f.payment],[j],[q]), ['queue_journal_ownership']);
});

test('agreed hybrid or gift unit price is not recomputed by semantic reconciliation', () => {
  const f=fixture();f.block[2]='Гибрид';f.block[11]=3000;
  assert.deepEqual(f.run(), []);
  f.block[2]='Блок 11';f.block[7]=11;f.block[10]=27000;f.block[11]=2700;f.payment[6]=27000;
  assert.deepEqual(f.run(), []);
});
