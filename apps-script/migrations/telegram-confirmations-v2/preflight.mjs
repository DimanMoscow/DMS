import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export function planConfirmationMigration(input) {
  const schema = JSON.parse(fs.readFileSync(new URL('./schema.json', import.meta.url)));
  const headers = schema.sheet.columns.map(c => c.name);
  assert.equal(input.appliedV1, true, 'applied migration ledger required');
  assert.equal(input.recoveryVerified, true, 'fresh private recovery evidence required');
  assert.ok(Array.isArray(input.headers));
  const alreadyApplied = JSON.stringify(input.headers) === JSON.stringify(headers);
  if (!alreadyApplied) {
    assert.deepEqual(input.headers, headers.slice(0, 13), 'unknown schema');
    assert.equal(input.extensionHasData, false, 'extension columns contain data');
  }
  assert.ok(Array.isArray(input.legacyStates));
  const known = ['pending', 'consumed', 'expired', 'revoked'];
  const unknown = input.legacyStates.filter(s => !known.includes(s.status));
  return {schemaVersion: 2, alreadyApplied, addHeaders: alreadyApplied ? [] : headers.slice(13),
    preserveLegacyTickets: input.legacyStates.length, manualReview: unknown.length +
      input.legacyStates.filter(s => s.hasPendingOperation).length,
    deleteHistory: false, remoteStateVerified: false, deployable: false};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(planConfirmationMigration(input)));
}
