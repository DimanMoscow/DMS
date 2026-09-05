import assert from "node:assert/strict";
import fs from "node:fs";

const schema = JSON.parse(fs.readFileSync(new URL("./schema.json", import.meta.url), "utf8"));
const inputPath = process.argv[2];
assert.ok(inputPath && process.argv.length === 3,
  "Usage: node preflight.mjs <private-input.json>");
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));

assert.deepEqual(Object.keys(input).sort(), ["existingHeaders", "existingSheets", "pendingOperations"]);
assert.ok(Array.isArray(input.existingSheets));
assert.ok(Array.isArray(input.existingHeaders));
assert.equal(Number(input.pendingOperations), 0, "pending operations require reconciliation");

const exists = input.existingSheets.includes(schema.sheet.name);
if (exists) {
  assert.deepEqual(input.existingHeaders, schema.sheet.columns.map((column) => column.name),
    "existing ledger schema mismatch");
} else {
  assert.deepEqual(input.existingHeaders, [], "headers must be empty when the sheet is absent");
}

console.log(JSON.stringify({
  ok: true,
  sheet: schema.sheet.name,
  columns: schema.sheet.columns.length,
  action: exists ? "verify-existing-empty-ledger" : "create-empty-ledger",
  productionWrites: false
}));
