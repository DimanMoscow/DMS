#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GOOGLE_SCOPE_SETS, GOOGLE_TOKEN_ENDPOINT } from "./google-auth.mjs";
import { assertPrivateRegularFile, isOutsidePath } from "../../scripts/path-policy.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(["--mode", "--client", "--output", "--request-output"].includes(key),
      `unknown argument: ${key}`);
    assert.ok(value, `${key} requires a value`);
    values[key.slice(2)] = value;
  }
  assert.ok(GOOGLE_SCOPE_SETS[values.mode], "--mode must be reader or writer");
  for (const key of ["client", "output", "request-output"]) {
    assert.ok(values[key], `--${key} is required`);
  }
  return values;
}

function assertPrivateOutput(filePath, label) {
  assert.equal(path.isAbsolute(filePath), true, `${label} path must be absolute`);
  assert.ok(isOutsidePath(repositoryRoot, filePath), `${label} must be outside the repository`);
  assert.equal(fs.existsSync(filePath), false, `${label} already exists`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const parent = fs.lstatSync(path.dirname(filePath));
  assert.equal(parent.isSymbolicLink(), false, `${label} parent cannot be a symlink`);
  assert.equal(parent.isDirectory(), true, `${label} parent must be a directory`);
}

function readDesktopClient(clientPath) {
  assertPrivateRegularFile(clientPath, repositoryRoot, "OAuth desktop client");
  const installed = JSON.parse(fs.readFileSync(clientPath, "utf8"))?.installed;
  assert.ok(installed && typeof installed === "object", "OAuth client must be a Desktop app client");
  assert.match(String(installed.client_id || ""), /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/,
    "OAuth client_id is invalid");
  assert.ok(String(installed.client_secret || "").length >= 8, "OAuth client_secret is invalid");
  assert.equal(installed.auth_uri, "https://accounts.google.com/o/oauth2/auth",
    "OAuth authorization endpoint must be Google's official endpoint");
  assert.equal(installed.token_uri, GOOGLE_TOKEN_ENDPOINT,
    "OAuth token endpoint must be Google's official endpoint");
  return installed;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export async function authorizeGoogleProfile({ mode, clientPath, outputPath, requestOutputPath }) {
  const client = readDesktopClient(clientPath);
  assertPrivateOutput(outputPath, "authorization profile");
  assertPrivateOutput(requestOutputPath, "authorization request");

  const state = base64Url(crypto.randomBytes(24));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());

  let callbackResolve;
  let callbackReject;
  const callback = new Promise((resolve, reject) => {
    callbackResolve = resolve;
    callbackReject = reject;
  });
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      assert.equal(url.pathname, "/oauth2/callback", "unexpected OAuth callback path");
      assert.equal(url.searchParams.get("state"), state, "OAuth state mismatch");
      const error = url.searchParams.get("error");
      assert.equal(error, null, `Google authorization failed: ${error}`);
      const code = url.searchParams.get("code");
      assert.ok(code, "Google authorization returned no code");
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("DMS Google authorization completed. You can close this tab.");
      callbackResolve(code);
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("DMS Google authorization failed. Return to Codex.");
      callbackReject(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "OAuth callback server did not start");
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
  const authorizationUrl = new URL(client.auth_uri);
  authorizationUrl.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    scope: GOOGLE_SCOPE_SETS[mode].join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  fs.writeFileSync(requestOutputPath, `${JSON.stringify({ mode, authorizationUrl }, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`Google ${mode} authorization is waiting for browser consent.\n`);

  try {
    const code = await callback;
    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const tokens = await tokenResponse.json();
    assert.equal(tokenResponse.ok, true,
      `Google token exchange failed with HTTP ${tokenResponse.status}`);
    assert.equal(typeof tokens.refresh_token, "string", "Google returned no durable refresh token");
    assert.ok(tokens.refresh_token.length >= 20, "Google refresh token is invalid");
    const grantedScopes = String(tokens.scope || "").split(/\s+/).filter(Boolean).sort();
    assert.deepEqual(grantedScopes, [...GOOGLE_SCOPE_SETS[mode]].sort(),
      `Google granted scopes differ from the ${mode} profile`);
    const profile = {
      type: "authorized_user",
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: tokens.refresh_token,
      scopes: [...GOOGLE_SCOPE_SETS[mode]],
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(profile, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    fs.rmSync(requestOutputPath, { force: true });
    process.stdout.write(`Google ${mode} profile saved; token values were not printed.\n`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runCli() {
  const args = parseArguments(process.argv.slice(2));
  await authorizeGoogleProfile({
    mode: args.mode,
    clientPath: path.resolve(args.client),
    outputPath: path.resolve(args.output),
    requestOutputPath: path.resolve(args["request-output"]),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Google authorization failed"}\n`);
    process.exitCode = 1;
  });
}
