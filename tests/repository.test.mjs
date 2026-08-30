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
  const [healthSource, shellSource] = await Promise.all([
    readFile("app/api/health/route.ts", "utf8"),
    readFile("app/_components/mini-app-shell.tsx", "utf8"),
  ]);
  assert.doesNotMatch(healthSource, /DMS_APPS_SCRIPT_URL\s*[:=]\s*process\.env/);
  assert.doesNotMatch(shellSource, /script\.google\.com|DMS_APPS_SCRIPT_URL/);
  assert.match(healthSource, /dataMode/);
});

test("Mini App proxy exposes only the approved actions and keeps Telegram credentials ephemeral", async () => {
  const [routeSource, shellSource] = await Promise.all([
    readFile("app/api/dms/route.ts", "utf8"),
    readFile("app/_components/mini-app-shell.tsx", "utf8"),
  ]);

  assert.match(routeSource, /new Set\(\["bootstrap", "client", "health", "set_queue_decision", "confirm_day"\]\)/);
  assert.doesNotMatch(routeSource, /console\.(log|info|debug).*initData/i);
  assert.doesNotMatch(shellSource, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(shellSource, /console\.(log|info|debug).*initData/i);
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
