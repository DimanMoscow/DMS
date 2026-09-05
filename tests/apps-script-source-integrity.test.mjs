import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalSource,
  sha256,
  sourceTreeSha256,
} from "../apps-script/scripts/source-integrity.mjs";

test("Apps Script source hashes are stable across LF and CRLF checkouts", () => {
  const lf = "function example() {\n  return true;\n}\n";
  const crlf = lf.replace(/\n/g, "\r\n");

  assert.equal(canonicalSource(crlf), lf);
  assert.equal(sha256(canonicalSource(crlf)), sha256(lf));
});

test("Apps Script source rejects lone carriage returns", () => {
  assert.throws(() => canonicalSource("a\rb\n", "fixture"), /lone carriage return/);
});

test("Apps Script tree hashes are stable across line endings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dms-source-integrity-"));
  const lfRoot = path.join(root, "lf");
  const crlfRoot = path.join(root, "crlf");
  fs.mkdirSync(lfRoot);
  fs.mkdirSync(crlfRoot);
  fs.writeFileSync(path.join(lfRoot, "Code.gs"), "one\ntwo\n");
  fs.writeFileSync(path.join(crlfRoot, "Code.gs"), "one\r\ntwo\r\n");

  assert.equal(
    sourceTreeSha256(lfRoot, ["Code.gs"]),
    sourceTreeSha256(crlfRoot, ["Code.gs"]),
  );
});
