import assert from 'node:assert/strict';
import fs from 'node:fs';

export function planFinancialMigration({recoveryVerified, appliedLedgerVerified, formulas}) {
  assert.equal(recoveryVerified, true); assert.equal(appliedLedgerVerified, true);
  const schema = JSON.parse(fs.readFileSync(new URL('./schema.json', import.meta.url)));
  const formatRepairs = [];
  assert.ok(Array.isArray(formulas['Клиенты'])); assert.ok(Array.isArray(formulas['Блоки']));
  formulas['Клиенты'].slice(4).forEach((row, index) => {
    const formula = row[4]; const physicalRow = index + 5;
    if (typeof formula !== 'string' || !formula.startsWith('=')) return;
    const normalize = x => x.replace(/;/g, ',').replace(/\s/g, '');
    const old = `=IFERROR(INDEX('Блоки'!$C$4:$C$203,MATCH(D${physicalRow},'Блоки'!$A$4:$A$203,0)),"")`;
    const next = `=IFERROR(INDEX('Блоки'!$C$4:$C;MATCH(D${physicalRow};'Блоки'!$A$4:$A;0));"")`;
    assert.ok([normalize(old), normalize(next)].includes(normalize(formula)), 'Unknown client format formula requires review');
    if (normalize(formula) !== normalize(next)) formatRepairs.push({row: physicalRow, formula: next});
  });
  return {schemaVersion: 1, remoteStateVerified: false, deployable: false, schema, formatRepairs,
    inputColumnsPreserved: true, formulaAnchors: 9};
}
