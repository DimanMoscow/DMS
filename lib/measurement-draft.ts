export type MeasurementMetricKey =
  | "weightKg"
  | "chestCm"
  | "waistCm"
  | "hipsCm"
  | "upperArmCm"
  | "thighCm";

export const measurementFields: {
  key: MeasurementMetricKey;
  label: string;
  unit: string;
  min: number;
  max: number;
}[] = [
  { key: "weightKg", label: "Вес", unit: "кг", min: 20, max: 400 },
  { key: "chestCm", label: "Грудь", unit: "см", min: 30, max: 300 },
  { key: "waistCm", label: "Талия", unit: "см", min: 30, max: 300 },
  { key: "hipsCm", label: "Бёдра", unit: "см", min: 30, max: 300 },
  { key: "upperArmCm", label: "Плечо", unit: "см", min: 10, max: 100 },
  { key: "thighCm", label: "Бедро", unit: "см", min: 20, max: 150 },
];

export type MeasurementMetricInputs = Record<MeasurementMetricKey, string>;
export type MeasurementMetrics = Partial<Record<MeasurementMetricKey, number>>;

type DraftResult =
  | { ok: true; metrics: MeasurementMetrics }
  | { ok: false; error: string };

export function moscowDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function validateMeasurementDraft(
  measuredAt: string,
  inputs: MeasurementMetricInputs,
  today = moscowDateKey(),
): DraftResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredAt) || measuredAt > today) {
    return { ok: false, error: "Укажите корректную дату без будущего значения." };
  }
  const parsedDate = new Date(`${measuredAt}T12:00:00`);
  if (Number.isNaN(parsedDate.getTime()) || moscowDateKey(parsedDate) !== measuredAt) {
    return { ok: false, error: "Укажите корректную дату замера." };
  }

  const metrics: MeasurementMetrics = {};
  for (const field of measurementFields) {
    const raw = inputs[field.key].trim();
    if (!raw) continue;
    if (!/^\d+(?:[.,]\d)?$/.test(raw)) {
      return { ok: false, error: `${field.label}: допустима одна цифра после запятой.` };
    }
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < field.min || value > field.max) {
      return {
        ok: false,
        error: `${field.label}: значение должно быть от ${field.min} до ${field.max} ${field.unit}.`,
      };
    }
    metrics[field.key] = value;
  }
  if (!Object.keys(metrics).length) {
    return { ok: false, error: "Укажите хотя бы один показатель." };
  }
  return { ok: true, metrics };
}

export function sameMeasurementMetrics(left: MeasurementMetrics, right: MeasurementMetrics): boolean {
  return measurementFields.every((field) => left[field.key] === right[field.key]);
}
