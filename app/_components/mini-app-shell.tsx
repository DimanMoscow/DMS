"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

type TelegramUser = { first_name?: string };
type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: { user?: TelegramUser };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

declare global {
  interface Window { Telegram?: { WebApp?: TelegramWebApp } }
}

type View = "home" | "today" | "clients" | "report" | "more";
type Health = { ok: boolean; release: string; dataMode: "connected" | "not-configured" };
type ClientSummary = {
  id: string; name: string; status: string; blockId: string; format: string;
  completed: number; remaining: number; blockPrice: number; paid: number; debt: number;
  singlePrice: number;
};
type WaitingTraining = {
  queueId: string; time: string; endTime: string; client: string; blockId: string;
  matching: string; decision: string; status: string;
};
type Bootstrap = {
  generatedAt: string;
  today: { title: string; waiting: WaitingTraining[] };
  summary: {
    activeClients: number; openBlocks: number; lowBlocks: number; debtClients: number;
    queueWaiting: number; queueErrors: number; exhaustedOpenBlocks: number;
  };
  clients: ClientSummary[];
  report: { month: string; metrics: Record<string, string> };
};
type ClientDetail = ClientSummary & {
  conditions: string; blockStatus: string; blockTotal: number; blockStart: string;
  trainingDates: string[]; undatedTrainings: number; undatedCharged: number;
  upcoming: { label: string }[]; upcomingMore: number;
};
type SystemHealth = {
  ok: boolean; checkedAt: string; durationMs: number; passed: number; total: number;
  failures: { name: string; details: string }[]; queueWaiting: number; queueErrors: number;
  exhaustedOpenBlocks: number; triggerCount: number;
};
type ApiResponse<T> = { ok: boolean; error?: string; data?: T };

const reportLabels: Record<string, string> = {
  trainings: "Проведено тренировок",
  earned: "Заработано работой",
  received: "Получено денег",
  expenses: "Рабочие расходы",
  cashResult: "Денежный результат",
  receivables: "Дебиторская задолженность",
};

async function requestDms<T>(initData: string, action: string, payload = {}): Promise<T> {
  const response = await fetch("/api/dms", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData, action, payload }),
  });
  const result = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !result.ok || !result.data) throw new Error(result.error || "request_failed");
  return result.data;
}

function readableError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    access_denied: "У этого Telegram-аккаунта нет доступа.",
    expired_init_data: "Сессия устарела. Закройте Mini App и откройте заново.",
    invalid_signature: "Telegram-авторизация не прошла проверку.",
    backend_unavailable: "Сервер учёта временно не отвечает.",
    invalid_upstream_response: "Apps Script ещё не обновлён до версии Mini App API.",
  };
  return messages[code] || "Не удалось загрузить данные. Повторите попытку.";
}

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", maximumFractionDigits: 0,
  }).format(value || 0);
}

