import assert from 'node:assert/strict';
import {fingerprint} from './release-reconciliation.mjs';

// Legacy volatile audit timestamps are not business revisions. Only these exact
// columns and literal formulas qualify; preserve every formula plus every other
// evaluated value so payment, linkage, attendance and formula edits still fail.
const timestampColumns = {'Оплаты': 8, 'Журнал тренировок': 16, 'Очередь подтверждения': 14};
const arrayColumns = {'Клиенты': {anchor: 4, columns: [5, 6, 7, 8, 9]},
  'Блоки': {anchor: 3, columns: [8, 9, 13, 14]}};
export function sheetBusinessRevision(valueRanges, formulaRanges) {
  assert.equal(valueRanges.length, formulaRanges.length, 'incomplete formula evidence');
  const seen = new Set();
  const rows = valueRanges.map((range, s) => {
    const formula = formulaRanges[s];
    assert.equal(range.range, formula.range, 'formula range mismatch');
    assert.ok(!seen.has(range.range), 'duplicate range'); seen.add(range.range);
    assert.equal(range.values.length, formula.values.length, 'formula row count mismatch');
    const name = range.range.split('!')[0].replaceAll("'", '');
    return {range: range.range, values: range.values.map((row, r) => {
      const expressions = formula.values[r];
      assert.equal(row.length, expressions.length, 'formula column count mismatch');
      return row.map((value, c) => {
        const expression = expressions[c];
        const isFormula = typeof expression === 'string' && expression.startsWith('=');
        const array = arrayColumns[name];
        const spill = expression === '' && array && r > array.anchor && array.columns.includes(c) &&
          String(formula.values[array.anchor]?.[c]).startsWith('=ARRAYFORMULA(');
        // Sheets FORMULA renders these known spill cells empty. Their evaluated
        // values are still included below, so changes in money/counts are detected.
        if (!isFormula && !spill) assert.deepEqual(value, expression, 'values changed between reads');
        if (r >= 3 && c === timestampColumns[name] && expression === '=NOW()') {
          assert.ok(typeof value === 'number' && Number.isFinite(value), 'invalid volatile timestamp');
          return {volatileAuditTimestamp: '=NOW()'};
        }
        return value;
      });
    })};
  });
  return fingerprint({rows, formulas: formulaRanges});
}
