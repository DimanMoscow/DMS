import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { readCanonicalSource, sha256 } from "./source-integrity.mjs";

const manifestKeys = [
  "appliesTo", "destructive", "id", "postCheck", "preflight",
  "productionWritesRequireApproval", "rollback", "schemaVersion",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function artifactSha256(packageRoot) {
  let material = "";
  const fileNames = [];
  function collect(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert.equal(entry.isSymbolicLink(), false,
        `${relativeName}: migration symlinks are forbidden`);
      if (entry.isDirectory()) {
        assert.equal(relativeName, "fixtures", `${relativeName}: unsupported migration directory`);
        collect(path.join(directory, entry.name), relativeName);
        continue;
      }
      assert.equal(entry.isFile(), true,
        `${relativeName}: migration package entries must be regular files`);
      assert.ok(
        ["migration.json", "schema.json", "README.md"].includes(relativeName) ||
          relativeName.endsWith(".mjs") || /^fixtures\/[^/]+\.json$/.test(relativeName),
        `${relativeName}: unsupported migration artifact`,
      );
      fileNames.push(relativeName);
    }
  }
  collect(packageRoot);
  fileNames.sort();
  for (const required of ["migration.json", "schema.json", "preflight.mjs", "README.md"]) {
    assert.ok(fileNames.includes(required), `${required} is required`);
  }
  for (const fileName of fileNames) {
    material += `${fileName}\0${sha256(readCanonicalSource(path.join(packageRoot, ...fileName.split("/"))))}\0`;
  }
  return sha256(material);
}

function schemaSheetNames(schema) {
  if (schema.sheet) return [schema.sheet.name];
  return Object.values(schema.sheets || {}).map((sheet) => sheet.name).sort();
}

export function verifyMigrationRepository({ migrationsRoot, repositoryRoot }) {
  const verification = readJson(path.join(repositoryRoot, "apps-script", "verification.json"));
  const directories = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(directories.length > 0, "at least one migration package is required");

  const packages = new Map();
  for (const directory of directories) {
    const packageRoot = path.join(migrationsRoot, directory);
    const manifest = readJson(path.join(packageRoot, "migration.json"));
    const schema = readJson(path.join(packageRoot, "schema.json"));
    assert.deepEqual(Object.keys(manifest).sort(), manifestKeys);
    assert.equal(manifest.id, directory, `${directory}: id must match the directory`);
    assert.ok(Number.isInteger(manifest.schemaVersion) && manifest.schemaVersion > 0,
      `${directory}: schemaVersion must be a positive integer`);
    assert.equal(schema.schemaVersion ?? schema.version, manifest.schemaVersion,
      `${directory}: schema and migration versions differ`);
    assert.deepEqual(schemaSheetNames(schema), [...manifest.appliesTo].sort(),
      `${directory}: schema and migration sheet names differ`);
    assert.equal(manifest.destructive, false, `${directory}: destructive migrations are forbidden`);
    assert.equal(manifest.productionWritesRequireApproval, true,
      `${directory}: production writes must require approval`);
    for (const key of ["preflight", "postCheck", "rollback"]) {
      assert.ok(Array.isArray(manifest[key]) && manifest[key].length > 0,
        `${directory}: ${key} steps are required`);
    }
    packages.set(directory, { manifest, artifactSha256: artifactSha256(packageRoot) });
  }

  const ledger = readJson(path.join(migrationsRoot, "ledger.json"));
  assert.deepEqual(Object.keys(ledger).sort(), [
    "applied", "catalog", "currentSchemaVersions", "environment", "formatVersion",
  ]);
  assert.equal(ledger.formatVersion, 1);
  assert.equal(ledger.environment, "production");
  assert.equal(ledger.catalog.length, packages.size, "migration catalog must cover every package");

  const catalog = new Map();
  for (const item of ledger.catalog) {
    assert.deepEqual(Object.keys(item).sort(), [
      "artifactSha256", "dependsOn", "id", "schemaVersion",
    ]);
    assert.equal(catalog.has(item.id), false, `${item.id}: duplicate catalog entry`);
    const migrationPackage = packages.get(item.id);
    assert.ok(migrationPackage, `${item.id}: catalog references an unknown migration`);
    assert.equal(item.schemaVersion, migrationPackage.manifest.schemaVersion);
    assert.equal(item.artifactSha256, migrationPackage.artifactSha256,
      `${item.id}: migration artifact digest differs`);
    assert.ok(Array.isArray(item.dependsOn));
    catalog.set(item.id, item);
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    assert.equal(visiting.has(id), false, `${id}: migration dependency cycle`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of catalog.get(id).dependsOn) {
      assert.ok(catalog.has(dependency), `${id}: unknown dependency ${dependency}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of catalog.keys()) visit(id);

  const appliedIds = new Set();
  for (const entry of ledger.applied) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "artifactSha256", "evidence", "id", "sourceSnapshot", "verifiedOn",
    ]);
    assert.equal(appliedIds.has(entry.id), false, `${entry.id}: duplicate applied entry`);
    const item = catalog.get(entry.id);
    assert.ok(item, `${entry.id}: applied entry is missing from catalog`);
    for (const dependency of item.dependsOn) {
      assert.ok(appliedIds.has(dependency), `${entry.id}: dependency ${dependency} was not applied first`);
    }
    assert.equal(entry.artifactSha256, item.artifactSha256,
      `${entry.id}: applied artifact digest differs`);
    assert.match(entry.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.sourceSnapshot, /^v\d+$/);
    assert.ok(verification.versions[entry.sourceSnapshot],
      `${entry.id}: source snapshot is not verified`);
    const evidencePath = path.resolve(repositoryRoot, entry.evidence);
    const relativeEvidence = path.relative(repositoryRoot, evidencePath);
    assert.ok(relativeEvidence && !relativeEvidence.startsWith(`..${path.sep}`) &&
      relativeEvidence !== ".." && !path.isAbsolute(relativeEvidence),
    `${entry.id}: evidence must stay inside the repository`);
    assert.ok(relativeEvidence.startsWith(`docs${path.sep}`) && evidencePath.endsWith(".md"),
      `${entry.id}: evidence must be a Markdown file under docs`);
    assert.ok(fs.existsSync(evidencePath) && fs.lstatSync(evidencePath).isFile() &&
      !fs.lstatSync(evidencePath).isSymbolicLink(),
      `${entry.id}: evidence file is missing`);
    appliedIds.add(entry.id);
  }

  const expectedSchemaVersions = {};
  for (const entry of ledger.applied) {
    const migrationPackage = packages.get(entry.id);
    for (const sheet of migrationPackage.manifest.appliesTo) {
      expectedSchemaVersions[sheet] = migrationPackage.manifest.schemaVersion;
    }
  }
  assert.deepEqual(ledger.currentSchemaVersions, expectedSchemaVersions,
    "current schema versions do not match the applied ledger");

  return {
    directories,
    applied: ledger.applied.map((entry) => entry.id),
    dependencies: Object.fromEntries([...catalog].map(([id, item]) => [id, item.dependsOn])),
    ledgerSha256: sha256(`${JSON.stringify(ledger)}\n`),
  };
}
