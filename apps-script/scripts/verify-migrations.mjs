#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyMigrationRepository } from "./migration-integrity.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const result = verifyMigrationRepository({
  repositoryRoot,
  migrationsRoot: path.join(repositoryRoot, "apps-script", "migrations"),
});

console.log(`Migration packages verified: ${result.directories.join(", ")}`);
console.log(`Applied migrations verified: ${result.applied.join(", ")}`);
console.log(`Migration ledger SHA-256: ${result.ledgerSha256}`);
