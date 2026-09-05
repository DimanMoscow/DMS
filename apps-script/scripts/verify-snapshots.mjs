import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  canonicalSource,
  readCanonicalSource,
  sha256,
  sourceTreeSha256,
} from "./source-integrity.mjs";
import { verifyRuntimeIdentity } from "./runtime-identity.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appsScriptDirectory = path.resolve(scriptDirectory, "..");
const verificationPath = path.join(appsScriptDirectory, "verification.json");
const verification = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
const production = JSON.parse(
  fs.readFileSync(path.join(appsScriptDirectory, "production.json"), "utf8"),
);
const versions = Object.keys(verification.versions);
const sanitizationPatterns = {
  appsScriptProductionUrl: /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/g,
  miniAppProductionUrl:
    /https:\/\/[A-Za-z0-9.-]+\.vercel\.app(?:\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*)?/g,
};

const prohibitedPatterns = [
  ["Apps Script deployment URL", sanitizationPatterns.appsScriptProductionUrl],
  ["Vercel deployment URL", sanitizationPatterns.miniAppProductionUrl],
  ["Telegram bot token", /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["Google spreadsheet URL", /https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+/g],
  ["Google Calendar identifier", /[A-Za-z0-9._%+-]+@(?:group\.)?calendar\.google\.com/g],
  ["email address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  [
    "sensitive literal assignment",
    /\b(?:token|secret|api[_-]?key|script[_-]?id|spreadsheet[_-]?id|calendar[_-]?id)\s*[:=]\s*["'][^"']{8,}["']/gi,
  ],
];

function repositoryFileName(file) {
  if (file.type === "JSON") return `${file.name}.json`;
  if (file.type === "SERVER_JS") return `${file.name}.gs`;
  throw new Error(`Unsupported Apps Script file type: ${file.type}`);
}

function sanitizeExactSource(fileName, source) {
  let sanitized = source;
  for (const rule of verification.repositorySanitizations) {
    const pattern = sanitizationPatterns[rule.label];
    assert.ok(pattern, `Unknown sanitization rule: ${rule.label}`);
    pattern.lastIndex = 0;
    const matches = sanitized.match(pattern) ?? [];
    const expectedMatches = fileName === rule.file ? rule.allowedReplacementsPerVersion : 0;
    assert.equal(
      matches.length,
      expectedMatches,
      `${fileName}: unexpected ${rule.label} count in exact export`,
    );
    sanitized = sanitized.replace(pattern, rule.placeholder);
  }
  return sanitized;
}

const actualSources = {};

function regularSourceFileNames(directory, label) {
  const names = fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    assert.equal(entry.isSymbolicLink(), false, `${label}/${entry.name}: symlinks are forbidden`);
    assert.equal(entry.isFile(), true, `${label}/${entry.name}: only regular files are allowed`);
    assert.ok(entry.name === "appsscript.json" || entry.name.endsWith(".gs"),
      `${label}/${entry.name}: unsupported Apps Script file type`);
    return entry.name;
  }).sort();
  assert.equal(names.filter((name) => name === "appsscript.json").length, 1,
    `${label}: exactly one appsscript.json is required`);
  return names;
}

