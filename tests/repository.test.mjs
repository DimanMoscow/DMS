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
  const source = await readFile("app/api/health/route.ts", "utf8");
  assert.doesNotMatch(source, /DMS_APPS_SCRIPT_URL\s*[:=]\s*process\.env/);
  assert.match(source, /dataMode/);
});
