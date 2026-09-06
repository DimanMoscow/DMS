import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {financialFixture} from './helpers/financial-fixture.mjs';
import {undoFixture} from './helpers/undo-fixture.mjs';
import {planFinancialMigration} from '../apps-script/migrations/financial-formulas-v1/preflight.mjs';

for (const [scale, boundary] of [[1, true], [1, false], [10, false]]) {
  test('P1.6 full bundle numeric guard matches independent fixture totals: ' + scale + '/' + boundary, () => {
    const {data, expected} = financialFixture(scale, boundary); const c = loadBundle('v51').context;
    const result = c.computeDmsFinancialExpected_(data['Клиенты'].slice(4), data['Блоки'].slice(3),
      data['Оплаты'].slice(3), data['Журнал тренировок'].slice(3));
    assert.equal(result.issues.length, 0);
    for (const [id, value] of Object.entries(expected.clients)) assert.deepEqual(JSON.parse(JSON.stringify(result.clients[id])), value.columns);
    for (const [id, value] of Object.entries(expected.blocks)) assert.deepEqual(JSON.parse(JSON.stringify(result.blocks[id])), value.columns);
  });
}

test('P1.6 new entity creation preserves all shared financial anchors', () => {
  const f = undoFixture(); const c = f.context; const clients = f.book.sheets.get('Клиенты'); const blocks = f.book.sheets.get('Блоки');
  c.repairBlockFormulas_(blocks); c.repairClientDebtFormulas_(clients);
  const plan = c.getDmsFinancialFormulaPlan_();
  c.withTelegramDocumentLock_(() => c.createTelegramClient_({clientName: 'Second fixture', clientType: 'block',
    blockCount: 10, blockPrice: 30000, blockDateKey: '2026-09-05'}));
  for (const [name, anchors] of Object.entries(plan)) for (const [cell, formula] of Object.entries(anchors)) {
    assert.equal(f.book.sheets.get(name).getRange(cell).getFormula(), formula);
  }
  assert.equal(clients.getRange(6, 10).getFormula(), ''); assert.equal(blocks.getRange(5, 9).getFormula(), '');
});

test('P1.6 migration artifact matches the active full-bundle formula generator', () => {
  const schema = JSON.parse(fs.readFileSync('apps-script/migrations/financial-formulas-v1/schema.json'));
  const plan = loadBundle('v51').context.getDmsFinancialFormulaPlan_();
  for (const sheet of Object.values(schema.sheets)) assert.deepEqual(JSON.parse(JSON.stringify(plan[sheet.name])), sheet.anchors);
});

test('P1.6 actual payment writer expands a full grid and keeps all prior rows', () => {
  const f = undoFixture(); const sheet = f.book.sheets.get('Оплаты');
  for (let row = 4; row <= 1000; row++) sheet.getRange(row, 1).setValue('OP-' + row);
  assert.equal(sheet.getMaxRows(), 1000);
  f.context.withTelegramDocumentLock_(() => f.context.appendTelegramPayment_({clientId: f.result.clientId,
    blockId: 'BL-001', amount: 100, method: 'Перевод'}));
  assert.ok(sheet.getMaxRows() > 1000);
  assert.equal(sheet.getRange(1000, 1).getValue(), 'OP-1000');
  assert.equal(sheet.getRange(1001, 7).getValue(), 100);
});

test('P1.6 migration refuses unknown format formula or missing recovery evidence', () => {
  const input = {recoveryVerified: true, appliedLedgerVerified: true, formulas: {'Клиенты': [[], [], [], [], ['', '', '', '', '=SUM(1;2)']], 'Блоки': []}};
  assert.throws(() => planFinancialMigration(input), /Unknown client format/);
  input.formulas['Клиенты'] = [];
  assert.equal(planFinancialMigration(input).inputColumnsPreserved, true);
  assert.throws(() => planFinancialMigration({...input, recoveryVerified: false}));
});
