import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  verifyDependencyPolicy,
  versionAtLeast,
} from "../scripts/verify-dependency-policy.mjs";

test("dependency policy pins the framework and audited transitive security floors", () => {
  assert.equal(verifyDependencyPolicy({
    manifest: JSON.parse(fs.readFileSync("package.json", "utf8")),
    lockfile: JSON.parse(fs.readFileSync("package-lock.json", "utf8")),
    policy: JSON.parse(fs.readFileSync("security/dependency-policy.json", "utf8")),
  }), true);
});

test("semantic version floor comparison fails closed", () => {
  assert.equal(versionAtLeast("16.3.4", "16.3.3"), true);
  assert.equal(versionAtLeast("16.2.11", "16.3.3"), false);
  assert.throws(() => versionAtLeast("latest", "16.3.3"), /exact stable/);
});

test("dependency policy rejects vulnerable nested copies", () => {
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const lockfile = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  const policy = JSON.parse(fs.readFileSync("security/dependency-policy.json", "utf8"));
  lockfile.packages["node_modules/example/node_modules/postcss"] = { version: "8.4.31" };
  assert.throws(
    () => verifyDependencyPolicy({ manifest, lockfile, policy }),
    /below the security floor/,
  );
});
