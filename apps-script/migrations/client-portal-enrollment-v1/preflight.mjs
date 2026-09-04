import assert from "node:assert/strict";
import fs from "node:fs";

const schema = JSON.parse(fs.readFileSync(new URL("./schema.json", import.meta.url), "utf8"));
const inputPath = process.argv[2];
assert.ok(inputPath && process.argv.length === 3,
  "Usage: node preflight.mjs <private-input.json>");
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));

assert.deepEqual(Object.keys(input).sort(), ["existingSheets", "rows"]);
assert.ok(Array.isArray(input.existingSheets));
assert.ok(Array.isArray(input.rows));
assert.equal(input.existingSheets.includes(schema.sheet.name), false,
  "target sheet already exists; stop and inspect its schema");
assert.equal(input.rows.length, 0, "rollout schema must be created empty");
assert.equal(schema.sheet.columns.length, 10);
assert.deepEqual(schema.sheet.columns.map((column) => column.name), [
  "Invite ID", "Token SHA-256", "Client ID", "Status", "Expires At",
  "Created At", "Used At", "Revoked At", "Updated At", "Used Binding ID",
]);

console.log(JSON.stringify({
  ok: true,
  sheet: schema.sheet.name,
  columns: schema.sheet.columns.length,
  rowsToWrite: 0,
  rollback: "delete only the newly-created empty target sheet before any invites exist",
}));
