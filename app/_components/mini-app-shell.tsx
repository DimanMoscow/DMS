"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

type TelegramUser = {
  first_name?: string;
};

type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: { user?: TelegramUser };
  colorScheme?: "light" | "dark";
  platform?: string;
  version?: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type Health = {
  ok: boolean;
  release: string;
  dataMode: "connected" | "not-configured";
};

const sections = [
  { icon: "◷", title: "Сегодня", text: "Расписание и подтверждение дня" },
  { icon: "◉", title: "Клиенты", text: "Карточки, блоки и будущие записи" },
  { icon: "◇", title: "Остатки", text: "Тренировки и зона внимания" },
  { icon: "₽", title: "Финансы", text: "Оплаты, долги и отчётность" },
] as const;

export function MiniAppShell() {
  const [health, setHealth] = useState<Health | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const telegram = hydrated ? (window.Telegram?.WebApp ?? null) : null;

  useEffect(() => {
    const app = window.Telegram?.WebApp ?? null;
    if (app) {
      app.ready();
      app.expand();
      app.setHeaderColor?.("#0b0d10");
      app.setBackgroundColor?.("#0b0d10");
    }

    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const firstName = telegram?.initDataUnsafe?.user?.first_name;
  const connectionLabel = useMemo(() => {
    if (!telegram) return "Откройте из Telegram";
    if (!telegram.initData) return "Telegram без авторизации";
    if (health?.dataMode !== "connected") return "Интерфейс готов, данные не подключены";
    return "Подключено";
  }, [health?.dataMode, telegram]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-label="DMS Fitness">DMS</div>
        <button
          className="status-pill"
          type="button"
          onClick={() => setDiagnosticsOpen((value) => !value)}
          aria-expanded={diagnosticsOpen}
        >
          <span className={health?.dataMode === "connected" ? "dot dot-ok" : "dot"} />
          Система
        </button>
      </header>

      <section className="hero">
        <p className="eyebrow">РАБОЧИЙ КАБИНЕТ</p>
        <h1>{firstName ? `${firstName}, всё под контролем` : "DMS Fitness"}</h1>
        <p className="hero-copy">Клиенты, расписание и учёт — в одном интерфейсе.</p>
        <div className="connection-row">
          <span className="connection-icon">↗</span>
          <span>{connectionLabel}</span>
        </div>
      </section>

      {diagnosticsOpen && (
        <section className="diagnostics" aria-label="Диагностика подключения">
          <div><span>Версия</span><strong>{health?.release ?? "—"}</strong></div>
          <div><span>Telegram WebApp</span><strong>{telegram ? "найден" : "не найден"}</strong></div>
          <div><span>Авторизация</span><strong>{telegram?.initData ? "получена" : "нет"}</strong></div>
          <div><span>API учёта</span><strong>{health?.dataMode === "connected" ? "настроен" : "следующий этап"}</strong></div>
        </section>
      )}

      <section className="section-heading">
        <h2>Разделы</h2>
        <span>read-only этап</span>
      </section>

      <section className="section-grid" aria-label="Разделы приложения">
        {sections.map((section) => (
          <button className="section-card" type="button" key={section.title} disabled>
            <span className="section-icon">{section.icon}</span>
            <span className="section-content">
              <strong>{section.title}</strong>
              <small>{section.text}</small>
            </span>
            <span className="chevron">›</span>
          </button>
        ))}
      </section>

      <aside className="notice">
        <span>01</span>
        <div>
          <strong>Безопасный старт</strong>
          <p>Сначала подключаем чтение. Оплаты, остатки и календарь пока не изменяются.</p>
        </div>
      </aside>

      <footer className="bottom-nav" aria-label="Навигация">
        <button className="nav-item nav-active" type="button"><span>⌂</span>Главная</button>
        <button className="nav-item" type="button" disabled><span>◉</span>Клиенты</button>
        <button className="nav-item" type="button" disabled><span>▥</span>Отчёт</button>
        <button className="nav-item" type="button" onClick={() => setDiagnosticsOpen(true)}><span>···</span>Ещё</button>
      </footer>
    </main>
  );
}
