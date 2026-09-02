import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  BINDING_HEADERS,
  MEASUREMENT_HEADERS,
  preflightClientPortalMigration,
} from "../apps-script/migrations/client-portal-v1/preflight.mjs";
import {
  preflightClientPortalPilot,
} from "../apps-script/migrations/client-portal-v1/pilot-preflight.mjs";

const readFixture = (name) => JSON.parse(fs.readFileSync(
  `apps-script/migrations/client-portal-v1/fixtures/${name}.json`,
  "utf8",
));

test("client portal migration schema matches the runtime sheet contract", () => {
  const schema = JSON.parse(fs.readFileSync(
    "apps-script/migrations/client-portal-v1/schema.json",
    "utf8",
  ));
  assert.deepEqual(schema.sheets.bindings.columns.map((column) => column.name), BINDING_HEADERS);
  assert.deepEqual(schema.sheets.measurements.columns.map((column) => column.name), MEASUREMENT_HEADERS);
});

test("valid two-client migration input passes without exposing identifiers", () => {
  const report = preflightClientPortalMigration(readFixture("valid"));
  assert.equal(report.valid, true, JSON.stringify(report));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.summary, {
    existingClients: 2,
    bindings: 2,
    activeBindings: 2,
    measurements: 2,
  });
  assert.equal(JSON.stringify(report).includes("CL-FIXTURE"), false);
  assert.equal(JSON.stringify(report).includes("100001"), false);
});

test("duplicate identities, client links and measurement timestamps fail closed", () => {
  const report = preflightClientPortalMigration(readFixture("invalid-duplicates"));
  const codes = new Set(report.errors.map((error) => error.code));
  assert.equal(report.valid, false);
  assert.equal(codes.has("duplicate_telegram_user_id"), true);
  assert.equal(codes.has("duplicate_bound_client_id"), true);
  assert.equal(codes.has("duplicate_client_measurement_time"), true);
});

test("unknown fields, missing clients, empty measurements and out-of-range metrics fail closed", () => {
  const input = readFixture("valid");
  input.bindings[0].username = "forbidden";
  input.bindings[1].clientId = "CL-NOT-EXPORTED";
  input.measurements[0] = {
    measurementId: "MSR-EMPTY",
    clientId: "CL-FIXTURE-A",
    measuredAt: "2026-08-21T09:00:00.000Z",
  };
  input.measurements[1].weightKg = 999;
  const report = preflightClientPortalMigration(input);
  const codes = new Set(report.errors.map((error) => error.code));
  assert.equal(report.valid, false);
  assert.equal(codes.has("unexpected_field"), true);
  assert.equal(codes.has("client_not_found"), true);
  assert.equal(codes.has("measurement_empty"), true);
  assert.equal(codes.has("metric_out_of_range"), true);
});

test("two-client pilot is staged, rechecked and reversible without exposing identifiers", () => {
  const report = preflightClientPortalPilot(readFixture("pilot-valid"));
  assert.equal(report.valid, true, JSON.stringify(report));
  assert.deepEqual(report.summary, {
    existingClients: 2,
    currentBindings: 0,
    currentMeasurements: 0,
    proposedBindings: 2,
    proposedMeasurements: 2,
  });
  assert.deepEqual(report.plan.stages.map((stage) => stage.name), [
    "stage_bindings_disabled",
    "append_measurements",
    "read_back_and_recheck",
    "activate_bindings",
    "isolation_smoke",
  ]);
  assert.deepEqual(report.plan.rollback, {
    disableBindings: 2,
    removeBindings: 2,
    removeMeasurements: 2,
  });
  assert.equal(JSON.stringify(report).includes("CL-FIXTURE"), false);
  assert.equal(JSON.stringify(report).includes("100001"), false);
});

test("pilot rejects schema drift and collisions with current production rows", () => {
  const input = readFixture("pilot-valid");
  input.schema.bindingHeaders[0] = "Wrong Header";
  input.currentBindings.push({
    ...input.proposedBindings[0],
    bindingId: "BND-EXISTING",
  });
  const report = preflightClientPortalPilot(input);
  const codes = new Set(report.errors.map((item) => item.code));
  assert.equal(report.valid, false);
  assert.equal(codes.has("binding_schema_mismatch"), true);
  assert.equal(codes.has("duplicate_telegram_user_id"), true);
  assert.equal(codes.has("duplicate_bound_client_id"), true);
});

test("pilot requires exactly two proposed active bindings", () => {
  const input = readFixture("pilot-valid");
  input.proposedBindings.pop();
  input.proposedBindings[0].status = "disabled";
  const report = preflightClientPortalPilot(input);
  const codes = new Set(report.errors.map((item) => item.code));
  assert.equal(report.valid, false);
  assert.equal(codes.has("pilot_requires_two_bindings"), true);
  assert.equal(codes.has("pilot_binding_must_be_active"), true);
});

test("enrollment schema stores only hashes and starts empty", () => {
  const schema = JSON.parse(fs.readFileSync(
    "apps-script/migrations/client-portal-enrollment-v1/schema.json",
    "utf8",
  ));
  assert.equal(schema.sheet.name, "Приглашения Client Portal");
  assert.equal(schema.sheet.columns.length, 10);
  assert.equal(schema.sheet.columns.some((column) => /plaintext|raw token/i.test(column.name)), false);
  assert.deepEqual(schema.sheet.columns[3].values, ["pending", "used", "revoked", "expired"]);

  const result = spawnSync(process.execPath, [
    "apps-script/migrations/client-portal-enrollment-v1/preflight.mjs",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).rowsToWrite, 0);
});
