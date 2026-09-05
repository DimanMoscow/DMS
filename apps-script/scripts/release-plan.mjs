#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readCanonicalSource, sha256, sourceTreeSha256 } from "./source-integrity.mjs";
import { verifySourceState } from "../../scripts/verify-source-state.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appsScriptRoot = path.resolve(scriptDirectory, "..");
const versionPattern = /^v\d+$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function candidateFiles(candidateRoot) {
  const entries = fs.readdirSync(candidateRoot, { withFileTypes: true });
  const names = entries.map((entry) => {
    assert.equal(entry.isSymbolicLink(), false, `${entry.name}: symlinks are forbidden`);
    assert.equal(entry.isFile(), true, `${entry.name}: only files are allowed`);
    assert.ok(
      entry.name === "appsscript.json" || entry.name.endsWith(".gs"),
      `${entry.name}: unsupported Apps Script file type`,
    );
    return entry.name;
  }).sort();
  assert.equal(new Set(names).size, names.length, "duplicate Apps Script file names");
  return names;
}

export function buildOfflineReleasePlan({
  candidate,
  baseline,
  createdAt = new Date().toISOString(),
  sourceRevision,
  root = appsScriptRoot,
}) {
  assert.match(candidate, versionPattern, "candidate must look like v49");
  assert.match(baseline, versionPattern, "baseline must look like v49");
  assert.match(String(sourceRevision || ""), /^[0-9a-f]{40}$/,
    "a verified Git source revision is required");

  const verification = readJson(path.join(root, "verification.json"));
  const production = readJson(path.join(root, "production.json"));
  const candidateMetadata = verification.candidates?.[candidate];
  assert.ok(candidateMetadata, `${candidate}: candidate verification metadata is missing`);
  assert.equal(production.candidate, baseline, "baseline is not the recorded production candidate");
  assert.equal(production.snapshot, baseline, "production snapshot/candidate mismatch");

  const candidateRoot = path.join(root, "candidates", candidate);
  const candidateStat = fs.lstatSync(candidateRoot);
  assert.equal(candidateStat.isSymbolicLink(), false, `${candidate}: candidate root cannot be a symlink`);
  assert.equal(candidateStat.isDirectory(), true, `${candidate}: candidate root must be a directory`);
  const files = candidateFiles(candidateRoot);
  assert.equal(files.filter((file) => file === "appsscript.json").length, 1,
    `${candidate}: exactly one appsscript.json is required`);
  assert.equal(files.length, candidateMetadata.fileCount, `${candidate}: file count differs`);
  assert.equal(
    sourceTreeSha256(candidateRoot, files),
    candidateMetadata.sourceTreeSha256,
    `${candidate}: source tree differs from verification metadata`,
  );

  const placeholderCounts = Object.fromEntries(
    verification.repositorySanitizations.map((rule) => [rule.label, 0]),
  );
  const fileDigests = {};
  for (const fileName of files) {
    const source = readCanonicalSource(path.join(candidateRoot, fileName));
    fileDigests[fileName] = sha256(source);
    for (const rule of verification.repositorySanitizations) {
      const count = source.split(rule.placeholder).length - 1;
      const expected = fileName === rule.file ? rule.allowedReplacementsPerVersion : 0;
      assert.equal(count, expected, `${candidate}/${fileName}: placeholder count differs`);
      placeholderCounts[rule.label] += count;
    }
  }
  for (const rule of verification.repositorySanitizations) {
    assert.equal(
      placeholderCounts[rule.label],
      rule.allowedReplacementsPerVersion,
      `${candidate}: placeholder total differs for ${rule.label}`,
    );
  }

  return {
    formatVersion: 1,
    status: "OFFLINE_READY",
    createdAt,
    candidate,
    baseline,
    sourceRevision,
    sourceStateVerified: true,
    productionNumberedVersion: production.numberedVersion,
    candidateTreeSha256: candidateMetadata.sourceTreeSha256,
    files: fileDigests,
    baselineRuntimeIdentity: production.runtimeIdentity,
    substitutionsRequired: verification.repositorySanitizations.map((rule) => ({
      label: rule.label,
      file: rule.file,
      count: rule.allowedReplacementsPerVersion,
    })),
    authenticated: false,
    remoteStateVerified: false,
    releaseReady: false,
    deployable: false,
  };
}

export function verifyOfflineReleasePlan(plan, options = {}) {
  assert.deepEqual(
    {
      status: plan.status,
      authenticated: plan.authenticated,
      remoteStateVerified: plan.remoteStateVerified,
      releaseReady: plan.releaseReady,
      deployable: plan.deployable,
      sourceStateVerified: plan.sourceStateVerified,
    },
    {
      status: "OFFLINE_READY",
      authenticated: false,
      remoteStateVerified: false,
      releaseReady: false,
      deployable: false,
      sourceStateVerified: true,
    },
    "offline plan cannot claim authenticated or deployable state",
  );
  const rebuilt = buildOfflineReleasePlan({
    candidate: plan.candidate,
    baseline: plan.baseline,
    createdAt: plan.createdAt,
    sourceRevision: options.sourceRevision,
    root: options.root ?? appsScriptRoot,
  });
  assert.deepEqual(plan, rebuilt, "release plan does not match the current candidate");
  return true;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(["--candidate", "--baseline", "--output", "--verify"].includes(key),
      `unknown argument: ${key}`);
    assert.ok(value, `${key} requires a value`);
    values[key.slice(2)] = value;
  }
  return values;
}

function safeOutputPath(requested) {
  const outputRoot = path.join(appsScriptRoot, ".local-release");
  const resolved = path.resolve(requested);
  const relative = path.relative(outputRoot, resolved);
  assert.ok(relative && path.dirname(relative) === "." && !path.isAbsolute(relative),
    "release plan output must be a direct file inside apps-script/.local-release");
  fs.mkdirSync(outputRoot, { recursive: true });
  const rootStat = fs.lstatSync(outputRoot);
  assert.equal(rootStat.isSymbolicLink(), false, "release plan output directory cannot be a symlink");
  assert.equal(rootStat.isDirectory(), true, "release plan output root must be a directory");
  assert.equal(fs.realpathSync.native(path.dirname(resolved)), fs.realpathSync.native(outputRoot),
    "release plan output resolves outside apps-script/.local-release");
  return resolved;
}

function runCli() {
  const args = parseArguments(process.argv.slice(2));
  execFileSync(process.execPath, [path.join(scriptDirectory, "verify-snapshots.mjs")], {
    stdio: "inherit",
  });
  const sourceState = verifySourceState();
  if (args.verify) {
    verifyOfflineReleasePlan(readJson(path.resolve(args.verify)), {
      sourceRevision: sourceState.head,
    });
    process.stdout.write("Apps Script offline release plan verified.\n");
    return;
  }
  assert.ok(args.candidate && args.baseline,
    "Usage: --candidate vNN --baseline vNN [--output apps-script/.local-release/plan.json]");
  const plan = buildOfflineReleasePlan({
    candidate: args.candidate,
    baseline: args.baseline,
    sourceRevision: sourceState.head,
  });
  const defaultName = `plan-${plan.createdAt.replace(/[:.]/g, "-")}.json`;
  const output = safeOutputPath(args.output || path.join(appsScriptRoot, ".local-release", defaultName));
  fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "release plan failed"}\n`);
    process.exitCode = 1;
  }
}
