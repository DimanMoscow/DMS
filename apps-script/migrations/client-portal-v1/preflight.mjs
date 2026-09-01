import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const BINDING_HEADERS = [
  "Binding ID", "Telegram User ID", "Client ID", "Status", "Created At", "Updated At",
];

export const MEASUREMENT_HEADERS = [
  "Measurement ID", "Client ID", "Measured At", "Weight Kg", "Chest Cm",
  "Waist Cm", "Hips Cm", "Upper Arm Cm", "Thigh Cm",
];

const bindingKeys = [
  "bindingId", "telegramUserId", "clientId", "status", "createdAt", "updatedAt",
];
const existingClientKeys = ["clientId"];
const metricRanges = {
  weightKg: [20, 400],
  chestCm: [30, 300],
  waistCm: [30, 300],
  hipsCm: [30, 300],
  upperArmCm: [10, 100],
  thighCm: [20, 150],
};
const measurementKeys = ["measurementId", "clientId", "measuredAt", ...Object.keys(metricRanges)];
const rootKeys = ["existingClients", "bindings", "measurements"];
const idPatterns = {
  bindingId: /^BND-[A-Za-z0-9_-]+$/,
  telegramUserId: /^\d{5,20}$/,
  clientId: /^CL-[A-Za-z0-9_-]+$/,
  measurementId: /^MSR-[A-Za-z0-9_-]+$/,
};

function exactKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key));
}

function utcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() ===
    (value.includes(".") ? value : value.replace("Z", ".000Z"));
}

function addError(errors, code, area, row, field) {
  errors.push({ code, area, row, field });
}

function checkUnique(errors, seen, value, code, area, row, field) {
  if (seen.has(value)) addError(errors, code, area, row, field);
  else seen.add(value);
}

export function preflightClientPortalMigration(input) {
  const errors = [];
  if (!exactKeys(input, rootKeys)) {
    addError(errors, "invalid_root_shape", "input", 0, "root");
  }

  const existingClients = Array.isArray(input?.existingClients) ? input.existingClients : [];
  const bindings = Array.isArray(input?.bindings) ? input.bindings : [];
  const measurements = Array.isArray(input?.measurements) ? input.measurements : [];
  if (!Array.isArray(input?.existingClients)) addError(errors, "array_required", "existingClients", 0, "existingClients");
  if (!Array.isArray(input?.bindings)) addError(errors, "array_required", "bindings", 0, "bindings");
  if (!Array.isArray(input?.measurements)) addError(errors, "array_required", "measurements", 0, "measurements");

  const clientIds = new Set();
  existingClients.forEach((client, index) => {
    const row = index + 1;
    if (!exactKeys(client, existingClientKeys)) {
      addError(errors, "unexpected_field", "existingClients", row, "row");
      return;
    }
    if (!idPatterns.clientId.test(client.clientId ?? "")) {
      addError(errors, "invalid_client_id", "existingClients", row, "clientId");
      return;
    }
    checkUnique(errors, clientIds, client.clientId, "duplicate_client_record", "existingClients", row, "clientId");
  });

  const bindingIds = new Set();
  const telegramIds = new Set();
  const boundClientIds = new Set();
  bindings.forEach((binding, index) => {
    const row = index + 2;
    if (!exactKeys(binding, bindingKeys)) {
      addError(errors, "unexpected_field", "bindings", row, "row");
      return;
    }
    for (const field of ["bindingId", "telegramUserId", "clientId"]) {
      if (!idPatterns[field].test(binding[field] ?? "")) {
        addError(errors, `invalid_${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`, "bindings", row, field);
      }
    }
    if (!clientIds.has(binding.clientId)) addError(errors, "client_not_found", "bindings", row, "clientId");
    if (!new Set(["active", "disabled"]).has(binding.status)) addError(errors, "invalid_status", "bindings", row, "status");
    if (!utcTimestamp(binding.createdAt)) addError(errors, "invalid_timestamp", "bindings", row, "createdAt");
    if (!utcTimestamp(binding.updatedAt)) addError(errors, "invalid_timestamp", "bindings", row, "updatedAt");
    if (utcTimestamp(binding.createdAt) && utcTimestamp(binding.updatedAt) &&
        new Date(binding.updatedAt) < new Date(binding.createdAt)) {
      addError(errors, "timestamp_order", "bindings", row, "updatedAt");
    }
    checkUnique(errors, bindingIds, binding.bindingId, "duplicate_binding_id", "bindings", row, "bindingId");
    checkUnique(errors, telegramIds, binding.telegramUserId, "duplicate_telegram_user_id", "bindings", row, "telegramUserId");
    checkUnique(errors, boundClientIds, binding.clientId, "duplicate_bound_client_id", "bindings", row, "clientId");
  });

  const measurementIds = new Set();
  const clientDates = new Set();
  measurements.forEach((measurement, index) => {
    const row = index + 2;
    if (!exactKeys(measurement, measurementKeys)) {
      addError(errors, "unexpected_field", "measurements", row, "row");
      return;
    }
    if (!idPatterns.measurementId.test(measurement.measurementId ?? "")) {
      addError(errors, "invalid_measurement_id", "measurements", row, "measurementId");
    }
    if (!idPatterns.clientId.test(measurement.clientId ?? "")) {
      addError(errors, "invalid_client_id", "measurements", row, "clientId");
    } else if (!clientIds.has(measurement.clientId)) {
      addError(errors, "client_not_found", "measurements", row, "clientId");
    }
    if (!utcTimestamp(measurement.measuredAt)) {
      addError(errors, "invalid_timestamp", "measurements", row, "measuredAt");
    }
    checkUnique(errors, measurementIds, measurement.measurementId,
      "duplicate_measurement_id", "measurements", row, "measurementId");
    checkUnique(errors, clientDates, `${measurement.clientId}\u0000${measurement.measuredAt}`,
      "duplicate_client_measurement_time", "measurements", row, "measuredAt");

    let metricCount = 0;
    for (const [field, [minimum, maximum]] of Object.entries(metricRanges)) {
      const value = measurement[field];
      if (value === undefined || value === null) continue;
      metricCount += 1;
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
        addError(errors, "metric_out_of_range", "measurements", row, field);
      }
    }
    if (!metricCount) addError(errors, "measurement_empty", "measurements", row, "metrics");
  });

  const activeBindings = bindings.filter((binding) => binding?.status === "active").length;
  return {
    valid: errors.length === 0,
    errors,
    summary: {
      existingClients: existingClients.length,
      bindings: bindings.length,
      activeBindings,
      measurements: measurements.length,
    },
    plannedWrites: {
      createSheets: ["Доступ клиентов", "Замеры"],
      headerRows: 2,
      bindingRows: bindings.length,
      measurementRows: measurements.length,
      perChatMenuButtons: activeBindings,
    },
  };
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3) {
    process.stderr.write("Usage: node preflight.mjs <migration-input.json>\n");
    process.exitCode = 2;
    return;
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch {
    process.stderr.write("Migration input could not be read as JSON.\n");
    process.exitCode = 2;
    return;
  }
  const report = preflightClientPortalMigration(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
