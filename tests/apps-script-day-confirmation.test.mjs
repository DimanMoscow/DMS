import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const candidateDirectory = "apps-script/candidates/v40";
const version39Directory = "apps-script/versions/v39";

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function loadAdminHarness({ blocked }) {
  const source = await readFile(`${candidateDirectory}/ZZZZZZZZZZMiniAppAdmin.gs`, "utf8");
  const state = {
    queue: [["Q-0001", "waiting"]],
    journal: [],
    calendar: [{ id: "event-1", status: "confirmed" }],
    related: { blocks: ["B-0001"], settings: "unchanged" },
  };
  const calls = [];
  const projectedRows = [["Q-0001", new Date("2026-08-30T09:00:00Z")]];
  const context = vm.createContext({
    console,
    LockService: {
      getDocumentLock() {
        return {
          tryLock() {
            calls.push("lock");
            return true;
          },
          releaseLock() {
            calls.push("unlock");
          },
        };
      },
    },
    SpreadsheetApp: {
      getActive() {
        return { getSpreadsheetTimeZone: () => "Europe/Moscow" };
      },
    },
    makeDateKey_: () => "2026-08-30",
    parseTelegramDateKey_: () => new Date("2026-08-30T00:00:00Z"),
    buildCalendarQueueSyncPlan_() {
      calls.push("plan");
      return { queueRows: projectedRows };
    },
    applyCalendarQueueSyncPlan_() {
      calls.push("apply");
      state.queue.push(["Q-0002", "synced"]);
    },
    processQueueDate_(date, sourceName, dryRun, options) {
      assert.equal(sourceName, "MiniApp");
      assert.equal(options.lockHeld, true);
      if (dryRun) {
        calls.push("preflight");
        assert.equal(options.projectPlannedActivations, true);
        assert.equal(options.queueRows, projectedRows);
        return blocked
          ? { blocked: 1, blockers: ["Q-0001: Тренировка ещё не завершилась."] }
          : { blocked: 0, blockers: [] };
      }
      calls.push("process");
      state.journal.push(["TR-0001"]);
      state.queue[0][1] = "processed";
      return { blocked: 0, blockers: [], added: 1, skipped: 0, alreadyLogged: 0 };
    },
    applyTelegramCalendarCancellationsForDate_() {
      calls.push("cancel");
      state.calendar[0].status = "kept";
      return { deleted: 0, alreadyMissing: 0, failed: 0 };
    },
    getDmsMiniAppBootstrap_() {
      calls.push("bootstrap");
      return { ok: true };
    },
  });

  new vm.Script(source, { filename: "ZZZZZZZZZZMiniAppAdmin.gs" }).runInContext(context);
  return { calls, context, state };
}

test("v40 candidate is a complete v39-derived source set with only the safety files changed", async () => {
  const [candidateFiles, version39Files] = await Promise.all([
    readdir(candidateDirectory),
    readdir(version39Directory),
  ]);
  assert.deepEqual(candidateFiles.sort(), version39Files.sort());
  assert.equal(candidateFiles.length, 15);

  const changed = [];
  for (const fileName of candidateFiles) {
    const [candidate, version39] = await Promise.all([
      readFile(`${candidateDirectory}/${fileName}`),
      readFile(`${version39Directory}/${fileName}`),
    ]);
    if (!candidate.equals(version39)) changed.push(fileName);
  }

  assert.deepEqual(changed.sort(), [
    "CalendarSync.gs",
    "ZZZZZZZRuntime.gs",
    "ZZZZZZZZZZMiniAppAdmin.gs",
  ]);
});

test("calendar sync planning is read-only and projects new Calendar rows", async () => {
  const source = await readFile(`${candidateDirectory}/CalendarSync.gs`, "utf8");
  const writes = [];
  const state = {
    clients: [],
    queue: [],
    settings: [
      ["Календарь для учёта", "calendar-id"],
      ["Начало автоматического учёта", new Date("2026-08-01T00:00:00Z")],
      ["Часовой пояс учёта", "Europe/Moscow"],
    ],
    events: [{
      id: "event-1",
      status: "confirmed",
      summary: "ПТ Клиент",
      start: { dateTime: "2026-08-30T09:00:00Z" },
      end: { dateTime: "2026-08-30T10:00:00Z" },
    }],
  };
  const before = fingerprint(state);
  const clients = { getLastRow: () => 4 };
  const queue = {
    getLastRow: () => 3,
    getRange() {
      writes.push("queue-range");
      throw new Error("Queue range must not be requested for an empty read-only plan");
    },
  };
  const settings = {
    getLastRow: () => 19,
    getRange(row, column, rowCount, columnCount) {
      assert.deepEqual([row, column, rowCount, columnCount], [11, 1, 9, 2]);
      return {
        getValues() {
          return state.settings.concat(Array.from({ length: 6 }, () => ["", ""]));
        },
      };
    },
  };
  const spreadsheet = {};
  const context = vm.createContext({
    console,
    Date,
    SpreadsheetApp: { getActive: () => spreadsheet },
    Calendar: {
      Events: {
        list: () => ({ items: state.events }),
        get: () => {
          throw new Error("Unexpected Calendar.Events.get");
        },
      },
    },
    getRequiredSheet_(ss, name) {
      assert.equal(ss, spreadsheet);
      if (name === "Клиенты") return clients;
      if (name === "Очередь подтверждения") return queue;
      if (name === "Настройки") return settings;
      throw new Error(`Unexpected sheet ${name}`);
    },
  });

  new vm.Script(source, { filename: "CalendarSync.gs" }).runInContext(context);
  const plan = context.buildCalendarQueueSyncPlan_();

  assert.equal(fingerprint(state), before);
  assert.deepEqual(writes, []);
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].copyTemplate, true);
  assert.equal(plan.queueRows.length, 1);
  assert.equal(plan.queueRows[0][0], "Q-0001");
  assert.equal(plan.queueRows[0][3], "event-1");
});

