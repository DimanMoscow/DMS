import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  "apps-script/candidates/v50/ZZZZZZZZZZZZTelegramConfirmations.gs",
  "utf8",
);
const telegramBotSource = fs.readFileSync(
  "apps-script/candidates/v50/TelegramBot.gs",
  "utf8",
);

function makeStore() {
  const values = new Map();
  return {
    getProperty(key) { return values.get(key) ?? null; },
    setProperty(key, value) { values.set(key, String(value)); },
    deleteProperty(key) { values.delete(key); },
    values,
  };
}

function createContext() {
  const fixedNow = Date.parse("2026-09-06T00:01:00Z");
  class FixedDate extends Date {
    constructor(value) {
      super(value === undefined ? fixedNow : value);
    }
    static now() { return fixedNow; }
  }
  const documentProperties = makeStore();
  const scriptProperties = makeStore();
  const cache = new Map();
  const events = [];
  let uuid = 0;
  let mutationCount = 0;
  const context = vm.createContext({
    console,
    Date: FixedDate,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    isFinite,
    PropertiesService: {
      getDocumentProperties: () => documentProperties,
      getScriptProperties: () => scriptProperties,
    },
    CacheService: {
      getScriptCache: () => ({
        put(key, value) { cache.set(key, String(value)); },
        get(key) { return cache.get(key) ?? null; },
        remove(key) { cache.delete(key); },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest(_algorithm, value) {
        return [...crypto.createHash("sha256").update(String(value)).digest()]
          .map((byte) => (byte > 127 ? byte - 256 : byte));
      },
      base64EncodeWebSafe(bytes) {
        return Buffer.from(bytes.map((byte) => (byte < 0 ? byte + 256 : byte)))
          .toString("base64url");
      },
      getUuid() {
        uuid += 1;
        return uuid.toString(16).padStart(8, "0") + "-0000-4000-8000-" +
          uuid.toString(16).padStart(12, "0");
      },
    },
    LockService: {
      getDocumentLock: () => ({
        tryLock: () => true,
        releaseLock() {},
      }),
    },
    telegramAnswerCallback_() {},
    telegramEditMessageV49_() { return { message_id: 7 }; },
    telegramSendMessageV49_() { return { message_id: 7 }; },
    escapeTelegramHtml_: (value) => String(value),
  });
  new vm.Script(source, { filename: "ZZZZZZZZZZZZTelegramConfirmations.gs" }).runInContext(context);

  context.appendTelegramOperationEvent_ = (state, event, resultCode, resultRef, detail) => {
    events.push({ operationId: state.operationId, event, resultCode, resultRef, detail });
  };
  context.findTelegramOperationResult_ = (operationId) => {
    const matches = events.filter((event) => event.operationId === operationId);
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (matches[index].event === "committed") {
        return { status: "committed", code: matches[index].resultCode || "completed", refHash: "hash" };
      }
      if (matches[index].event === "failed") return { status: "failed", failed: true };
      if (matches[index].event === "pending") return { status: "pending", pending: true };
    }
    return null;
  };
  context.executeTelegramSecureMutation_ = () => {
    mutationCount += 1;
    return { code: "completed", ref: "private-result" };
  };
  context.recoverTelegramSecureMutation_ = () => null;

  return {
    context,
    cache,
    documentProperties,
    events,
    mutationCount: () => mutationCount,
    setMutationCount: (value) => { mutationCount = value; },
  };
}

function createTicket(fixture, options = {}) {
  const { context } = fixture;
  const ticket = context.createTelegramConfirmation_(
    options.userId ?? "1001",
    options.chatId ?? "2002",
    options.messageId ?? "7",
    options.action ?? "payment",
    options.payload ?? { legacyData: "pc:yes" },
    options.nowMs ?? Date.parse("2026-09-06T00:00:00Z"),
  );
  return {
    ticket,
    parsed: context.parseTelegramConfirmationCallback_(ticket.callbackData),
    query: {
      id: "callback-id",
      from: { id: options.userId ?? "1001" },
      message: { message_id: Number(options.messageId ?? 7), chat: { id: options.chatId ?? "2002" } },
    },
  };
}

test("one-time confirmation accepts the exact admin, chat, message, action and payload", () => {
  const fixture = createContext();
  const { context } = fixture;
  const flow = createTicket(fixture);
  const validated = context.validateTelegramConfirmation_(flow.parsed, flow.query,
    Date.parse("2026-09-06T00:01:00Z"));
  assert.equal(validated.state.status, "pending");
  assert.equal(validated.state.action, "payment");
  assert.deepEqual(JSON.parse(JSON.stringify(validated.payload)), { legacyData: "pc:yes" });
  assert.equal(flow.ticket.callbackData.length <= 64, true);
});

test("wrong admin, chat, message and nonce fail closed", () => {
  for (const variant of ["admin", "chat", "message", "nonce"]) {
    const fixture = createContext();
    const flow = createTicket(fixture);
    if (variant === "admin") flow.query.from.id = "9999";
    if (variant === "chat") flow.query.message.chat.id = "9999";
    if (variant === "message") flow.query.message.message_id = 9999;
    if (variant === "nonce") flow.parsed.nonce = "f".repeat(32);
    assert.throws(() => fixture.context.validateTelegramConfirmation_(flow.parsed, flow.query,
      Date.parse("2026-09-06T00:01:00Z")), /друг|привязано|не найдено/);
  }
});

test("action and payload tampering fail their cryptographic binding", () => {
  for (const variant of ["action", "payload"]) {
    const fixture = createContext();
    const flow = createTicket(fixture);
    if (variant === "action") {
      const key = "DMS_TG_CF_" + flow.ticket.id;
      const state = JSON.parse(fixture.documentProperties.getProperty(key));
      state.action = "calendar_create";
      fixture.documentProperties.setProperty(key, JSON.stringify(state));
    } else {
      fixture.cache.set("DMS_TG_CF_PAYLOAD_" + flow.ticket.id,
        JSON.stringify({ legacyData: "ops:archiveYes:CL-1" }));
    }
    assert.throws(() => fixture.context.validateTelegramConfirmation_(flow.parsed, flow.query,
      Date.parse("2026-09-06T00:01:00Z")), /повреждены/);
  }
});

test("expired and revoked confirmations never start a mutation", () => {
  const expired = createContext();
  const expiredFlow = createTicket(expired);
  assert.throws(() => expired.context.beginTelegramSecureOperation_(expiredFlow.parsed, expiredFlow.query,
    Date.parse("2026-09-06T00:16:00Z")), /истёк/);
  assert.equal(expired.events.some((event) => event.event === "expired"), true);

  const revoked = createContext();
  const revokedFlow = createTicket(revoked);
  revoked.context.revokeTelegramConfirmationById_(revokedFlow.ticket.id, "test");
  assert.throws(() => revoked.context.beginTelegramSecureOperation_(revokedFlow.parsed, revokedFlow.query,
    Date.parse("2026-09-06T00:01:00Z")), /использовано или отозвано/);
});

test("changed underlying cached state invalidates a pending confirmation", () => {
  const fixture = createContext();
  const initial = { phase: "confirm", amount: 1000 };
  fixture.context.getTelegramPaymentState_ = () => ({ phase: "confirm", amount: 2000 });
  const stateHash = fixture.context.hashTelegramConfirmationValue_(
    fixture.context.canonicalTelegramConfirmationJson_(initial),
  );
  const flow = createTicket(fixture, {
    payload: { legacyData: "pc:yes", stateKind: "payment", stateHash },
  });
  assert.throws(() => fixture.context.beginTelegramSecureOperation_(flow.parsed, flow.query,
    Date.parse("2026-09-06T00:01:00Z")), /изменились/);
});

test("concurrent callbacks yield one executor and a durable replay result", () => {
  const fixture = createContext();
  const flow = createTicket(fixture);
  const first = fixture.context.beginTelegramSecureOperation_(flow.parsed, flow.query,
    Date.parse("2026-09-06T00:01:00Z"));
  assert.equal(first.execute, true);
  const concurrent = fixture.context.beginTelegramSecureOperation_(flow.parsed, flow.query,
    Date.parse("2026-09-06T00:01:01Z"));
  assert.equal(concurrent.inProgress, true);
  fixture.context.finalizeTelegramSecureOperation_(first.validated.state,
    { code: "payment_recorded", ref: "OP-1" }, "committed", "test");
  const replay = fixture.context.beginTelegramSecureOperation_(flow.parsed, flow.query,
    Date.parse("2026-09-06T00:01:02Z"));
  assert.equal(replay.replay, true);
  assert.equal(replay.result.code, "payment_recorded");
});

test("duplicate confirmations for one logical flow share an operation ID", () => {
  const fixture = createContext();
  const first = createTicket(fixture, { payload: { legacyData: "pc:yes", stateHash: "flow-1" } });
  const second = createTicket(fixture, { payload: { legacyData: "pc:yes", stateHash: "flow-1" } });
  const firstState = fixture.context.getTelegramConfirmationState_(first.ticket.id);
  const secondState = fixture.context.getTelegramConfirmationState_(second.ticket.id);
  assert.notEqual(first.ticket.id, second.ticket.id);
  assert.equal(firstState.operationId, secondState.operationId);
  fixture.context.processTelegramSecureCallback_(first.query, first.parsed);
  fixture.context.processTelegramSecureCallback_(second.query, second.parsed);
  assert.equal(fixture.mutationCount(), 1);
});

test("transport failure after a mutation is recovered and never mutates twice", () => {
  const fixture = createContext();
  const flow = createTicket(fixture);
  let executions = 0;
  fixture.context.executeTelegramSecureMutation_ = () => {
    executions += 1;
    throw new Error("transport failed after durable write");
  };
  fixture.context.recoverTelegramSecureMutation_ = () => ({ code: "payment_recorded", ref: "OP-1" });
  const first = fixture.context.processTelegramSecureCallback_(flow.query, flow.parsed);
  assert.equal(first.code, "payment_recorded");
  const replay = fixture.context.processTelegramSecureCallback_(flow.query, flow.parsed);
  assert.equal(replay.code, "payment_recorded");
  assert.equal(executions, 1);
  assert.equal(fixture.events.filter((event) => event.event === "committed").length, 1);
  assert.equal(fixture.events.some((event) => event.event === "replay"), true);
});

test("legacy generic mutation callbacks fail closed and audit code never logs secrets", () => {
  const fixture = createContext();
  for (const callback of [
    "pc:yes", "scc:yes", "scc:force", "mc:yes", "ops:renameYes",
    "ops:singlePriceYes", "ops:blockEditYes", "ops:umYes", "ops:ucYes",
  ]) {
    assert.equal(fixture.context.describeTelegramLegacyMutation_(callback).blockedLegacyState, true);
  }
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(source, /nonce[^\n]*appendRow/i);
  assert.match(source, /Result Ref Hash/);
  assert.doesNotMatch(source, /Telegram User ID|Client ID|Payment Amount/);
});

test("every payload-bearing legacy mutation is upgraded before execution", () => {
  const { context } = createContext();
  for (const callback of [
    "qd:Q-0085:done", "qd:Q-0085:charge", "qd:Q-0085:free", "qd:Q-0085:move",
    "qp:2026-09-06", "mgc:CL-1:BL-1:10", "mpc:CL-1:BL-1",
    "mrc:CL-1:BL-1", "mclc:CL-1:BL-1", "ops:undoYes:TGE-1",
    "ops:archiveYes:CL-1", "ops:restoreYes:CL-1", "ops:voidPaymentYes:OP-1",
    "ops:toggle:morning", "ops:backup",
  ]) {
    const descriptor = context.describeTelegramLegacyMutation_(callback);
    assert.ok(descriptor, callback);
    assert.equal(descriptor.blockedLegacyState, undefined, callback);
  }
});

test("secure payment and management failures reach the durable operation ledger", () => {
  for (const functionName of ["confirmTelegramPayment_", "confirmTelegramManagementState_"]) {
    const start = telegramBotSource.indexOf(`function ${functionName}`);
    assert.notEqual(start, -1, functionName);
    const next = telegramBotSource.indexOf("\nfunction ", start + 10);
    const body = telegramBotSource.slice(start, next === -1 ? undefined : next);
    assert.match(body, /if \(DMS_TELEGRAM_SECURE_DELIVERY\) throw error;/, functionName);
  }
  const scheduleStart = telegramBotSource.indexOf("function confirmTelegramSchedule_");
  const scheduleEnd = telegramBotSource.indexOf("\nfunction ", scheduleStart + 10);
  const scheduleBody = telegramBotSource.slice(scheduleStart, scheduleEnd);
  assert.match(scheduleBody,
    /if \(DMS_TELEGRAM_SECURE_DELIVERY\)[\s\S]*Расписание изменилось/,
    "calendar drift must invalidate a secure confirmation instead of recording a false success");
});
