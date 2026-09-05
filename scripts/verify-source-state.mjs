#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function verifySourceState({ expectedSha, allowMain = false } = {}) {
  const head = git("rev-parse", "HEAD").toLowerCase();
  assert.match(head, /^[0-9a-f]{40}$/);
  if (expectedSha) assert.equal(head, expectedSha.toLowerCase(), "HEAD differs from expected source SHA");
  assert.equal(git("status", "--porcelain"), "", "tracked worktree is not clean");
  const branch = git("branch", "--show-current");
  if (branch) {
    assert.ok(allowMain || branch !== "main", "pre-merge source check must run on a feature branch");
  } else {
    assert.ok(expectedSha, "detached HEAD requires an explicit expected source SHA");
  }
  return { head, branch: branch || "detached" };
}

function runCli() {
  const args = process.argv.slice(2);
  const expectedIndex = args.indexOf("--expected");
  const expectedSha = expectedIndex === -1 ? undefined : args[expectedIndex + 1];
  if (expectedIndex !== -1) assert.ok(expectedSha, "--expected requires a SHA");
  const known = new Set(["--expected", expectedSha, "--allow-main"].filter(Boolean));
  assert.ok(args.every((arg) => known.has(arg)), "unknown source-check argument");
  const result = verifySourceState({ expectedSha, allowMain: args.includes("--allow-main") });
  process.stdout.write(`Source state verified: ${result.head} (${result.branch}).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "source verification failed"}\n`);
    process.exitCode = 1;
  }
}
