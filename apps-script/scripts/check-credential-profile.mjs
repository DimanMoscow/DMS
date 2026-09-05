#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertPrivateRegularFile } from "../../scripts/path-policy.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scopeSets = {
  reader: [
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/script.deployments.readonly",
    "https://www.googleapis.com/auth/script.projects.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ],
  writer: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
};

export function validateAuthorizationProfile(profile, mode) {
  assert.ok(scopeSets[mode], "mode must be reader or writer");
  assert.equal(profile?.type, "authorized_user", "profile type must be authorized_user");
  for (const key of ["client_id", "client_secret", "refresh_token"]) {
    assert.equal(typeof profile[key], "string", `${key} is required`);
    assert.ok(profile[key].length >= 8, `${key} is invalid`);
  }
  assert.deepEqual(
    [...(profile.scopes || [])].sort(),
    scopeSets[mode],
    `${mode} profile must contain exactly the documented least-privilege scopes`,
  );
  return { formatValid: true, authenticated: false };
}

function runCli() {
  const modeIndex = process.argv.indexOf("--mode");
  const mode = modeIndex === -1 ? "reader" : process.argv[modeIndex + 1];
  assert.ok(scopeSets[mode], "Usage: --mode reader|writer");
  const profilePath = String(process.env.DMS_APPS_SCRIPT_AUTH_FILE || "").trim();
  assert.ok(profilePath, "DMS_APPS_SCRIPT_AUTH_FILE is required");
  assertPrivateRegularFile(profilePath, repositoryRoot, "authorization profile");
  validateAuthorizationProfile(JSON.parse(fs.readFileSync(profilePath, "utf8")), mode);
  process.stdout.write(
    `Apps Script ${mode} credential profile format is valid; authenticated:false.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "authorization preflight failed"}\n`);
    process.exitCode = 1;
  }
}
