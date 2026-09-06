#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { googleJson, loadAuthorizationProfile, refreshGoogleAccessToken } from "./google-auth.mjs";
import { canonicalSource, sha256, sourceTreeSha256 } from "./source-integrity.mjs";
import { verifyBackupManifest } from "./verify-backup-manifest.mjs";
import { assertPrivateRegularFile, isOutsidePath } from "../../scripts/path-policy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appsScriptRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(appsScriptRoot, "..");
const SCRIPT_API = "https://script.googleapis.com/v1";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const SHEETS_API = "https://sheets.googleapis.com/v4";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields differ`);
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(["--mode", "--target", "--backup", "--output"].includes(key), `unknown argument: ${key}`);
    assert.ok(value, `${key} requires a value`);
    result[key.slice(2)] = value;
  }
  assert.ok(["reader", "writer"].includes(result.mode), "--mode must be reader or writer");
  for (const name of ["target", "backup", "output"]) assert.ok(result[name], `--${name} is required`);
  return result;
}

function assertPrivateOutput(filePath) {
  assert.equal(path.isAbsolute(filePath), true, "preflight output path must be absolute");
  assert.ok(isOutsidePath(repositoryRoot, filePath), "preflight output must be outside the repository");
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const parent = fs.lstatSync(path.dirname(filePath));
  assert.equal(parent.isSymbolicLink(), false, "preflight output parent cannot be a symlink");
  assert.equal(parent.isDirectory(), true, "preflight output parent must be a directory");
}

function loadTarget(targetPath) {
  assertPrivateRegularFile(targetPath, repositoryRoot, "Apps Script target");
  const target = readJson(targetPath);
  exactKeys(target, ["script_id"], "Apps Script target");
  assert.match(String(target.script_id || ""), /^[A-Za-z0-9_-]{20,}$/, "script_id is invalid");
  return target;
}

export function remoteFileName(file) {
  assert.match(String(file?.name || ""), /^.+$/, "remote file name is missing");
  if (file.type === "JSON") return file.name === "appsscript" ? "appsscript.json" : `${file.name}.json`;
  assert.equal(file.type, "SERVER_JS", `${file.name}: unsupported remote file type`);
  return `${file.name}.gs`;
}

export function normalizeRemoteFiles(files) {
  const normalized = new Map();
  for (const file of files || []) {
    const name = remoteFileName(file);
    assert.equal(normalized.has(name), false, `${name}: duplicate remote file`);
    normalized.set(name, canonicalSource(file.source || "", name));
  }
  return normalized;
}

export function extractSubstitution(template, actual, placeholder, label) {
  const parts = template.split(placeholder);
  assert.equal(parts.length, 2, `${label}: placeholder must occur exactly once`);
  const [prefix, suffix] = parts;
  assert.ok(actual.startsWith(prefix) && actual.endsWith(suffix), `${label}: remote source shape differs`);
  const value = actual.slice(prefix.length, actual.length - suffix.length);
  assert.ok(value.length > 0 && !/[\r\n]/.test(value), `${label}: remote substitution is invalid`);
  assert.equal(template.replace(placeholder, value), actual, `${label}: remote substitution is ambiguous`);
  return value;
}

function localSources(root) {
  const result = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    assert.equal(entry.isFile(), true, `${entry.name}: only files are allowed`);
    result.set(entry.name, canonicalSource(fs.readFileSync(path.join(root, entry.name)), entry.name));
  }
  return result;
}

export function verifyRemoteBaseline({ remoteFiles, baselineFiles, sanitizations }) {
  assert.deepEqual([...remoteFiles.keys()].sort(), [...baselineFiles.keys()].sort(),
    "remote numbered version file set differs from the repository baseline");
  const values = {};
  for (const [name, source] of baselineFiles) {
    const remote = remoteFiles.get(name);
    const rule = sanitizations.find((candidate) => candidate.file === name);
    if (!rule) {
      assert.equal(remote, source, `${name}: remote numbered source differs`);
      continue;
    }
    values[rule.label] = extractSubstitution(source, remote, rule.placeholder, rule.label);
  }
  assert.equal(Object.keys(values).length, sanitizations.length, "not all operational substitutions were derived");
  return values;
}

export function materializeCandidate(candidateFiles, sanitizations, substitutions) {
  const materialized = new Map(candidateFiles);
  for (const rule of sanitizations) {
    assert.equal(typeof substitutions[rule.label], "string", `${rule.label}: substitution is missing`);
    const source = materialized.get(rule.file);
    assert.equal(typeof source, "string", `${rule.file}: candidate file is missing`);
    assert.equal(source.split(rule.placeholder).length - 1, rule.allowedReplacementsPerVersion,
      `${rule.file}: placeholder count differs`);
    materialized.set(rule.file, source.replaceAll(rule.placeholder, substitutions[rule.label]));
  }
  return materialized;
}

function assertCandidateIntegrity(verification, candidateName, candidateRoot) {
  const metadata = verification.candidates[candidateName];
  assert.ok(metadata, `${candidateName}: verification metadata is missing`);
  const files = fs.readdirSync(candidateRoot).sort();
  assert.equal(files.length, metadata.fileCount, `${candidateName}: candidate file count differs`);
  assert.equal(sourceTreeSha256(candidateRoot, files), metadata.sourceTreeSha256,
    `${candidateName}: candidate source tree differs`);
}

async function listSpreadsheets(accessToken, fetchImpl) {
  const files = [];
  let pageToken = "";
  do {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set("q", "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    url.searchParams.set("fields", "nextPageToken,files(id)");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await googleJson(accessToken, url, {}, fetchImpl);
    files.push(...(result.files || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function spreadsheetMetadata(accessToken, spreadsheetId, fetchImpl) {
  const fields = "sheets.properties(title,sheetId,gridProperties(rowCount,columnCount,frozenRowCount))";
  return googleJson(accessToken,
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false&fields=${encodeURIComponent(fields)}`,
    {}, fetchImpl);
}

