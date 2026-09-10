#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

import {googleJson, loadAuthorizationProfile, refreshGoogleAccessToken} from './google-auth.mjs';
import {normalizeRemoteFiles, verifyRemoteBaseline, materializeCandidate}
  from './apps-script-preflight.mjs';
import {readCanonicalSource, sha256, sourceTreeSha256} from './source-integrity.mjs';
import {verifyOfflineReleasePlan} from './release-plan.mjs';
import {verifyBackupManifest} from './verify-backup-manifest.mjs';
import {createP1PrivateRecovery} from './p1-private-backup.mjs';
import {assertPrivateRegularFile} from '../../scripts/path-policy.mjs';

const SCRIPT_API = 'https://script.googleapis.com/v1';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sourceMap = directory => new Map(fs.readdirSync(directory).sort().map(name =>
  [name, readCanonicalSource(path.join(directory, name))]));

export function verifyStabilizationReleaseInventory(inventory, {now = Date.now()} = {}) {
  assert.equal(inventory.originalDocumentContext, true);
  assert.equal(inventory.mutationReady, false,
    'stabilization candidate must remain paused before activation');
  assert.equal(inventory.scriptLockAvailable, true);
  assert.equal(inventory.documentLockAvailable, true);
  assert.equal(inventory.scheduledAutomation?.configOk, true,
    'scheduled trigger configuration is not verified');
  assert.equal(inventory.scheduledAutomation?.settingsOk, true,
    'morning/evening settings are not enabled');
  assert.equal(inventory.scheduledAutomation?.ownerVerified, true,
    'scheduled trigger owner is not verified');
  assert.equal(inventory.scheduledAutomation?.handlers?.length, 5,
    'scheduled trigger inventory must contain five handlers');
  assert.equal(inventory.scheduledAutomation.handlers.every(item =>
    item.configOk === true &&
    item.state !== 'trigger_missing' &&
    item.state !== 'trigger_misconfigured'), true,
  'scheduled trigger inventory contains a missing or misconfigured handler');
  assert.equal(inventory.legacyStates?.malformed, 0,
    'malformed legacy evidence requires private recovery');
  assert.ok(now - Date.parse(inventory.checkedAt) >= 0 &&
    now - Date.parse(inventory.checkedAt) < 600000,
  'original-context inventory must be fresh');
  assert.ok(Number.isFinite(Date.parse(inventory.drainStartedAt)) &&
    now - Date.parse(inventory.drainStartedAt) >= 420000,
  'old execution drain is incomplete');
  return true;
}

export async function resolveStabilizationVersion({
  versions,
  baselineNumber = 54,
  materialized,
  readVersion,
  createVersion,
}) {
  const numbers = (versions || []).map(version => Number(version.versionNumber));
  assert.ok(numbers.length > 0 && numbers.every(Number.isSafeInteger),
    'Apps Script version inventory is invalid');
  const maximum = Math.max(...numbers);
  assert.ok(maximum >= baselineNumber, 'latest Apps Script version predates production baseline');
  if (maximum === baselineNumber) {
    const created = await createVersion();
    const assigned = Number(created.versionNumber);
    assert.ok(Number.isSafeInteger(assigned) && assigned > baselineNumber,
      'Google returned an invalid Apps Script version number');
    assert.deepEqual(await readVersion(assigned), materialized,
      'new numbered stabilization source differs');
    return assigned;
  }
  assert.deepEqual(await readVersion(maximum), materialized,
    'latest Apps Script version is an unrelated source');
  return maximum;
}

