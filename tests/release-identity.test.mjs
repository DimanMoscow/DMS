import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from 'node:vm';
import ts from 'typescript';
import * as runtime from '../lib/apps-script-runtime-identity.ts';

test("health exposes a stable release fingerprint and optional source revision", async () => {
  const [health, identity, packageJson] = await Promise.all([
    readFile("app/api/health/route.ts", "utf8"),
    readFile("lib/release-identity.ts", "utf8"),
    readFile("package.json", "utf8").then(JSON.parse),
  ]);

  assert.match(health, /MINIAPP_RUNTIME_FINGERPRINT/);
  assert.match(health, /getMiniAppSourceRevision/);
  assert.match(identity, /miniapp-r8-apps-script-runtime-probe/);
  assert.match(identity, new RegExp(`MINIAPP_RELEASE = "${packageJson.version}"`));
  assert.match(identity, /\^\[0-9a-f\]\{40\}\$/);
  assert.doesNotMatch(identity, /DMS_APPS_SCRIPT_URL/);
});

test("request IDs are bounded to a log-safe allow-list", async () => {
  const source = await readFile("lib/request-id.ts", "utf8");
  assert.match(source, /\[A-Za-z0-9:_-\]/);
  assert.match(source, /\{1,180\}/);
  assert.match(source, /crypto\.randomUUID/);
});

test("production verifier fails closed on release, fingerprint and source mismatch", async () => {
  const source = await readFile("scripts/verify-production.mjs", "utf8");
  assert.match(source, /release mismatch/);
  assert.match(source, /runtime fingerprint mismatch/);
  assert.match(source, /source mismatch/);
  assert.match(source, /no-store/);
  assert.match(source, /dataMode !== "connected"/);
  assert.match(source, /apiProbe\.status !== 400/);
  assert.match(source, /api\/dms error response is cacheable/);
  assert.match(source, /api\/dms method response is cacheable/);
  assert.match(source, /method_not_allowed/);
  assert.match(source, /api\/apps-script-runtime/);
  assert.match(source, /Apps Script runtime identity mismatch/);
});

test("Apps Script runtime proxy is allow-listed, fail-closed and non-cacheable", async () => {
  const source = await readFile('app/api/apps-script-runtime/route.ts', 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const markers = {ok: true, clientPortalHandlerLoaded: true, telegramConfirmationsHandlerLoaded: true};
  let body; let configured = true; let fails = false;
  const context = vm.createContext({exports: {}, Response, URL, AbortSignal,
    require: name => {
      if (name === '@/lib/apps-script-runtime-identity') return runtime;
      if (name === '@/lib/dms-server-config') return {getDmsAppsScriptUrl: () => configured ? 'https://fixture.invalid/exec' : ''};
      throw new Error('Unexpected module');
    }, fetch: async (_url, options) => {
      assert.equal(options.cache, 'no-store');
      if (fails) throw new Error('private upstream error');
      return {ok: true, json: async () => body};
    }});
  vm.runInContext(compiled, context);
  for (const identity of [runtime.EXPECTED_APPS_SCRIPT_RUNTIME, runtime.CANDIDATE_APPS_SCRIPT_RUNTIME]) {
    body = {...identity, ...markers, privateField: 'must never be returned'};
    const response = await context.exports.GET();
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {...identity, ...markers});
    body.clientPortalHandlerLoaded = false;
    assert.equal((await context.exports.GET()).status, 502);
  }
  body = {...runtime.EXPECTED_APPS_SCRIPT_RUNTIME, ...markers,
    clientPortalSha256: runtime.CANDIDATE_APPS_SCRIPT_RUNTIME.clientPortalSha256};
  assert.equal((await context.exports.GET()).status, 502);
  fails = true;
  assert.deepEqual(await (await context.exports.GET()).json(), {ok: false, error: 'runtime_identity_unavailable'});
  configured = false;
  assert.equal((await context.exports.GET()).status, 503);
});
