export type ClientProgressMetricKey =
  | "weightKg"
  | "chestCm"
  | "waistCm"
  | "hipsCm"
  | "upperArmCm"
  | "thighCm";

export type ClientProgressMetrics = Partial<Record<ClientProgressMetricKey, number>>;

export type ClientProgressMeasurement = {
  measuredAt: string;
  metrics: ClientProgressMetrics;
};

const metricKeys: ClientProgressMetricKey[] = [
  "weightKg", "chestCm", "waistCm", "hipsCm", "upperArmCm", "thighCm",
];

export function measurementDeltas(
  current: ClientProgressMeasurement,
  previous?: ClientProgressMeasurement,
): ClientProgressMetrics {
  if (!previous) return {};
  const deltas: ClientProgressMetrics = {};
  for (const key of metricKeys) {
    const currentValue = current.metrics[key];
    const previousValue = previous.metrics[key];
    if (typeof currentValue !== "number" || typeof previousValue !== "number") continue;
    deltas[key] = Math.round((currentValue - previousValue) * 10) / 10;
  }
  return deltas;
}

export function formatMeasurementDelta(value: number, unit: string) {
  const formatted = Math.abs(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  if (value === 0) return "без изменений";
  return `${value > 0 ? "+" : "−"}${formatted} ${unit}`;
}