export async function runAppsScriptPreflight({
  mode,
  profile,
  target,
  backupManifest,
  fetchImpl = fetch,
}) {
  const production = readJson(path.join(appsScriptRoot, "production.json"));
  const verification = readJson(path.join(appsScriptRoot, "verification.json"));
  const baselineName = production.snapshot;
  const candidateName = "v50";
  const baselineRoot = path.join(appsScriptRoot, "versions", baselineName);
  const candidateRoot = path.join(appsScriptRoot, "candidates", candidateName);
  assertCandidateIntegrity(verification, candidateName, candidateRoot);
  const recovery = verifyBackupManifest(backupManifest);
  const accessToken = await refreshGoogleAccessToken(profile, fetchImpl);

  const [headResponse, versionResponse, deploymentsResponse] = await Promise.all([
    googleJson(accessToken, `${SCRIPT_API}/projects/${encodeURIComponent(target.script_id)}/content`, {}, fetchImpl),
    googleJson(accessToken, `${SCRIPT_API}/projects/${encodeURIComponent(target.script_id)}/content?versionNumber=${production.numberedVersion}`, {}, fetchImpl),
    googleJson(accessToken, `${SCRIPT_API}/projects/${encodeURIComponent(target.script_id)}/deployments`, {}, fetchImpl),
  ]);
  const baselineFiles = localSources(baselineRoot);
  const numberedFiles = normalizeRemoteFiles(versionResponse.files);
  const substitutions = verifyRemoteBaseline({
    remoteFiles: numberedFiles,
    baselineFiles,
    sanitizations: verification.repositorySanitizations,
  });
  const headFiles = normalizeRemoteFiles(headResponse.files);
  assert.deepEqual(headFiles, numberedFiles, "remote HEAD differs from numbered production source");

  const productionDeployments = (deploymentsResponse.deployments || []).filter((deployment) =>
    Number(deployment?.deploymentConfig?.versionNumber) === production.numberedVersion &&
    (deployment.entryPoints || []).some((entryPoint) => entryPoint.entryPointType === "WEB_APP"));
  assert.equal(productionDeployments.length, 1,
    "expected exactly one web-app deployment mapped to the production numbered version");

  const driveFiles = await listSpreadsheets(accessToken, fetchImpl);
  const sourceMatches = driveFiles.filter((file) => sha256(file.id) === backupManifest.sourceSpreadsheetRefSha256);
  const backupMatches = driveFiles.filter((file) => sha256(file.id) === backupManifest.backupFileRefSha256);
  assert.equal(sourceMatches.length, 1, "source workbook reference was not found exactly once");
  assert.equal(backupMatches.length, 1, "backup workbook reference was not found exactly once");
  const metadata = await spreadsheetMetadata(accessToken, sourceMatches[0].id, fetchImpl);
  const sheetNames = (metadata.sheets || []).map((sheet) => sheet.properties?.title);
  for (const required of backupManifest.sheets.map((sheet) => sheet.name)) {
    assert.ok(sheetNames.includes(required), `source workbook is missing required sheet: ${required}`);
  }

  const ledgerSchema = readJson(path.join(appsScriptRoot, "migrations", "telegram-confirmations-v1", "schema.json"));
  const ledgerSheets = (metadata.sheets || []).filter((sheet) =>
    sheet.properties?.title === ledgerSchema.sheet.name);
  assert.ok(ledgerSheets.length <= 1, "Telegram ledger sheet is duplicated");
  let ledgerState = "absent";
  if (ledgerSheets.length === 1) {
    const headerRange = `'${ledgerSchema.sheet.name.replaceAll("'", "''")}'!1:2`;
    const values = await googleJson(accessToken,
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(sourceMatches[0].id)}/values/${encodeURIComponent(headerRange)}`,
      {}, fetchImpl);
    const expectedHeaders = ledgerSchema.sheet.columns.map((column) => column.name);
    assert.deepEqual(values.values?.[0] || [], expectedHeaders, "Telegram ledger headers differ");
    assert.equal((values.values || []).slice(1).flat().some((value) => String(value).trim()), false,
      "Telegram ledger contains data before rollout");
    assert.equal(ledgerSheets[0].properties?.gridProperties?.frozenRowCount,
      ledgerSchema.sheet.frozenRows, "Telegram ledger frozen-row setting differs");
    ledgerState = "present-empty";
  }

  const materialized = materializeCandidate(
    localSources(candidateRoot), verification.repositorySanitizations, substitutions,
  );
  assert.equal(materialized.size, verification.candidates[candidateName].fileCount,
    "materialized candidate file count differs");
  const moduleName = "ZZZZZZZZZZZZTelegramConfirmations.gs";
  const moduleHash = sha256(localSources(candidateRoot).get(moduleName));
  assert.equal(moduleHash, "3122547e3eb8631756071eae2b1e62fb43acb6c2c698bb2eb4471e7fd58a7584",
    "Telegram confirmation runtime marker differs from the module source");

  return {
    formatVersion: 1,
    mode,
    authenticated: true,
    readOnlyRequestsOnly: true,
    productionNumberedVersion: production.numberedVersion,
    deploymentMappingVerified: true,
    headMatchesNumberedVersion: true,
    numberedVersionMatchesGitSnapshot: true,
    backupReferenceVerified: true,
    restoreTestVerified: backupManifest.restoreTest.status === "verified",
    backupSheetCount: recovery.sheetCount,
    ledgerState,
    candidate: candidateName,
    candidateTreeSha256: verification.candidates[candidateName].sourceTreeSha256,
    candidateMaterialized: true,
    runtimeMarkerSha256: moduleHash,
    dryRun: mode === "writer",
    releaseReady: true,
    productionWrites: 0,
  };
}

async function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const profilePath = path.resolve(String(process.env.DMS_APPS_SCRIPT_AUTH_FILE || ""));
  assert.ok(process.env.DMS_APPS_SCRIPT_AUTH_FILE, "DMS_APPS_SCRIPT_AUTH_FILE is required");
  assertPrivateRegularFile(profilePath, repositoryRoot, "authorization profile");
  const targetPath = path.resolve(args.target);
  const backupPath = path.resolve(args.backup);
  assertPrivateRegularFile(backupPath, repositoryRoot, "private backup manifest");
  const result = await runAppsScriptPreflight({
    mode: args.mode,
    profile: loadAuthorizationProfile(profilePath, args.mode),
    target: loadTarget(targetPath),
    backupManifest: readJson(backupPath),
  });
  const outputPath = path.resolve(args.output);
  assertPrivateOutput(outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Google ${args.mode} preflight passed; production writes: 0.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Apps Script preflight failed"}\n`);
    process.exitCode = 1;
  });
}
