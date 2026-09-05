#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  assert.ok(match, `${value}: exact stable semantic version is required`);
  return match.slice(1).map(Number);
}

export function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

export function verifyDependencyPolicy({ manifest, lockfile, policy }) {
  assert.equal(policy.formatVersion, 1);
  assert.equal(manifest.dependencies.next, lockfile.packages["node_modules/next"].version,
    "package.json and lockfile Next.js versions differ");
  assert.equal(manifest.devDependencies["eslint-config-next"], manifest.dependencies.next,
    "Next.js and eslint-config-next must stay on the same exact version");
  assert.equal(
    lockfile.packages["node_modules/eslint-config-next"].version,
    manifest.devDependencies["eslint-config-next"],
    "eslint-config-next lockfile version differs",
  );

  for (const [name, requirement] of Object.entries(policy.minimumVersions)) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const packagePath = new RegExp(`(?:^|/)node_modules/${escapedName}$`);
    const resolved = Object.entries(lockfile.packages)
      .filter(([packageName, metadata]) => packagePath.test(packageName) && metadata?.version)
      .map(([packageName, metadata]) => ({ packageName, version: metadata.version }));
    assert.ok(resolved.length > 0, `${name}: resolved dependency is missing`);
    for (const dependency of resolved) {
      assert.ok(versionAtLeast(dependency.version, requirement.version),
        `${dependency.packageName}@${dependency.version} is below the security floor ${requirement.version}`);
    }
    assert.ok(Array.isArray(requirement.advisories) && requirement.advisories.length > 0,
      `${name}: advisory evidence is required`);
  }
  return true;
}

function runCli() {
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const lockfile = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  const policy = JSON.parse(fs.readFileSync("security/dependency-policy.json", "utf8"));
  verifyDependencyPolicy({ manifest, lockfile, policy });
  console.log("Dependency security floors verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