for (const version of versions) {
  const expected = verification.versions[version];
  assert.ok(expected, `${version}: verification metadata is missing`);
  assert.ok(
    Number.isInteger(expected.fileCount) && expected.fileCount > 0,
    `${version}: metadata file count is invalid`,
  );

  const versionDirectory = path.join(appsScriptDirectory, "versions", version);
  const expectedFileNames = expected.files
    ? Object.keys(expected.files).sort()
    : expected.matchesCandidate
      ? regularSourceFileNames(
        path.join(appsScriptDirectory, "candidates", expected.matchesCandidate),
        `candidate ${expected.matchesCandidate}`,
      )
      : Object.keys(actualSources[expected.baseVersion] ?? {}).sort();
  assert.equal(
    expectedFileNames.length,
    expected.fileCount,
    `${version}: reference file set is missing`,
  );
  const actualFileNames = regularSourceFileNames(versionDirectory, `snapshot ${version}`);
  assert.deepEqual(actualFileNames, expectedFileNames, `${version}: repository file set differs`);
  assert.equal(
    actualFileNames.length,
    expected.fileCount,
    `${version}: repository file count differs`,
  );

  actualSources[version] = {};
  const placeholderCounts = Object.fromEntries(
    verification.repositorySanitizations.map((rule) => [rule.label, 0]),
  );

  for (const fileName of actualFileNames) {
    const source = readCanonicalSource(path.join(versionDirectory, fileName));
    actualSources[version][fileName] = source;
    if (expected.files) {
      assert.equal(
        sha256(source),
        expected.files[fileName].repositorySourceSha256,
        `${version}/${fileName}: repository SHA-256 differs`,
      );
    }

    for (const rule of verification.repositorySanitizations) {
      const occurrences = source.split(rule.placeholder).length - 1;
      const expectedOccurrences =
        fileName === rule.file ? rule.allowedReplacementsPerVersion : 0;
      assert.equal(
        occurrences,
        expectedOccurrences,
        `${version}/${fileName}: ${rule.label} placeholder count differs`,
      );
      placeholderCounts[rule.label] += occurrences;
    }

    for (const [label, pattern] of prohibitedPatterns) {
      pattern.lastIndex = 0;
      assert.equal(pattern.test(source), false, `${version}/${fileName}: found ${label}`);
    }

    if (fileName.endsWith(".json")) {
      JSON.parse(source);
    } else {
      new vm.Script(source, { filename: `${version}/${fileName}` });
    }
  }

  for (const rule of verification.repositorySanitizations) {
    assert.equal(
      placeholderCounts[rule.label],
      rule.allowedReplacementsPerVersion,
      `${version}: unexpected ${rule.label} placeholder total`,
    );
  }

  if (expected.sourceTreeSha256) {
    assert.equal(
      sourceTreeSha256(versionDirectory, actualFileNames),
      expected.sourceTreeSha256,
      `${version}: source tree SHA-256 differs`,
    );
  }

  if (expected.baseVersion) {
    const baseSources = actualSources[expected.baseVersion];
    assert.ok(baseSources, `${version}: unknown base version ${expected.baseVersion}`);
    const changedFromBase = actualFileNames.filter(
      (fileName) => actualSources[version][fileName] !== baseSources[fileName],
    );
    assert.deepEqual(
      changedFromBase,
      expected.expectedChangedFiles,
      `${expected.baseVersion} to ${version} changed-file set differs`,
    );
  }

  const exactExportPath = path.join(appsScriptDirectory, ".local-exports", `${version}.json`);
  if (fs.existsSync(exactExportPath)) {
    assert.ok(expected.files, `${version}: exact-export file metadata is missing`);
    assert.ok(expected.exactExportSha256, `${version}: exact-export SHA-256 is missing`);
    const exactExport = fs.readFileSync(exactExportPath);
    assert.equal(
      sha256(exactExport),
      expected.exactExportSha256,
      `${version}: exact export SHA-256 differs`,
    );
    const payload = JSON.parse(exactExport.toString("utf8"));
    assert.equal(
      payload.files.length,
      expected.fileCount,
      `${version}: exact export file count differs`,
    );

    const exactFileNames = payload.files.map(repositoryFileName).sort();
    assert.deepEqual(exactFileNames, expectedFileNames, `${version}: exact export file set differs`);

    for (const file of payload.files) {
      const fileName = repositoryFileName(file);
      assert.equal(
        sha256(canonicalSource(file.source, `${version}/${fileName} exact export`)),
        expected.files[fileName].originalSourceSha256,
        `${version}/${fileName}: exact source SHA-256 differs`,
      );
      assert.equal(
        actualSources[version][fileName],
        sanitizeExactSource(
          fileName,
          canonicalSource(file.source, `${version}/${fileName} exact export`),
        ),
        `${version}/${fileName}: repository source is not the exact sanitized export`,
      );
    }
  }
}

for (const [version, expected] of Object.entries(verification.versions)) {
  if (!expected.matchesCandidate) continue;
  const candidateDirectory = path.join(
    appsScriptDirectory,
    "candidates",
    expected.matchesCandidate,
  );
  const fileNames = Object.keys(actualSources[version]).sort();
  for (const fileName of fileNames) {
    assert.equal(
      actualSources[version][fileName],
      readCanonicalSource(path.join(candidateDirectory, fileName)),
      `${version}/${fileName}: differs from candidate ${expected.matchesCandidate}`,
    );
  }
}

const allFileNames = Object.keys(actualSources.v38).sort();
const changedFiles = allFileNames.filter(
  (fileName) => actualSources.v38[fileName] !== actualSources.v39[fileName],
);
assert.deepEqual(
  changedFiles,
  verification.expectedVersionDiff,
  "The v38 to v39 changed-file set differs",
);

