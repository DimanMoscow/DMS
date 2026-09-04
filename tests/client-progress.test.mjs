import assert from "node:assert/strict";
import test from "node:test";

import { formatMeasurementDelta, measurementDeltas } from "../lib/client-progress.ts";

test("client progress calculates neutral one-decimal changes from the previous measurement", () => {
  const current = {
    measuredAt: "2026-09-03T09:00:00.000Z",
    metrics: { weightKg: 78.2, waistCm: 84, hipsCm: 98 },
  };
  const previous = {
    measuredAt: "2026-08-27T09:00:00.000Z",
    metrics: { weightKg: 78.5, waistCm: 84, chestCm: 101 },
  };

  assert.deepEqual(measurementDeltas(current, previous), { weightKg: -0.3, waistCm: 0 });
  assert.equal(formatMeasurementDelta(-0.3, "кг"), "−0,3 кг");
  assert.equal(formatMeasurementDelta(0, "см"), "без изменений");
});

test("client progress omits changes without a comparable previous value", () => {
  const measurement = { measuredAt: "2026-09-03T09:00:00.000Z", metrics: { weightKg: 78.2 } };
  assert.deepEqual(measurementDeltas(measurement), {});
  assert.deepEqual(measurementDeltas(measurement, {
    measuredAt: "2026-08-27T09:00:00.000Z", metrics: { waistCm: 84 },
  }), {});
});
