"use client";

import { useEffect, useState } from "react";
import { formatMeasurementDelta, measurementDeltas } from "@/lib/client-progress";
import { getSignedStartParam } from "@/lib/telegram-init-data";
import styles from "./client-portal.module.css";

type TelegramWebApp = {
  initData?: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

type ClientProfile = {
  name: string;
  trainingFormat: string;
};

type MeasurementMetrics = Partial<Record<MetricKey, number>>;
type MetricKey = "weightKg" | "chestCm" | "waistCm" | "hipsCm" | "upperArmCm" | "thighCm";
type Measurement = {
  measuredAt: string;
  metrics: MeasurementMetrics;
};
type ClientPortalData = {
  generatedAt: string;
  profile: ClientProfile;
  latestMeasurement: Measurement | null;
  measurements: Measurement[];
};
type ApiResponse = { ok: boolean; error?: string; data?: ClientPortalData };
type EnrollmentResponse = { ok: boolean; error?: string; data?: { enrolled: boolean } };
type ViewState =
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "not-linked" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ClientPortalData };

const metrics: { key: MetricKey; label: string; unit: string }[] = [
  { key: "weightKg", label: "Вес", unit: "кг" },
  { key: "chestCm", label: "Грудь", unit: "см" },
  { key: "waistCm", label: "Талия", unit: "см" },
  { key: "hipsCm", label: "Бёдра", unit: "см" },
  { key: "upperArmCm", label: "Плечо", unit: "см" },
  { key: "thighCm", label: "Бедро", unit: "см" },
];

function telegramWebApp() {
  const target = window as Window & { Telegram?: { WebApp?: TelegramWebApp } };
  return target.Telegram?.WebApp ?? null;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function metricEntries(measurement: Measurement) {
  return metrics.flatMap((metric) => {
    const value = measurement.metrics[metric.key];
    return typeof value === "number" ? [{ ...metric, value }] : [];
  });
}

function errorMessage(code: string) {
  const messages: Record<string, string> = {
    expired_init_data: "Сессия Telegram устарела. Закройте кабинет и откройте его заново.",
    invalid_init_data: "Не удалось получить данные авторизации Telegram.",
    invalid_signature: "Telegram-авторизация не прошла проверку.",
    client_link_invalid: "Привязка профиля требует проверки тренером.",
    client_record_invalid: "Профиль клиента требует проверки тренером.",
    client_data_invalid: "В истории замеров обнаружена некорректная запись.",
    client_portal_not_configured: "Клиентский кабинет пока не подключён к учёту.",
    client_portal_schema_invalid: "Структура клиентского кабинета требует проверки.",
    backend_not_configured: "Сервер кабинета пока не настроен.",
    backend_unavailable: "Сервер временно не отвечает. Попробуйте открыть кабинет позже.",
    request_timeout: "Сервер отвечает слишком долго. Попробуйте открыть кабинет позже.",
    enrollment_invite_invalid: "Приглашение недействительно или уже использовано. Запросите новое у тренера.",
    enrollment_invite_expired: "Срок действия приглашения истёк. Запросите новое у тренера.",
    client_link_conflict: "Этот Telegram-аккаунт или профиль уже привязан. Обратитесь к тренеру.",
  };
  return messages[code] ?? "Не удалось загрузить кабинет. Попробуйте открыть его позже.";
}

async function consumeEnrollment(initData: string) {
  const response = await fetch("/api/dms", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData, action: "client_portal_enroll" }),
    signal: AbortSignal.timeout(25_000),
  });
  const result = (await response.json()) as EnrollmentResponse;
  if (!response.ok || !result.ok || !result.data?.enrolled) {
    throw new Error(result.error || "request_failed");
  }
}