test("blocked day exits after projected preflight with byte-identical logical state", async () => {
  const { calls, context, state } = await loadAdminHarness({ blocked: true });
  const before = fingerprint(state);

  assert.throws(
    () => context.confirmDmsMiniAppDay_({ dateKey: "2026-08-30" }),
    (error) => error.dmsCode === "day_not_ready" && error.dmsStatus === 409,
  );

  assert.equal(fingerprint(state), before);
  assert.deepEqual(calls, ["lock", "plan", "preflight", "unlock"]);
});

test("projected processQueueDate dry-run reports blockers without invoking writers", async () => {
  const runtimeSource = await readFile(`${candidateDirectory}/ZZZZZZZRuntime.gs`, "utf8");
  const state = {
    queue: [["Q-0001", "Ожидает"]],
    journal: [],
    blocks: [["B-0001", "Активен"]],
  };
  const before = fingerprint(state);
  const queueRow = new Array(17).fill("");
  queueRow[0] = "Q-0001";
  queueRow[1] = new Date("2026-08-30T09:00:00Z");
  queueRow[3] = "event-1";
  queueRow[5] = new Date("2026-08-30T09:00:00Z");
  queueRow[6] = new Date("2026-08-30T10:00:00Z");
  queueRow[8] = "C-0001";
  queueRow[11] = "Не распознано";
  queueRow[12] = "Проведена";
  queueRow[13] = "Ожидает";
  const noWrite = () => {
    throw new Error("Writer invoked during dry-run");
  };
  const context = vm.createContext({
    console,
    Date,
    LockService: { getDocumentLock: noWrite },
    SpreadsheetApp: {
      getActive: () => ({ getSpreadsheetTimeZone: () => "Europe/Moscow" }),
      flush: noWrite,
    },
    getRequiredSheet_: () => ({ getLastRow: () => 0, getRange: noWrite }),
    makeDateKey_: () => "2026-08-30",
    buildQueueProcessingContext_: () => ({
      clientsById: {},
      blocksById: {},
      completedByBlock: {},
      logByQueueId: {},
      logByEventId: {},
    }),
    validateQueueTrainingFast_: () => ({ ok: false, error: "Клиент не распознан." }),
    activateStartedPlannedBlocksForDate_: noWrite,
    autoCloseAllExhaustedBlocks_: noWrite,
    markQueueProcessed_: noWrite,
    autoCloseExhaustedBlock_: noWrite,
    markQueueNeedsNewBlock_: noWrite,
    markQueueError_: noWrite,
    writeQueueTrainingLogRowFast_: noWrite,
  });
  const constants = `const DMS_QUEUE_PROCESSING = ${JSON.stringify({
    QUEUE: "Очередь подтверждения",
    CLIENTS: "Клиенты",
    BLOCKS: "Блоки",
    LOG: "Журнал тренировок",
    QUEUE_FIRST_ROW: 4,
    QUEUE_COLUMNS: 17,
  })};\n`;
  new vm.Script(constants + runtimeSource, { filename: "ZZZZZZZRuntime.gs" }).runInContext(context);

  const result = context.processQueueDate_(
    new Date("2026-08-30T00:00:00Z"),
    "MiniApp",
    true,
    { lockHeld: true, queueRows: [queueRow] },
  );

  assert.equal(result.blocked, 1);
  assert.deepEqual(Array.from(result.blockers), ["Q-0001: Клиент не распознан."]);
  assert.equal(fingerprint(state), before);
});

test("ready day applies the frozen sync plan and completes normal processing", async () => {
  const { calls, context, state } = await loadAdminHarness({ blocked: false });

  const result = context.confirmDmsMiniAppDay_({ dateKey: "2026-08-30" });

  assert.deepEqual(calls, [
    "lock",
    "plan",
    "preflight",
    "apply",
    "process",
    "cancel",
    "bootstrap",
    "unlock",
  ]);
  assert.deepEqual(state.queue, [["Q-0001", "processed"], ["Q-0002", "synced"]]);
  assert.deepEqual(state.journal, [["TR-0001"]]);
  assert.equal(state.calendar[0].status, "kept");
  assert.equal(result.confirmation.added, 1);
  assert.equal(result.confirmation.changed, true);
});
