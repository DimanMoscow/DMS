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

test("Mini App proxy is strictly read-only and keeps Telegram credentials ephemeral", async () => {
  const [routeSource, shellSource] = await Promise.all([
    readFile("app/api/dms/route.ts", "utf8"),
    readFile("app/_components/mini-app-shell.tsx", "utf8"),
  ]);

  assert.match(routeSource, /new Set\(\["bootstrap", "client", "health"\]\)/);
  assert.doesNotMatch(routeSource, /create|update|delete|payment|cancel|confirm/i);
  assert.doesNotMatch(routeSource, /console\.(log|info|debug).*initData/i);
  assert.doesNotMatch(shellSource, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(shellSource, /console\.(log|info|debug).*initData/i);
});
