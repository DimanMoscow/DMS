#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ledgerPath = "apps-script/migrations/ledger.json";

export function verifyAppendOnlyLedger(base, current) {
  assert.ok(current.catalog.length >= base.catalog.length, "migration catalog entries were removed");
  assert.ok(current.applied.length >= base.applied.length, "applied migration entries were removed");
  assert.deepEqual(current.catalog.slice(0, base.catalog.length), base.catalog,
    "existing migration catalog entries are immutable");
  assert.deepEqual(current.applied.slice(0, base.applied.length), base.applied,
    "existing applied migration entries are immutable");
  return true;
}

function runCli() {
  const baseSha = process.env.DMS_LEDGER_BASE_SHA || process.argv[2];
  assert.match(String(baseSha || ""), /^[0-9a-f]{40}$/i,
    "DMS_LEDGER_BASE_SHA must be a full Git SHA");
  if (/^0+$/.test(baseSha)) {
    process.stdout.write("Migration ledger history check skipped for initial revision.\n");
    return;
  }
  execFileSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const current = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  try {
    execFileSync("git", ["cat-file", "-e", `${baseSha}:${ledgerPath}`], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    process.stdout.write("Migration ledger history begins in this change.\n");
    return;
  }
  const baseText = execFileSync("git", ["show", `${baseSha}:${ledgerPath}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  verifyAppendOnlyLedger(JSON.parse(baseText), current);
  process.stdout.write("Migration ledger append-only history verified.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "ledger history failed"}\n`);
    process.exitCode = 1;
  }
}
