import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const directories = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(directories.length > 0, "at least one migration package is required");

for (const directory of directories) {
  const packageRoot = path.join(root, directory);
  const manifestPath = path.join(packageRoot, "migration.json");
  assert.ok(fs.existsSync(manifestPath), `${directory}: migration.json is required`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), [
    "appliesTo",
    "destructive",
    "id",
    "postCheck",
    "preflight",
    "productionWritesRequireApproval",
    "rollback",
    "schemaVersion",
  ]);
  assert.equal(manifest.id, directory, `${directory}: id must match the directory`);
  assert.ok(Number.isInteger(manifest.schemaVersion) && manifest.schemaVersion > 0,
    `${directory}: schemaVersion must be a positive integer`);
  assert.equal(manifest.destructive, false, `${directory}: destructive migrations are forbidden`);
  assert.equal(manifest.productionWritesRequireApproval, true,
    `${directory}: production writes must require approval`);
  assert.ok(Array.isArray(manifest.appliesTo) && manifest.appliesTo.length > 0,
    `${directory}: appliesTo is required`);
  for (const key of ["preflight", "postCheck", "rollback"]) {
    assert.ok(Array.isArray(manifest[key]) && manifest[key].length > 0,
      `${directory}: ${key} steps are required`);
  }
  assert.ok(fs.existsSync(path.join(packageRoot, "schema.json")),
    `${directory}: schema.json is required`);
  assert.ok(fs.existsSync(path.join(packageRoot, "preflight.mjs")),
    `${directory}: preflight.mjs is required`);
}

console.log(`Migration packages verified: ${directories.join(", ")}`);