export async function runStabilizationReleasePhase({
  phase,
  privateRoot,
  planPath,
  backupPath,
  inventoryPath,
  fetchImpl = fetch,
}) {
  assert.ok(['backup', 'refresh-backup', 'stage', 'publish'].includes(phase),
    'unknown stabilization release phase');
  assertPrivateRegularFile(path.join(privateRoot, 'target.json'), process.cwd(), 'private target');
  const sourceRevision = execFileSync('git', [
    '-c', 'safe.directory=' + process.cwd().replaceAll('\\', '/'), 'rev-parse', 'HEAD',
  ], {encoding: 'utf8'}).trim();
  const plan = read(planPath);
  verifyOfflineReleasePlan(plan, {sourceRevision});
  assert.equal(plan.candidate, 'stabilization');
  assert.equal(plan.baseline, 'v54');

  loadAuthorizationProfile(path.join(privateRoot, 'reader-profile.json'), 'reader');
  const profile = loadAuthorizationProfile(path.join(privateRoot, 'writer-profile.json'), 'writer');
  const token = await refreshGoogleAccessToken(profile, fetchImpl);
  const target = read(path.join(privateRoot, 'target.json'));
  const spreadsheet = read(path.join(privateRoot, 'p1-isolated-target.json')).sourceSpreadsheetId;
  const verification = read('apps-script/verification.json');
  const candidateDirectory = 'apps-script/candidates/stabilization';
  const candidateFiles = sourceMap(candidateDirectory);
  const candidateTree = sourceTreeSha256(candidateDirectory, [...candidateFiles.keys()]);
  assert.equal(candidateTree, verification.candidates.stabilization.sourceTreeSha256);
  const base = SCRIPT_API + '/projects/' + encodeURIComponent(target.script_id);
  const [numbered, head, deployments] = await Promise.all([
    googleJson(token, base + '/content?versionNumber=54', {}, fetchImpl),
    googleJson(token, base + '/content', {}, fetchImpl),
    googleJson(token, base + '/deployments', {}, fetchImpl),
  ]);
  const substitutions = verifyRemoteBaseline({
    remoteFiles: normalizeRemoteFiles(numbered.files),
    baselineFiles: sourceMap('apps-script/versions/v54'),
    sanitizations: verification.repositorySanitizations,
  });
  const materialized = materializeCandidate(
    candidateFiles,
    verification.repositorySanitizations,
    substitutions,
  );
  const runtimeUrl = substitutions.appsScriptProductionUrl;
  const matching = (deployments.deployments || []).filter(deployment =>
    (deployment.entryPoints || []).some(entry => entry.webApp?.url === runtimeUrl));
  assert.equal(matching.length, 1, 'production web-app URL must resolve exactly once');
  const deployment = matching[0];
  const deployedVersion = Number(deployment.deploymentConfig.versionNumber);
  assert.ok(Number.isSafeInteger(deployedVersion) && deployedVersion >= 54,
    'production deployment predates v54');
  const headFiles = normalizeRemoteFiles(head.files);
  const save = (name, result) => {
    const report = {
      phase,
      checkedAt: new Date().toISOString(),
      sourceRevision,
      candidateTreeSha256: candidateTree,
      ...result,
    };
    fs.writeFileSync(path.join(privateRoot, name), JSON.stringify(report, null, 2), {mode: 0o600});
    return report;
  };

  if (phase === 'backup' || phase === 'refresh-backup') {
    assert.equal(deployedVersion, 54,
      'pre-stabilization recovery requires production v54');
    if (phase === 'backup') {
      assert.deepEqual(headFiles, normalizeRemoteFiles(numbered.files),
        'Apps Script HEAD changed since numbered v54');
    } else {
      assert.deepEqual(headFiles, materialized,
        'staged Apps Script HEAD must equal stabilization candidate');
      assertPrivateRegularFile(inventoryPath, process.cwd(),
        'stabilization original-context inventory');
      verifyStabilizationReleaseInventory(read(inventoryPath));
    }
    const recovery = await createP1PrivateRecovery({
      accessToken: token,
      sourceSpreadsheetId: spreadsheet,
      privateRoot,
      label: 'pre-system-stabilization',
      appsScriptVersion: 'v54',
      fetchImpl,
    });
    return save('stabilization-current-recovery.json', recovery);
  }

  assertPrivateRegularFile(backupPath, process.cwd(), 'fresh recovery manifest');
  const backup = read(backupPath);
  verifyBackupManifest(backup);
  assert.equal(sha256(spreadsheet), backup.sourceSpreadsheetRefSha256);
  assert.ok(Date.now() - Date.parse(backup.copyVerifiedAt) < 3600000,
    'stabilization release requires a verified backup less than one hour old');
  if (phase === 'stage') {
    assert.equal(deployedVersion, 54, 'stabilization candidate is already deployed');
    assert.deepEqual(headFiles, normalizeRemoteFiles(numbered.files),
      'Apps Script HEAD changed since numbered v54');
    const files = [...materialized].map(([name, source]) => name === 'appsscript.json'
      ? {name: 'appsscript', type: 'JSON', source}
      : {name: name.slice(0, -3), type: 'SERVER_JS', source});
    await googleJson(token, base + '/content', {
      method: 'PUT',
      body: JSON.stringify({files}),
    }, fetchImpl);
    assert.deepEqual(
      normalizeRemoteFiles((await googleJson(token, base + '/content', {}, fetchImpl)).files),
      materialized,
      'stabilization HEAD read-back differs',
    );
    return save('stabilization-staged-paused.json', {
      headVerified: true,
      productionVersion: 54,
      mutationsEnabled: false,
    });
  }

  assert.deepEqual(headFiles, materialized,
    'Apps Script HEAD must equal stabilization candidate');
  assertPrivateRegularFile(inventoryPath, process.cwd(),
    'stabilization original-context inventory');
  const inventory = read(inventoryPath);
  verifyStabilizationReleaseInventory(inventory);
  const staged = read(path.join(privateRoot, 'stabilization-staged-paused.json'));
  assert.equal(staged.candidateTreeSha256, candidateTree);
  assert.ok(Date.parse(inventory.drainStartedAt) >= Date.parse(staged.checkedAt),
    'drain must start after stabilization HEAD staging');

  const versions = await googleJson(token, base + '/versions?pageSize=200', {}, fetchImpl);
  const numberedVersion = await resolveStabilizationVersion({
    versions: versions.versions,
    materialized,
    readVersion: async versionNumber => normalizeRemoteFiles((await googleJson(
      token,
      base + '/content?versionNumber=' + encodeURIComponent(versionNumber),
      {},
      fetchImpl,
    )).files),
    createVersion: () => googleJson(token, base + '/versions', {
      method: 'POST',
      body: JSON.stringify({description: 'DMS system stabilization milestone'}),
    }, fetchImpl),
  });
  if (deployedVersion === 54) {
    await googleJson(token, base + '/deployments/' + encodeURIComponent(deployment.deploymentId), {
      method: 'PUT',
      body: JSON.stringify({deploymentConfig: {
        versionNumber: numberedVersion,
        manifestFileName: deployment.deploymentConfig.manifestFileName,
        description: deployment.deploymentConfig.description,
      }}),
    }, fetchImpl);
  }
  let deployed;
  for (let attempt = 0; attempt < 5; attempt++) {
    deployed = await googleJson(
      token,
      base + '/deployments/' + encodeURIComponent(deployment.deploymentId),
      {},
      fetchImpl,
    );
    if (Number(deployed.deploymentConfig.versionNumber) === numberedVersion) break;
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(Number(deployed.deploymentConfig.versionNumber), numberedVersion);
  return save('stabilization-published-paused.json', {
    numberedSnapshotVerified: true,
    deploymentVerified: true,
    productionVersion: numberedVersion,
    numberedVersion,
    mutationsEnabled: false,
    scheduledConfigurationVerified: true,
    scheduledFreshnessVerified: false,
  });
}

async function runCli() {
  const [phase, privateRoot, planPath, backupPath, inventoryPath, confirm] =
    process.argv.slice(2);
  assert.equal(confirm, 'stabilization',
    'explicit final argument stabilization required');
  const result = await runStabilizationReleasePhase({
    phase,
    privateRoot: path.resolve(privateRoot),
    planPath: path.resolve(planPath),
    backupPath: backupPath ? path.resolve(backupPath) : '',
    inventoryPath: inventoryPath ? path.resolve(inventoryPath) : '',
  });
  process.stdout.write(JSON.stringify({
    phase: result.phase,
    checkedAt: result.checkedAt,
    candidateTreeSha256: result.candidateTreeSha256,
    productionVersion: result.productionVersion,
    numberedVersion: result.numberedVersion,
    mutationsEnabled: result.mutationsEnabled,
    sheetCount: result.sheetCount,
    manifestPath: result.manifestPath,
  }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    process.stderr.write((error instanceof Error ? error.message :
      'stabilization release failed') + '\n');
    process.exitCode = 1;
  });
}
