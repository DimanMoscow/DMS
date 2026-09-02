import assert from "node:assert/strict";
import test from "node:test";

import {
  moscowDateKey,
  sameMeasurementMetrics,
  validateMeasurementDraft,
} from "../lib/measurement-draft.ts";

const empty = () => ({
  weightKg: "", chestCm: "", waistCm: "", hipsCm: "", upperArmCm: "", thighCm: "",
});

test("measurement preview normalizes decimal comma and accepts allow-listed ranges", () => {
  const inputs = empty();
  inputs.weightKg = "78,5";
  inputs.waistCm = "91";
  assert.deepEqual(validateMeasurementDraft("2026-09-02", inputs, "2026-09-02"), {
    ok: true,
    metrics: { weightKg: 78.5, waistCm: 91 },
  });
});

test("measurement preview rejects future, impossible, over-precision and out-of-range values", () => {
  const inputs = empty();
  inputs.weightKg = "78.55";
  assert.equal(validateMeasurementDraft("2026-09-03", inputs, "2026-09-02").ok, false);
  assert.equal(validateMeasurementDraft("2026-02-30", inputs, "2026-09-02").ok, false);
  assert.equal(validateMeasurementDraft("2026-09-02", inputs, "2026-09-02").ok, false);
  inputs.weightKg = "401";
  assert.equal(validateMeasurementDraft("2026-09-02", inputs, "2026-09-02").ok, false);
});

test("measurement correction detects no-op metric sets", () => {
  assert.equal(sameMeasurementMetrics({ weightKg: 78.5 }, { weightKg: 78.5 }), true);
  assert.equal(sameMeasurementMetrics({ weightKg: 78.5 }, { weightKg: 78.6 }), false);
  assert.match(moscowDateKey(new Date("2026-09-02T21:30:00Z")), /^2026-09-03$/);
});