export function MiniAppShell() {
  const [serviceHealth, setServiceHealth] = useState<Health | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>("home");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [clientQuery, setClientQuery] = useState("");
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const hydrated = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const telegram = hydrated ? (window.Telegram?.WebApp ?? null) : null;
  const initData = telegram?.initData ?? "";

  const loadBootstrap = useCallback((auth: string, showLoader = true) => {
    if (!auth) return;
    if (showLoader) setLoading(true);
    requestDms<Bootstrap>(auth, "bootstrap")
      .then((next) => { setData(next); setError(""); })
      .catch((reason) => setError(readableError(reason)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const app = window.Telegram?.WebApp;
    if (app) {
      app.ready();
      app.expand();
      app.setHeaderColor?.("#0b0d10");
      app.setBackgroundColor?.("#0b0d10");
    }
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json() as Promise<Health>)
      .then(setServiceHealth)
      .catch(() => setServiceHealth(null));
  }, []);

  useEffect(() => {
    if (!initData) return;
    requestDms<Bootstrap>(initData, "bootstrap")
      .then((next) => { setData(next); setError(""); })
      .catch((reason) => setError(readableError(reason)))
      .finally(() => setLoading(false));
  }, [initData]);

  const clients = useMemo(() => {
    const query = clientQuery.trim().toLocaleLowerCase("ru");
    if (!query) return data?.clients ?? [];
    return (data?.clients ?? []).filter((client) =>
      client.name.toLocaleLowerCase("ru").includes(query)
    );
  }, [clientQuery, data?.clients]);

  const openClient = (clientId: string) => {
    if (!initData) return;
    setClientLoading(true);
    setClientDetail(null);
    requestDms<ClientDetail>(initData, "client", { clientId })
      .then(setClientDetail)
      .catch((reason) => setError(readableError(reason)))
      .finally(() => setClientLoading(false));
  };

  const loadSystemHealth = () => {
    if (!initData) return;
    setSystemHealth(null);
    requestDms<SystemHealth>(initData, "health")
      .then(setSystemHealth)
      .catch((reason) => setError(readableError(reason)));
  };

  const navigate = (next: View) => {
    setView(next);
    setClientDetail(null);
    if (next === "more" && !systemHealth) loadSystemHealth();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const firstName = telegram?.initDataUnsafe?.user?.first_name;
  const connected = Boolean(data && !error);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-mark" type="button" onClick={() => navigate("home")}>DMS</button>
        <button className="status-pill" type="button" onClick={() => navigate("more")}>
          <span className={connected ? "dot dot-ok" : "dot"} />
          {connected ? "На связи" : "Система"}
        </button>
      </header>

      {view === "home" && (
        <>
          <section className="hero">
            <p className="eyebrow">РАБОЧИЙ КАБИНЕТ</p>
            <h1>{firstName ? `${firstName}, всё под контролем` : "DMS Fitness"}</h1>
            <p className="hero-copy">Клиенты, расписание и учёт — в одном интерфейсе.</p>
          </section>
          <ConnectionState telegramFound={Boolean(telegram)} loading={loading} error={error}
            connected={connected} onRetry={() => loadBootstrap(initData)} />
          {data && <HomeView data={data} onNavigate={navigate} />}
        </>
      )}

      {view === "today" && data && <TodayView data={data} />}
      {view === "clients" && data && (
        clientDetail || clientLoading
          ? <ClientCard detail={clientDetail} loading={clientLoading} onBack={() => setClientDetail(null)} />
          : <ClientsView clients={clients} query={clientQuery} onQuery={setClientQuery} onOpen={openClient} />
      )}
      {view === "report" && data && <ReportView report={data.report} />}
      {view === "more" && <SystemView service={serviceHealth} health={systemHealth}
        onRefresh={() => { loadSystemHealth(); loadBootstrap(initData, false); }} />}

      <nav className="bottom-nav" aria-label="Навигация">
        <NavButton label="Главная" icon="⌂" active={view === "home"} onClick={() => navigate("home")} />
        <NavButton label="Сегодня" icon="◷" active={view === "today"} disabled={!data} onClick={() => navigate("today")} />
        <NavButton label="Клиенты" icon="◉" active={view === "clients"} disabled={!data} onClick={() => navigate("clients")} />
        <NavButton label="Отчёт" icon="▥" active={view === "report"} disabled={!data} onClick={() => navigate("report")} />
      </nav>
    </main>
  );
}

function ConnectionState(props: {
  telegramFound: boolean; loading: boolean; error: string; connected: boolean; onRetry: () => void;
}) {
  if (!props.telegramFound) return <aside className="state-card">Откройте приложение кнопкой внутри Telegram-бота.</aside>;
  if (props.loading) return <aside className="state-card"><span className="spinner" />Загружаю актуальные данные…</aside>;
  if (props.error) return <aside className="state-card state-error"><span>{props.error}</span><button type="button" onClick={props.onRetry}>Повторить</button></aside>;
  if (props.connected) return <div className="connection-row"><span className="connection-icon">✓</span>Данные загружены без изменений в учёте</div>;
  return null;
}

function HomeView({ data, onNavigate }: { data: Bootstrap; onNavigate: (view: View) => void }) {
  const cards = [
    { label: "Клиентов", value: data.summary.activeClients, tone: "" },
    { label: "Ожидает сегодня", value: data.today.waiting.length, tone: "" },
    { label: "Малый остаток", value: data.summary.lowBlocks, tone: data.summary.lowBlocks ? "warn" : "" },
    { label: "С долгом", value: data.summary.debtClients, tone: data.summary.debtClients ? "warn" : "" },
  ];
  return <>
    <section className="metric-grid">{cards.map((card) =>
      <div className={`metric-card ${card.tone}`} key={card.label}><strong>{card.value}</strong><span>{card.label}</span></div>
    )}</section>
    <section className="section-heading"><h2>Разделы</h2><span>только чтение</span></section>
    <section className="section-grid">
      <SectionButton icon="◷" title="Сегодня" text={`${data.today.waiting.length} ожидают подтверждения`} onClick={() => onNavigate("today")} />
      <SectionButton icon="◉" title="Клиенты" text={`${data.clients.length} активных карточек`} onClick={() => onNavigate("clients")} />
      <SectionButton icon="₽" title="Финансы" text={`Отчёт за ${data.report.month || "текущий месяц"}`} onClick={() => onNavigate("report")} />
      <SectionButton icon="⋯" title="Состояние системы" text={data.summary.queueErrors ? "Есть ошибки очереди" : "Ошибок очереди нет"} onClick={() => onNavigate("more")} />
    </section>
  </>;
}

function TodayView({ data }: { data: Bootstrap }) {
  return <Page title="Сегодня" subtitle={data.today.title}>
    {!data.today.waiting.length ? <Empty text="Ожидающих подтверждения событий нет." /> :
      <section className="list-stack">{data.today.waiting.map((item) =>
        <article className="training-row" key={item.queueId}>
          <time>{item.time || "—"}<small>{item.endTime ? `до ${item.endTime}` : ""}</small></time>
          <div><strong>{item.client}</strong><span>{item.blockId || "Разовая"} · {item.decision || "без решения"}</span></div>
          <span className="status-badge">{item.status}</span>
        </article>
      )}</section>}
    <p className="read-only-note">Подтверждение дня остаётся в Telegram-боте. Этот экран ничего не списывает.</p>
  </Page>;
}

function ClientsView(props: {
  clients: ClientSummary[]; query: string; onQuery: (value: string) => void; onOpen: (id: string) => void;
}) {
  return <Page title="Клиенты" subtitle={`${props.clients.length} в списке`}>
    <input className="search" value={props.query} onChange={(event) => props.onQuery(event.target.value)}
      placeholder="Поиск по имени" aria-label="Поиск клиента" />
    <section className="list-stack">{props.clients.map((client) =>
      <button className="client-row" type="button" key={client.id} onClick={() => props.onOpen(client.id)}>
        <span className="avatar">{client.name.slice(0, 1)}</span>
        <span className="client-main"><strong>{client.name}</strong><small>{client.blockId
          ? `${client.blockId} · ${client.format}`
          : client.singlePrice ? `Разовая · ${money(client.singlePrice)}` : "Без активного блока"}</small></span>
        <span className={client.remaining <= 2 && client.blockId ? "balance balance-low" : "balance"}>
          {client.blockId ? client.remaining : "—"}<small>{client.blockId ? "ост." : ""}</small>
        </span>
      </button>
    )}</section>
  </Page>;
}

function ClientCard({ detail, loading, onBack }: {
  detail: ClientDetail | null; loading: boolean; onBack: () => void;
}) {
  if (loading || !detail) return <Page title="Карточка клиента" subtitle=""><div className="state-card"><span className="spinner" />Загружаю карточку…</div></Page>;
  return <Page title={detail.name} subtitle={detail.id} back={onBack}>
    <section className="metric-grid metric-grid-three">
      <div className="metric-card"><strong>{detail.completed}</strong><span>проведено</span></div>
      <div className="metric-card"><strong>{detail.blockId ? detail.remaining : "—"}</strong><span>осталось</span></div>
      <div className="metric-card"><strong>{detail.debt ? money(detail.debt) : "0 ₽"}</strong><span>долг</span></div>
    </section>
    <section className="detail-card">
      <Detail label="Формат" value={detail.blockId ? `${detail.blockId} · ${detail.format}` : "Разовые тренировки"} />
      <Detail label="Статус блока" value={detail.blockStatus || "—"} />
      <Detail label="Стоимость" value={detail.blockId ? money(detail.blockPrice) : money(detail.singlePrice)} />
      <Detail label="Оплачено" value={money(detail.paid)} />
    </section>
    <section className="content-section"><h2>Ближайшие записи</h2>{detail.upcoming.length
      ? detail.upcoming.map((item) => <p className="timeline-item" key={item.label}>{item.label}</p>)
      : <Empty text="Записей на ближайшие 45 дней нет." />}</section>
    <section className="content-section"><h2>История блока</h2>{detail.trainingDates.length
      ? <p className="history-text">{detail.trainingDates.join(" · ")}</p>
      : <Empty text="Дат пока нет." />}</section>
    {detail.conditions && <section className="content-section"><h2>Условия и заметки</h2><p className="history-text">{detail.conditions}</p></section>}
  </Page>;
}

function ReportView({ report }: { report: Bootstrap["report"] }) {
  return <Page title="Отчёт" subtitle={report.month}>
    <section className="report-stack">{Object.keys(reportLabels).map((key) =>
      <article className="report-row" key={key}><span>{reportLabels[key]}</span><strong>{report.metrics[key] || "—"}</strong></article>
    )}</section>
    <p className="read-only-note">Значения читаются из рабочего листа «Отчёт» без пересчёта и записи.</p>
  </Page>;
}

function SystemView({ service, health, onRefresh }: {
  service: Health | null; health: SystemHealth | null; onRefresh: () => void;
}) {
  return <Page title="Состояние системы" subtitle="Диагностика">
    <section className="system-hero">
      <span className={health?.ok ? "system-indicator ok" : "system-indicator"}>{health?.ok ? "✓" : "…"}</span>
      <div><strong>{health?.ok ? "Все проверки пройдены" : "Проверяю систему"}</strong><p>{health
        ? `${health.passed} из ${health.total} · ${health.durationMs} мс`
        : "Без изменения данных"}</p></div>
    </section>
    <section className="detail-card">
      <Detail label="Mini App" value={service?.release || "—"} />
      <Detail label="Очередь" value={health ? `${health.queueWaiting} ожидает · ${health.queueErrors} ошибок` : "—"} />
      <Detail label="Исчерпанные блоки" value={health ? String(health.exhaustedOpenBlocks) : "—"} />
      <Detail label="Триггеры" value={health ? String(health.triggerCount) : "—"} />
    </section>
    {health?.failures.map((failure) => <aside className="state-card state-error" key={failure.name}>
      <strong>{failure.name}</strong><span>{failure.details}</span>
    </aside>)}
    <button className="primary-button" type="button" onClick={onRefresh}>Обновить диагностику</button>
  </Page>;
}

function Page({ title, subtitle, back, children }: {
  title: string; subtitle: string; back?: () => void; children: React.ReactNode;
}) {
  return <section className="page"><header className="page-title">{back && <button type="button" onClick={back}>‹</button>}<div><h1>{title}</h1><p>{subtitle}</p></div></header>{children}</section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }

function SectionButton({ icon, title, text, onClick }: {
  icon: string; title: string; text: string; onClick: () => void;
}) {
  return <button className="section-card" type="button" onClick={onClick}><span className="section-icon">{icon}</span><span className="section-content"><strong>{title}</strong><small>{text}</small></span><span className="chevron">›</span></button>;
}

function NavButton({ label, icon, active, disabled, onClick }: {
  label: string; icon: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <button className={`nav-item ${active ? "nav-active" : ""}`} type="button" disabled={disabled} onClick={onClick}><span>{icon}</span>{label}</button>;
}
