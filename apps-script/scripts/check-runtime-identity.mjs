import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { runtimeSourceHashes } from "./runtime-source-hashes.mjs";
import { verifyRuntimeIdentity } from "./runtime-identity.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const production = JSON.parse(fs.readFileSync(path.resolve(scriptDirectory, '..', 'production.json')));
const candidateDirectory = path.resolve(scriptDirectory, "..", "versions", production.snapshot);
const runtimeUrl = String(process.env.DMS_APPS_SCRIPT_URL || "").trim();

assert.ok(runtimeUrl, "DMS_APPS_SCRIPT_URL is required");

const url = new URL(runtimeUrl);
url.searchParams.set("dms_runtime_identity", "1");
url.searchParams.set("probe", `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`);

const response = await fetch(url, {
  method: "GET",
  redirect: "follow",
  cache: "no-store",
  signal: AbortSignal.timeout(20_000),
});
assert.equal(response.ok, true, `runtime identity returned HTTP ${response.status}`);

const identity = await response.json();
verifyRuntimeIdentity(identity, runtimeSourceHashes(candidateDirectory));

console.log('Apps Script runtime identity verified: ' + production.snapshot);
