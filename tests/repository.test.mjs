import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("repository does not contain committed secrets or legacy bot entrypoints", async () => {
  const [ignore, manifest] = await Promise.all([
    readFile(".gitignore", "utf8"),
    readFile("public/manifest.webmanifest", "utf8"),
  ]);

  assert.match(ignore, /\.env\*/);
  assert.equal(JSON.parse(manifest).short_name, "DMS");
});

test("health endpoint never exposes backend URL", async () => {
  const [healthSource, shellSource, configSource, proxySource] = await Promise.all([
    readFile("app/api/health/route.ts", "utf8"),
    readFile("app/_components/mini-app-shell.tsx", "utf8"),
    readFile("lib/dms-server-config.ts", "utf8"),
    readFile("app/api/dms/route.ts", "utf8"),
  ]);
  assert.doesNotMatch(healthSource, /DMS_APPS_SCRIPT_URL\s*[:=]\s*process\.env/);
  assert.doesNotMatch(shellSource, /script\.google\.com|DMS_APPS_SCRIPT_URL/);
  assert.doesNotMatch(configSource, /script\.google\.com/);
  assert.match(configSource, /process\.env\.DMS_APPS_SCRIPT_URL/);
  assert.match(proxySource, /backend_not_configured/);
  assert.match(healthSource, /dataMode/);
  assert.match(healthSource, /runtimeFingerprint/);
  assert.match(healthSource, /sourceRevision/);
});

test("Mini App proxy exposes only the approved actions and keeps Telegram credentials ephemeral", async () => {
  const [routeSource, shellSource] = await Promise.all([
    readFile("app/api/dms/route.ts", "utf8"),
    readFile("app/_components/mini-app-shell.tsx", "utf8"),
  ]);

  for (const action of [
    "bootstrap", "client", "health", "set_queue_decision", "confirm_day",
    "client_portal_bootstrap", "client_portal_enroll",
    "create_client_portal_invite", "revoke_client_portal_invite",
    "create_client_measurement", "correct_client_measurement",
  ]) {
    assert.match(routeSource, new RegExp(`"${action}"`));
  }
  assert.doesNotMatch(routeSource, /console\.(log|info|debug).*initData/i);
  assert.doesNotMatch(shellSource, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(shellSource, /console\.(log|info|debug).*initData/i);
});

test("client portal proxy rejects selectors and disables caching on every response", async () => {
  const [routeSource, portalSource, homeSource, entrySource] = await Promise.all([
    readFile("app/api/dms/route.ts", "utf8"),
    readFile("app/client/client-portal.tsx", "utf8"),
    readFile("app/page.tsx", "utf8"),
    readFile("app/_components/mini-app-entry.tsx", "utf8"),
  ]);

  assert.match(routeSource, /payloadlessClientActions\.has\(action\)/);
  assert.match(routeSource, /"clientId" in input/);
  assert.match(routeSource, /"payload" in input/);
  assert.match(routeSource, /const upstreamBody = payloadlessClientActions\.has\(action\)/);
  assert.match(routeSource, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(portalSource, /clientId/);
  assert.doesNotMatch(portalSource, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(portalSource, /console\.(log|info|debug)/);
  assert.match(portalSource, /action: "client_portal_enroll"/);
  assert.match(homeSource, /<MiniAppEntry \/>/);
  assert.match(entrySource, /getMiniAppEntryMode\(initData\)/);
  assert.match(entrySource, /<ClientPortal \/>/);
  assert.match(entrySource, /<MiniAppShell \/>/);
});

test("enrollment keeps tokens and Telegram identities out of application logs", async () => {
  const [routeSource, portalSource, appsScriptSource] = await Promise.all([
    readFile("app/api/dms/route.ts", "utf8"),
    readFile("app/client/client-portal.tsx", "utf8"),
    readFile("apps-script/candidates/v44/ZZZZZZZZZZZClientPortal.gs", "utf8"),
  ]);
  assert.doesNotMatch(routeSource, /console\.(log|error)\([^)]*(initData|payload|clientId|telegramUserId)/i);
  assert.doesNotMatch(portalSource, /console\./);
  assert.doesNotMatch(appsScriptSource, /console\.(log|error)\([^)]*(token|telegramUserId|initData)/i);
  assert.match(appsScriptSource, /sha256DmsClientPortal_\(token\)/);
  assert.doesNotMatch(appsScriptSource, /appendRow\(\[\s*token\s*,/);
});

test("today mutations reuse the queue contract and prevent duplicate client-side actions", async () => {
  const shellSource = await readFile("app/_components/mini-app-shell.tsx", "utf8");

  assert.match(shellSource, /set_queue_decision/);
  assert.match(shellSource, /confirm_day/);
  assert.match(shellSource, /Подтвердить день можно после/);
  assert.match(shellSource, /const ready = allDecided && dayEnded/);
  assert.match(shellSource, /Number\(hour\) - 3/);
  assert.match(shellSource, /item\.processed \|\| Boolean\(busyKey\)/);
  assert.match(shellSource, /setData\(result\.bootstrap\)/);
  assert.match(shellSource, /await refreshBootstrap\(\)/);
  assert.match(shellSource, /повторных списаний нет/);
});

test("Mini App supports Telegram back navigation and bounded requests", async () => {
  const shellSource = await readFile("app/_components/mini-app-shell.tsx", "utf8");

  assert.match(shellSource, /BackButton/);
  assert.match(shellSource, /backButton\.onClick\(handleBack\)/);
  assert.match(shellSource, /backButton\.offClick\(handleBack\)/);
  assert.match(shellSource, /controller\.abort\(\), 25_000/);
  assert.match(shellSource, /request_timeout/);
});
