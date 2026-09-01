import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  BINDING_HEADERS,
  MEASUREMENT_HEADERS,
  preflightClientPortalMigration,
} from "../apps-script/migrations/client-portal-v1/preflight.mjs";

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