async function loadClientPortal(initData: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("/api/dms", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, action: "client_portal_bootstrap" }),
      signal: controller.signal,
    });
    const result = (await response.json()) as ApiResponse;
    if (response.status === 401) throw new Error(result.error || "invalid_init_data");
    if (result.error === "client_not_linked") return { kind: "not-linked" } as const;
    if (!response.ok || !result.ok || !result.data) throw new Error(result.error || "request_failed");
    return { kind: "ready", data: result.data } as const;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("request_timeout");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function ClientPortal() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const app = telegramWebApp();
    app?.ready();
    app?.expand();
    app?.setHeaderColor?.("#0b0d10");
    app?.setBackgroundColor?.("#0b0d10");
    const initData = app?.initData ?? "";
    if (!initData) {
      const timeout = window.setTimeout(() => setState({ kind: "unauthorized" }), 0);
      return () => window.clearTimeout(timeout);
    }
    const enrollment = getSignedStartParam(initData)
      ? consumeEnrollment(initData)
      : Promise.resolve();
    enrollment.then(() => loadClientPortal(initData))
      .then(setState)
      .catch((error) => {
        const code = error instanceof Error ? error.message : "request_failed";
        if (["invalid_init_data", "invalid_signature", "expired_init_data", "invalid_user"].includes(code)) {
          setState({ kind: "unauthorized" });
          return;
        }
        setState({ kind: "error", message: errorMessage(code) });
      });
  }, []);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.mark}>DMS</span>
        <span className={styles.portalLabel}>Личный кабинет</span>
      </header>

      {state.kind === "loading" && <StatusCard title="Загружаю профиль" text="Проверяю доступ и читаю актуальные замеры." busy />}
      {state.kind === "unauthorized" && <StatusCard title="Откройте кабинет в Telegram" text="Авторизация доступна только по кнопке внутри бота DMS Fitness." />}
      {state.kind === "not-linked" && <StatusCard title="Профиль ещё не привязан" text="Обратитесь к тренеру — автоматический поиск по имени или username не используется." />}
      {state.kind === "error" && <StatusCard title="Не удалось загрузить данные" text={state.message} />}
      {state.kind === "ready" && <PortalContent data={state.data} />}
    </main>
  );
}

function PortalContent({ data }: { data: ClientPortalData }) {
  const latestPrevious = data.measurements[1];
  return (
    <>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>ПРОФИЛЬ</p>
        <h1>{data.profile.name}</h1>
        <p>{data.profile.trainingFormat || "Персональные тренировки"}</p>
      </section>

      <section className={styles.section} aria-labelledby="latest-measurement">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>ДИНАМИКА</p>
            <h2 id="latest-measurement">Последний замер</h2>
          </div>
          {data.latestMeasurement && <time>{formatDate(data.latestMeasurement.measuredAt)}</time>}
        </div>
        {data.latestMeasurement
          ? <MetricGrid measurement={data.latestMeasurement} previous={latestPrevious} />
          : <div className={styles.empty}>Замеров пока нет. Первый результат появится здесь после внесения тренером.</div>}
      </section>

      {data.measurements.length > 0 && (
        <section className={styles.section} aria-labelledby="measurement-history">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>ИСТОРИЯ</p>
              <h2 id="measurement-history">Все замеры</h2>
            </div>
            <span>{data.measurements.length}</span>
          </div>
          <div className={styles.history}>
            {data.measurements.map((measurement, index) => (
              <details className={styles.measurement} key={`${measurement.measuredAt}-${index}`}>
                <summary>
                  <span>{formatDate(measurement.measuredAt)}</span>
                  <small>{metricEntries(measurement).length} показателей</small>
                </summary>
                <MetricGrid measurement={measurement} previous={data.measurements[index + 1]} compact />
              </details>
            ))}
          </div>
        </section>
      )}

      <footer className={styles.footer}>Данные доступны только для просмотра.</footer>
    </>
  );
}

function MetricGrid({ measurement, previous, compact = false }: {
  measurement: Measurement;
  previous?: Measurement;
  compact?: boolean;
}) {
  const deltas = measurementDeltas(measurement, previous);
  return (
    <dl className={compact ? `${styles.metrics} ${styles.metricsCompact}` : styles.metrics}>
      {metricEntries(measurement).map((metric) => (
        <div key={metric.key}>
          <dt>{metric.label}</dt>
          <dd>{metric.value.toLocaleString("ru-RU")} <small>{metric.unit}</small></dd>
          <MeasurementDelta value={deltas[metric.key]} unit={metric.unit} />
        </div>
      ))}
    </dl>
  );
}

function MeasurementDelta({ value, unit }: { value?: number; unit: string }) {
  if (typeof value !== "number") return null;
  return <span className={styles.delta}>{formatMeasurementDelta(value, unit)} с прошлого замера</span>;
}

function StatusCard({ title, text, busy = false }: { title: string; text: string; busy?: boolean }) {
  return (
    <section className={styles.status} role="status" aria-live="polite">
      {busy && <span className={styles.spinner} aria-hidden="true" />}
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}