for (const [candidate, expected] of Object.entries(verification.candidates ?? {})) {
  const baseSources = actualSources[expected.baseVersion];
  assert.ok(baseSources, `${candidate}: unknown base version ${expected.baseVersion}`);

  const candidateDirectory = path.join(appsScriptDirectory, "candidates", candidate);
  const actualFileNames = regularSourceFileNames(candidateDirectory, `candidate ${candidate}`);
  assert.equal(actualFileNames.length, expected.fileCount, `${candidate}: file count differs`);
  const missingBaseFiles = Object.keys(baseSources).filter(
    (fileName) => !actualFileNames.includes(fileName),
  );
  assert.deepEqual(missingBaseFiles, [], `${candidate}: candidate removed base files`);
  assert.equal(
    sourceTreeSha256(candidateDirectory, actualFileNames),
    expected.sourceTreeSha256,
    `${candidate}: source tree SHA-256 differs`,
  );

  const candidateSources = {};
  const placeholderCounts = Object.fromEntries(
    verification.repositorySanitizations.map((rule) => [rule.label, 0]),
  );

  for (const fileName of actualFileNames) {
    const source = readCanonicalSource(path.join(candidateDirectory, fileName));
    candidateSources[fileName] = source;

    for (const rule of verification.repositorySanitizations) {
      const occurrences = source.split(rule.placeholder).length - 1;
      const expectedOccurrences =
        fileName === rule.file ? rule.allowedReplacementsPerVersion : 0;
      assert.equal(
        occurrences,
        expectedOccurrences,
        `${candidate}/${fileName}: ${rule.label} placeholder count differs`,
      );
      placeholderCounts[rule.label] += occurrences;
    }

    for (const [label, pattern] of prohibitedPatterns) {
      pattern.lastIndex = 0;
      assert.equal(pattern.test(source), false, `${candidate}/${fileName}: found ${label}`);
    }

    if (fileName.endsWith(".json")) {
      JSON.parse(source);
    } else {
      new vm.Script(source, { filename: `${candidate}/${fileName}` });
    }
  }

  for (const rule of verification.repositorySanitizations) {
    assert.equal(
      placeholderCounts[rule.label],
      rule.allowedReplacementsPerVersion,
      `${candidate}: unexpected ${rule.label} placeholder total`,
    );
  }

  const candidateChangedFiles = Array.from(new Set([
    ...Object.keys(baseSources),
    ...actualFileNames,
  ])).sort().filter((fileName) => candidateSources[fileName] !== baseSources[fileName]);
  assert.deepEqual(
    candidateChangedFiles,
    expected.expectedChangedFiles,
    `${expected.baseVersion} to ${candidate} changed-file set differs`,
  );
  console.log(
    `${expected.baseVersion} -> ${candidate} candidate changed files: ${candidateChangedFiles.join(", ")}`,
  );
}

console.log(
  `Apps Script snapshots verified: ${versions.map((version) =>
    `${version} (${verification.versions[version].fileCount} files)`).join(", ")}; ` +
    "two documented redactions per version.",
);
console.log(`v38 -> v39 changed files: ${changedFiles.join(", ")}`);

assert.deepEqual(Object.keys(production).sort(), [
  "candidate",
  "formatVersion",
  "lastVerified",
  "numberedVersion",
  "runtimeIdentity",
  "snapshot",
]);
assert.equal(production.formatVersion, 1);
assert.match(production.candidate, /^v\d+$/);
assert.equal(production.snapshot, production.candidate);
assert.equal(production.numberedVersion, Number(production.snapshot.slice(1)));
assert.equal(verification.versions[production.snapshot]?.matchesCandidate, production.candidate);
assert.equal(
  verification.versions[production.snapshot]?.sourceTreeSha256,
  verification.candidates[production.candidate]?.sourceTreeSha256,
  "production candidate and snapshot tree hashes differ",
);
assert.deepEqual(Object.keys(production.lastVerified).sort(), [
  "at", "liveGatePassed", "liveGateTotal", "reconciliationIssues",
]);
assert.ok(Number.isInteger(production.lastVerified.liveGateTotal) &&
  production.lastVerified.liveGateTotal > 0, "production live-gate total must be positive");
assert.ok(Number.isInteger(production.lastVerified.liveGatePassed),
  "production live-gate passed count must be an integer");
assert.equal(production.lastVerified.liveGatePassed, production.lastVerified.liveGateTotal);
assert.equal(production.lastVerified.reconciliationIssues, 0);
const verifiedAt = new Date(production.lastVerified.at);
assert.equal(Number.isNaN(verifiedAt.getTime()), false, "production verification time is invalid");
assert.match(production.lastVerified.at,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
  "production verification time must be UTC");
verifyRuntimeIdentity(production.runtimeIdentity, {
  routerSha256: sha256(actualSources[production.snapshot]["ZZZZZZZZMiniAppApi.gs"]),
  clientPortalSha256: sha256(actualSources[production.snapshot]["ZZZZZZZZZZZClientPortal.gs"]),
}, { requireOk: false });
console.log(
  `Production pointer verified: ${production.snapshot}, ` +
  `${production.lastVerified.liveGatePassed}/${production.lastVerified.liveGateTotal}, ` +
  `reconciliation ${production.lastVerified.reconciliationIssues}.`,
);
