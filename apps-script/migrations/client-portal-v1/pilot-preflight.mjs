import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  BINDING_HEADERS,
  MEASUREMENT_HEADERS,
  preflightClientPortalMigration,
} from "./preflight.mjs";

const rootKeys = [
  "schema",
  "existingClients",
  "currentBindings",
  "currentMeasurements",
  "proposedBindings",
  "proposedMeasurements",
];
const schemaKeys = ["bindingHeaders", "measurementHeaders"];

function exactKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === allowed.length &&
    Object.keys(value).every((key) => allowed.includes(key));
}

function error(code, area, row = 0, field = "root") {
  return { code, area, row, field };
}

function sameArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

export function preflightClientPortalPilot(input) {
  const errors = [];
  if (!exactKeys(input, rootKeys)) {
    errors.push(error("invalid_root_shape", "pilot"));
  }

  const schema = exactKeys(input?.schema, schemaKeys) ? input.schema : null;
  if (!schema) {
    errors.push(error("invalid_schema_shape", "schema"));
  } else {
    if (!sameArray(schema.bindingHeaders, BINDING_HEADERS)) {
      errors.push(error("binding_schema_mismatch", "schema", 1, "bindingHeaders"));
    }
    if (!sameArray(schema.measurementHeaders, MEASUREMENT_HEADERS)) {
      errors.push(error("measurement_schema_mismatch", "schema", 1, "measurementHeaders"));
    }
  }

  const arrayKeys = rootKeys.filter((key) => key !== "schema");
  for (const key of arrayKeys) {
    if (!Array.isArray(input?.[key])) errors.push(error("array_required", key));
  }

  const existingClients = Array.isArray(input?.existingClients) ? input.existingClients : [];
  const currentBindings = Array.isArray(input?.currentBindings) ? input.currentBindings : [];
  const currentMeasurements = Array.isArray(input?.currentMeasurements)
    ? input.currentMeasurements
    : [];
  const proposedBindings = Array.isArray(input?.proposedBindings) ? input.proposedBindings : [];
  const proposedMeasurements = Array.isArray(input?.proposedMeasurements)
    ? input.proposedMeasurements
    : [];

  const baseline = preflightClientPortalMigration({
    existingClients,
    bindings: currentBindings,
    measurements: currentMeasurements,
  });
  if (!baseline.valid) {
    errors.push(...baseline.errors.map((item) => ({
      ...item,
      code: `baseline_${item.code}`,
    })));
  } else {
    const combined = preflightClientPortalMigration({
      existingClients,
      bindings: [...currentBindings, ...proposedBindings],
      measurements: [...currentMeasurements, ...proposedMeasurements],
    });
    errors.push(...combined.errors);
  }

  if (proposedBindings.length !== 2) {
    errors.push(error("pilot_requires_two_bindings", "proposedBindings"));
  }
  if (proposedBindings.some((binding) => binding?.status !== "active")) {
    errors.push(error("pilot_binding_must_be_active", "proposedBindings", 0, "status"));
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    summary: {
      existingClients: existingClients.length,
      currentBindings: currentBindings.length,
      currentMeasurements: currentMeasurements.length,
      proposedBindings: proposedBindings.length,
      proposedMeasurements: proposedMeasurements.length,
    },
    plan: {
      stages: [
        { name: "stage_bindings_disabled", rows: proposedBindings.length },
        { name: "append_measurements", rows: proposedMeasurements.length },
        {
          name: "read_back_and_recheck",
          bindings: currentBindings.length + proposedBindings.length,
          measurements: currentMeasurements.length + proposedMeasurements.length,
        },
        { name: "activate_bindings", rows: proposedBindings.length },
        { name: "isolation_smoke", boundClients: 2, unlinkedClients: 1 },
      ],
      rollback: {
        disableBindings: proposedBindings.length,
        removeBindings: proposedBindings.length,
        removeMeasurements: proposedMeasurements.length,
      },
    },
  };
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3) {
    process.stderr.write("Usage: node pilot-preflight.mjs <pilot-input.json>\n");
    process.exitCode = 2;
    return;
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch {
    process.stderr.write("Pilot input could not be read as JSON.\n");
    process.exitCode = 2;
    return;
  }
  const report = preflightClientPortalPilot(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
