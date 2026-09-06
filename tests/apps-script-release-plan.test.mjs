import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  buildOfflineReleasePlan,
  verifyOfflineReleasePlan,
} from "../apps-script/scripts/release-plan.mjs";
import { validateAuthorizationProfile } from "../apps-script/scripts/check-credential-profile.mjs";
import { isOutsidePath } from "../scripts/path-policy.mjs";
import { verifyRuntimeIdentity } from "../apps-script/scripts/runtime-identity.mjs";
import {
  extractSubstitution,
  materializeCandidate,
  normalizeRemoteFiles,
  verifyRemoteBaseline,
} from "../apps-script/scripts/apps-script-preflight.mjs";

test("Apps Script offline plan is deterministic, redacted, and never deployable", () => {
  const input = {
    candidate: "v50",
    baseline: "v50",
    createdAt: "2026-09-05T00:00:00Z",
    sourceRevision: "1".repeat(40),
  };
  const first = buildOfflineReleasePlan(input);
  const second = buildOfflineReleasePlan(input);

  assert.deepEqual(first, second);
  assert.equal(verifyOfflineReleasePlan(first, { sourceRevision: input.sourceRevision }), true);
  assert.equal(first.status, "OFFLINE_READY");
  assert.equal(first.authenticated, false);
  assert.equal(first.remoteStateVerified, false);
  assert.equal(first.releaseReady, false);
  assert.equal(first.deployable, false);
  assert.equal(Object.keys(first.files).length, 17);
  assert.doesNotMatch(JSON.stringify(first), /script\.google\.com|\.vercel\.app|refresh_token/);
});

test("private-file policy rejects in-repository names beginning with two dots", () => {
  const root = path.resolve("repository-root");
  assert.equal(isOutsidePath(root, path.join(root, "..auth", "profile.json")), false);
  assert.equal(isOutsidePath(root, path.resolve(root, "..", "private", "profile.json")), true);
});

test("Apps Script offline plan rejects an unrecorded baseline", () => {
  assert.throws(
    () => buildOfflineReleasePlan({
      candidate: "v49",
      baseline: "v48",
      sourceRevision: "1".repeat(40),
    }),
    /recorded production candidate/,
  );
});

test("Apps Script authorization profiles enforce exact least-privilege scopes", () => {
  const profile = {
    type: "authorized_user",
    client_id: "client-id.apps.googleusercontent.com",
    client_secret: "client-secret",
    refresh_token: "refresh-token",
    scopes: [
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/script.projects.readonly",
      "https://www.googleapis.com/auth/script.deployments.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  };
  assert.deepEqual(validateAuthorizationProfile(profile, "reader"), {
    formatValid: true,
    authenticated: false,
  });
  assert.throws(
    () => validateAuthorizationProfile({ ...profile, scopes: [
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.deployments",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ] }, "reader"),
    /least-privilege scopes/,
  );
});

test("Apps Script production identity rejects a well-formed wrong hash", () => {
  const expected = {
    routerSha256: "a".repeat(64),
    clientPortalSha256: "b".repeat(64),
    telegramConfirmationsSha256: "c".repeat(64),
  };
  const identity = {
    ok: true,
    service: "dms-fitness-apps-script",
    release: "calendar-onboarding-r8-production-guards",
    clientPortalHandlerLoaded: true,
    telegramConfirmationsHandlerLoaded: true,
    ...expected,
  };
  assert.equal(verifyRuntimeIdentity(identity, expected), true);
  assert.throws(
    () => verifyRuntimeIdentity({ ...identity, routerSha256: "c".repeat(64) }, expected),
    /Expected values to be strictly equal/,
  );
});

test("Apps Script remote preflight derives operational values without exposing them", () => {
  const baseline = new Map([
    ["TelegramBot.gs", "before __PRIVATE_URL__ after\n"],
    ["appsscript.json", "{}\n"],
  ]);
  const remote = normalizeRemoteFiles([
    { name: "TelegramBot", type: "SERVER_JS", source: "before https://example.invalid/private after\n" },
    { name: "appsscript", type: "JSON", source: "{}\n" },
  ]);
  const sanitizations = [{
    label: "url",
    file: "TelegramBot.gs",
    placeholder: "__PRIVATE_URL__",
    allowedReplacementsPerVersion: 1,
  }];
  const substitutions = verifyRemoteBaseline({
    remoteFiles: remote,
    baselineFiles: baseline,
    sanitizations,
  });
  assert.deepEqual(substitutions, { url: "https://example.invalid/private" });
  const materialized = materializeCandidate(baseline, sanitizations, substitutions);
  assert.equal(materialized.get("TelegramBot.gs"), remote.get("TelegramBot.gs"));
  assert.equal(extractSubstitution("a __X__ z", "a secret z", "__X__", "x"), "secret");
  assert.throws(
    () => extractSubstitution("a __X__ z", "different", "__X__", "x"),
    /shape differs/,
  );
});

test("v50 runtime identity carries the exact confirmation module fingerprint", async () => {
  const bot = await import("node:fs/promises").then(({ readFile }) =>
    readFile("apps-script/candidates/v50/TelegramBot.gs", "utf8"));
  const moduleSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile("apps-script/candidates/v50/ZZZZZZZZZZZZTelegramConfirmations.gs", "utf8"));
  const digest = (await import("node:crypto")).createHash("sha256")
    .update(moduleSource.replace(/\r\n/g, "\n"))
    .digest("hex");
  assert.match(bot, new RegExp(`TELEGRAM_CONFIRMATIONS_SHA256: '${digest}'`));
  assert.match(bot, /telegramConfirmationsHandlerLoaded: typeof handleTelegramCallback_ === 'function'/);
});
