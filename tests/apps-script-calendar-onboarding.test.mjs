import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const candidate = "apps-script/candidates/v48";

async function loadCalendarContext() {
  const [calendarSource, adminSource] = await Promise.all([
    readFile(`${candidate}/CalendarSync.gs`, "utf8"),
    readFile(`${candidate}/ZZZZZZZZZZMiniAppAdmin.gs`, "utf8"),
  ]);
  const context = vm.createContext({
    console,
    Date,
    Math,
    Object,
    String,
    Number,
    isFinite,
  });
  new vm.Script(calendarSource, { filename: "CalendarSync.gs" }).runInContext(context);
  new vm.Script(adminSource, { filename: "ZZZZZZZZZZMiniAppAdmin.gs" }).runInContext(context);
  return context;
}

test("unknown Calendar title becomes registration state instead of system error", async () => {
  const context = await loadCalendarContext();
  const start = new Date("2026-09-04T16:00:00Z");
  const end = new Date("2026-09-04T17:00:00Z");
  const row = context.buildQueueRow_(
    "Q-0085",
    "calendar",
    { id: "event", summary: "Новый клиент ПТ" },
    { start, end },
    null,
  );

  assert.equal(row[11], "Требует регистрации");
  assert.equal(row[12], "");
  assert.equal(row[13], "Требует регистрации");
  assert.equal(row[8], "");
  assert.equal(row[9], "");
});

test("calendar sync migrates legacy unknown error and later resolves recognized client", async () => {
  const context = await loadCalendarContext();
  const start = new Date("2026-09-04T16:00:00Z");
  const current = new Array(17).fill("");
  current[0] = "Q-0085";
  current[5] = start;
  current[6] = new Date("2026-09-04T17:00:00Z");
  current[11] = "Не распознано";
  current[13] = "Ошибка";

  const unknown = context.buildQueueRow_(
    "Q-0085",
    "calendar",
    { id: "event", summary: "Новый клиент ПТ" },
    { start, end: current[6] },
    null,
  );
  const migrated = context.makeUpdatedQueueEventValues_(current, unknown);
  assert.equal(migrated[11], "Требует регистрации");
  assert.equal(migrated[13], "Требует регистрации");

  const recognized = context.buildQueueRow_(
    "Q-0085",
    "calendar",
    { id: "event", summary: "Новый клиент ПТ" },
    { start, end: current[6] },
    { id: "CL-X", name: "Клиент", blockId: "", singlePrice: 3500 },
  );
  const resolved = context.makeUpdatedQueueEventValues_(migrated, recognized);
  assert.equal(resolved[11], "Распознано");
  assert.equal(resolved[13], "Ожидает");
  assert.equal(resolved[12], "Проведена");
});

test("new-client preview uses approved one-off and block standards", async () => {
  const context = await loadCalendarContext();
  const single = context.normalizeDmsCalendarOnboardingProduct_("single", {});
  const block10 = context.normalizeDmsCalendarOnboardingProduct_("block10", {});

  assert.deepEqual(
    JSON.parse(JSON.stringify(single)),
    {
      code: "single",
      format: "Разовая",
      count: 0,
      price: 3500,
      support: 0,
      standardPrice: 3500,
      usesStandardPrice: true,
    },
  );
  assert.equal(block10.format, "Блок 10");
  assert.equal(block10.count, 10);
  assert.equal(block10.price, 30000);
  assert.equal(block10.usesStandardPrice, true);
});

test("non-standard products fail closed until explicit conditions are supplied", async () => {
  const context = await loadCalendarContext();
  context.throwDmsMiniAppError_ = (code, status) => {
    const error = new Error(code);
    error.dmsCode = code;
    error.dmsStatus = status;
    throw error;
  };
  context.validateTelegramPositiveInteger_ = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error("count");
    return parsed;
  };

  assert.throws(
    () => context.normalizeDmsCalendarOnboardingProduct_("hybrid", {}),
    /count/,
  );
  const hybrid = context.normalizeDmsCalendarOnboardingProduct_("hybrid", {
    count: 5,
    price: 16000,
    support: 4000,
  });
  assert.equal(hybrid.format, "Гибрид");
  assert.equal(hybrid.count, 5);
  assert.equal(hybrid.support, 4000);
});

test("repeated new-client resolution is idempotent after the queue item is linked", async () => {
  const context = await loadCalendarContext();
  const values = new Array(17).fill("");
  values[8] = "CL-X";
  values[9] = "Новый клиент";
  values[11] = "Распознано";
  context.LockService = {
    getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => undefined }),
  };
  context.SpreadsheetApp = { getActive: () => ({}) };
  context.getDmsCalendarOnboardingQueueItem_ = () => ({
    queueId: "Q-TEST",
    values,
  });
  context.buildDmsCalendarOnboardingPreview_ = () => {
    throw new Error("preview must not rerun after a completed matching resolution");
  };

  const result = context.resolveDmsCalendarOnboarding_(
    { queueId: "Q-TEST", mode: "new", name: "Новый клиент" },
    "actor",
  );
  assert.equal(result.changed, false);
  assert.equal(result.clientId, "CL-X");
});

test("resolution is locked, event-specific, audited and journal-independent", async () => {
  const [adminSource, apiSource, calendarSource, routeSource, shellSource, runtimeSource] = await Promise.all([
    readFile(`${candidate}/ZZZZZZZZZZMiniAppAdmin.gs`, "utf8"),
    readFile(`${candidate}/ZZZZZZZZMiniAppApi.gs`, "utf8"),
    readFile(`${candidate}/CalendarSync.gs`, "utf8"),
    readFile("app/api/dms/route.ts", "utf8"),
    readFile("app/_components/mini-app-shell.tsx", "utf8"),
    readFile(`${candidate}/ZZZZZZZRuntime.gs`, "utf8"),
  ]);

  assert.match(adminSource, /LockService\.getDocumentLock/);
  assert.match(adminSource, /assertDmsCalendarOnboardingNoJournal_/);
  assert.match(adminSource, /calendar_alias_conflict/);
  assert.match(adminSource, /Игнорируется только это событие/);
  assert.match(adminSource, /calendar_ignore_event/);
  assert.match(adminSource, /createsJournal: false/);
  assert.match(adminSource, /captureDmsCalendarOnboardingRange_/);
  assert.match(adminSource, /restoreDmsCalendarOnboardingRange_/);
  assert.match(adminSource, /requestedName === resolvedName/);
  assert.doesNotMatch(adminSource, /fuzzy/i);
  assert.doesNotMatch(apiSource, /Mini App API:.*error\.message/);
  assert.match(apiSource, /event: 'mini_app_api_failure'/);
  assert.match(calendarSource, /function previewDmsCalendarQueueSync/);
  assert.doesNotMatch(calendarSource, /calendarTitle:\s*String\(write/);
  assert.match(routeSource, /"preview_calendar_onboarding"/);
  assert.match(routeSource, /"resolve_calendar_onboarding"/);
  assert.match(shellSource, /Показать preview/);
  assert.match(shellSource, /Новый клиент/);
  assert.match(shellSource, /Связать/);
  assert.match(shellSource, /Игнорировать/);
  assert.match(shellSource, /onCancel/);
  assert.match(runtimeSource, /debt-formula-integrity/);
  assert.match(runtimeSource, /extraFormulaRows/);
});
