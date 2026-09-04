import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const apiSource = fs.readFileSync("apps-script/candidates/v46/ZZZZZZZZMiniAppApi.gs", "utf8");
const portalSource = fs.readFileSync("apps-script/candidates/v46/ZZZZZZZZZZZClientPortal.gs", "utf8");
const token = "fixture-token-not-a-production-secret";
const nowSeconds = Math.floor(Date.now() / 1000);

const accessHeaders = [
  "Binding ID", "Telegram User ID", "Client ID", "Status", "Created At", "Updated At",
];
const measurementHeaders = [
  "Measurement ID", "Client ID", "Measured At", "Weight Kg", "Chest Cm",
  "Waist Cm", "Hips Cm", "Upper Arm Cm", "Thigh Cm",
  "Corrects Measurement ID", "Created At", "Created By",
];
const inviteHeaders = [
  "Invite ID", "Token SHA-256", "Client ID", "Status", "Expires At",
  "Created At", "Used At", "Revoked At", "Updated At", "Used Binding ID",
];

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }
  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ""));
  }
  getDisplayValues() {
    return this.getValues().map((row) => row.map((value) => {
      if (value instanceof Date) return value.toISOString();
      return value === null || value === undefined ? "" : String(value);
    }));
  }
  setValues(values) {
    assert.equal(values.length, this.rowCount);
    values.forEach((sourceRow, rowOffset) => {
      assert.equal(sourceRow.length, this.columnCount);
      const target = this.sheet.rows[this.row - 1 + rowOffset] ?? [];
      this.sheet.rows[this.row - 1 + rowOffset] = target;
      sourceRow.forEach((value, columnOffset) => {
        target[this.column - 1 + columnOffset] = value;
      });
    });
    return this;
  }
  setValue(value) {
    return this.setValues([[value]]);
  }
}

class FakeSheet {
  constructor(rows) {
    this.rows = rows;
  }
  getLastRow() {
    return this.rows.length;
  }
  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount ?? 1, columnCount ?? 1);
  }
  appendRow(row) {
    this.rows.push(row.slice());
  }
  deleteRow(row) {
    this.rows.splice(row - 1, 1);
  }
}

function clientRow(id, name, format = "Персональные") {
  return [id, name, "Активен", "", format, "", "", "", "", "", "", "", "", ""];
}

function fixtures(accessRows = [
  ["BND-A", "100001", "CL-A", "active", "", ""],
  ["BND-B", "100002", "CL-B", "active", "", ""],
]) {
  const empty = Array(14).fill("");
  const sheets = {
    "Доступ клиентов": new FakeSheet([accessHeaders, ...accessRows]),
    "Клиенты": new FakeSheet([empty, empty, empty, empty, clientRow("CL-A", "Клиент A"), clientRow("CL-B", "Клиент B")]),
    "Замеры": new FakeSheet([
      measurementHeaders,
      ["MSR-A1", "CL-A", new Date("2026-08-20T12:00:00.000Z"), 80, 102, 88, 98, 35, 58, "", new Date("2026-08-20T12:30:00.000Z"), "999999"],
      ["MSR-A2", "CL-A", new Date("2026-08-27T12:00:00.000Z"), 79, 101, 86, 97, 35, 58, "", new Date("2026-08-27T12:30:00.000Z"), "999999"],
      ["MSR-B1", "CL-B", new Date("2026-08-25T12:00:00.000Z"), 65, 91, 70, 94, 29, 52, "", new Date("2026-08-25T12:30:00.000Z"), "999999"],
    ]),
    "Приглашения Client Portal": new FakeSheet([inviteHeaders]),
  };
  return sheets;
}

function bytes(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.from(Array.from(value, (entry) => entry < 0 ? entry + 256 : entry));
}

function createContext({
  sheets = fixtures(),
  adminIds = "999999",
  adminBootstrap = () => { throw new Error("admin data must not be read for a client"); },
} = {}) {
  const context = vm.createContext({
    Date,
    console: { error() {}, log() {} },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(text) {
        return {
          text,
          setMimeType() { return this; },
        };
      },
    },
    SpreadsheetApp: {
      getActive() {
        return {
          getSheetByName: (name) => sheets[name] ?? null,
          getSpreadsheetTimeZone: () => "Europe/Moscow",
        };
      },
      flush() {},
    },
    LockService: {
      getDocumentLock() {
        return { tryLock: () => true, releaseLock() {} };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            if (key === "DMS_TG_BOT_TOKEN") return token;
            if (key === "DMS_TG_ADMIN_USER_IDS") return adminIds;
            return "";
          },
        };
      },
    },
    DMS_TELEGRAM: {
      PROP_TOKEN: "DMS_TG_BOT_TOKEN",
      PROP_ADMIN_IDS: "DMS_TG_ADMIN_USER_IDS",
    },
    getTelegramProperty_(key) {
      if (key === "DMS_TG_BOT_TOKEN") return token;
      if (key === "DMS_TG_ADMIN_USER_IDS") return adminIds;
      return "";
    },
    getDmsMiniAppFailure_(error) {
      return error?.dmsCode
        ? { code: error.dmsCode, status: error.dmsStatus || 500 }
        : { code: error?.message || "mini_app_api_failed", status: 500 };
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      newBlob(value) {
        return { getBytes: () => Array.from(Buffer.from(value, "utf8")) };
      },
      computeHmacSha256Signature(value, key) {
        return Array.from(crypto.createHmac("sha256", bytes(key)).update(bytes(value)).digest());
      },
      computeDigest(algorithm, value) {
        return Array.from(crypto.createHash(algorithm).update(String(value), "utf8").digest());
      },
      base64EncodeWebSafe(value) {
        return bytes(value).toString("base64url");
      },
      getUuid() {
        return crypto.randomUUID();
      },
      formatDate(value) {
        return value.toISOString().slice(0, 10);
      },
    },
    telegramApi_(method) {
      assert.equal(method, "getMe");
      return { username: "FixtureDmsBot", has_main_web_app: true };
    },
    getDmsMiniAppBootstrap_: adminBootstrap,
  });
  vm.runInContext(`${apiSource}\n${portalSource}`, context);
  context.getDmsMiniAppBootstrap_ = adminBootstrap;
  return context;
}

function signedInitData(userId, authDate = nowSeconds, startParam = "") {
  const values = {
    auth_date: String(authDate),
    query_id: `fixture-${userId}`,
    user: JSON.stringify({ id: Number(userId), first_name: "Fixture" }),
  };
  if (startParam) values.start_param = startParam;
  const dataCheckString = Object.keys(values).sort().map((key) => `${key}=${values[key]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

function actionRequest(context, userId, action, payload, startParam = "") {
  const body = {
    dmsMiniApp: "dms-fitness-miniapp",
    version: 1,
    initData: signedInitData(userId, nowSeconds, startParam),
    action,
  };
  if (payload !== undefined) body.payload = payload;
  return JSON.parse(context.handleDmsMiniAppRequest_(body).text);
}

function request(context, userId, payload, authDate = nowSeconds) {
  const body = {
    dmsMiniApp: "dms-fitness-miniapp",
    version: 1,
    initData: signedInitData(userId, authDate),
    action: "client_portal_bootstrap",
  };
  if (payload !== undefined) body.payload = payload;
  const response = context.handleDmsMiniAppRequest_(body);
  return JSON.parse(response.text);
}

function keysDeep(value, output = new Set()) {
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    output.add(key);
    keysDeep(child, output);
  }
  return output;
}

test("client A and B receive only their own profiles and measurements", () => {
  const context = createContext();
  const a = request(context, "100001");
  const b = request(context, "100002");

  assert.equal(a.ok, true);
  assert.equal(a.data.profile.name, "Клиент A");
  assert.equal(a.data.measurements.length, 2);
  assert.equal(a.data.latestMeasurement.metrics.weightKg, 79);
  assert.equal(b.ok, true);
  assert.equal(b.data.profile.name, "Клиент B");
  assert.equal(b.data.measurements.length, 1);
  assert.equal(b.data.latestMeasurement.metrics.weightKg, 65);
  assert.doesNotMatch(JSON.stringify(a), /CL-B|MSR-B1|Клиент B/);
  assert.doesNotMatch(JSON.stringify(b), /CL-A|MSR-A|Клиент A/);
});

test("clientId payload is rejected instead of selecting another client", () => {
  const context = createContext();
  const result = request(context, "100001", { clientId: "CL-B" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, "invalid_request");

  const topLevel = context.handleDmsMiniAppRequest_({
    dmsMiniApp: "dms-fitness-miniapp",
    version: 1,
    initData: signedInitData("100001"),
    action: "client_portal_bootstrap",
    clientId: "CL-B",
  });
  assert.equal(JSON.parse(topLevel.text).error, "invalid_request");
});

test("invalid, expired and unlinked Telegram identities fail closed", () => {
  const context = createContext();
  const invalid = context.handleDmsMiniAppRequest_({
    dmsMiniApp: "dms-fitness-miniapp",
    version: 1,
    initData: signedInitData("100001").replace(/hash=[^&]+/, `hash=${"0".repeat(64)}`),
    action: "client_portal_bootstrap",
  });
  assert.equal(JSON.parse(invalid.text).error, "invalid_signature");

  const expired = request(context, "100001", undefined, nowSeconds - 21601);
  assert.equal(expired.error, "expired_init_data");
  const unlinked = request(context, "100003");
  assert.equal(unlinked.error, "client_not_linked");
});

test("duplicate or ambiguous bindings fail closed", () => {
  const duplicateUser = createContext({ sheets: fixtures([
    ["BND-A", "100001", "CL-A", "active", "", ""],
    ["BND-X", "100001", "CL-B", "active", "", ""],
  ]) });
  assert.equal(request(duplicateUser, "100001").error, "client_link_invalid");

  const duplicateClient = createContext({ sheets: fixtures([
    ["BND-A", "100001", "CL-A", "active", "", ""],
    ["BND-X", "100002", "CL-A", "active", "", ""],
  ]) });
  assert.equal(request(duplicateClient, "100001").error, "client_link_invalid");

  const malformed = createContext({ sheets: fixtures([
    ["broken", "100001", "CL-A", "active", "", ""],
  ]) });
  assert.equal(request(malformed, "100001").error, "client_link_invalid");
});

test("client identity cannot enter the existing admin API", () => {
  const context = createContext();
  const response = context.handleDmsMiniAppRequest_({
    dmsMiniApp: "dms-fitness-miniapp",
    version: 1,
    initData: signedInitData("100001"),
    action: "bootstrap",
    payload: {},
  });
  const result = JSON.parse(response.text);
  assert.equal(result.status, 403);
  assert.equal(result.error, "access_denied");

  const admin = createContext({
    adminIds: "999999",
    adminBootstrap: () => ({ adminOnly: true }),
  });
  const adminResponse = admin.handleDmsMiniAppRequest_({
    dmsMiniApp: "dms-fitness-miniapp",
    version: 1,
    initData: signedInitData("999999"),
    action: "bootstrap",
    payload: {},
  });
  const adminResult = JSON.parse(adminResponse.text);
  assert.equal(adminResult.ok, true, JSON.stringify(adminResult));
  assert.equal(adminResult.data.adminOnly, true);
});

test("ordinary entry resolves admin, linked client and unlinked roles on the server", () => {
  const context = createContext({
    adminIds: "999999",
    adminBootstrap: () => { throw new Error("entry resolution must not read admin bootstrap"); },
  });
  const admin = actionRequest(context, "999999", "resolve_miniapp_entry");
  const linked = actionRequest(context, "100001", "resolve_miniapp_entry");
  const unlinked = actionRequest(context, "100003", "resolve_miniapp_entry");

  assert.deepEqual(JSON.parse(JSON.stringify(admin.data)), { role: "admin" });
  assert.deepEqual(JSON.parse(JSON.stringify(linked.data)), { role: "client" });
  assert.deepEqual(JSON.parse(JSON.stringify(unlinked.data)), { role: "unlinked" });
  assert.doesNotMatch(JSON.stringify([admin, linked, unlinked]), /100001|100003|CL-A|BND-A/);
});

test("entry resolution rejects selectors and ambiguous bindings", () => {
  const ambiguous = createContext({ sheets: fixtures([
    ["BND-A", "100001", "CL-A", "active", "", ""],
    ["BND-X", "100001", "CL-B", "active", "", ""],
  ]) });
  assert.equal(
    actionRequest(ambiguous, "100001", "resolve_miniapp_entry").error,
    "client_link_invalid",
  );

  const context = createContext();
  assert.equal(
    actionRequest(context, "100001", "resolve_miniapp_entry", { clientId: "CL-B" }).error,
    "invalid_request",
  );
});

test("client response uses an explicit allow-list and omits internal and financial fields", () => {
  const result = request(createContext(), "100001");
  const responseKeys = keysDeep(result.data);
  for (const prohibited of [
    "clientId", "telegramUserId", "measurementId", "bindingId", "paid", "debt",
    "blockId", "blockPrice", "conditions", "payments", "notes",
  ]) {
    assert.equal(responseKeys.has(prohibited), false, `response exposed ${prohibited}`);
  }
  assert.doesNotMatch(JSON.stringify(result), /CL-A|BND-A|MSR-A|100001/);
});

test("admin creates an opaque hashed one-time invite without storing the raw token", () => {
  const sheets = fixtures([]);
  const context = createContext({ sheets });
  const result = actionRequest(context, "999999", "create_client_portal_invite", { clientId: "CL-A" });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.data.inviteUrl, /^https:\/\/t\.me\/FixtureDmsBot\?startapp=[A-Za-z0-9_-]{43}$/);
  assert.equal(result.data.clientPortal.status, "invited");
  const rawToken = new URL(result.data.inviteUrl).searchParams.get("startapp");
  const stored = sheets["Приглашения Client Portal"].rows[1];
  assert.equal(stored[1], crypto.createHash("sha256").update(rawToken).digest("hex"));
  assert.equal(JSON.stringify(stored).includes(rawToken), false);
  assert.equal(stored[2], "CL-A");
  assert.equal(stored[3], "pending");
});

test("signed enrollment consumes once and creates exactly one binding", () => {
  const sheets = fixtures([]);
  const context = createContext({ sheets });
  const created = actionRequest(context, "999999", "create_client_portal_invite", { clientId: "CL-A" });
  const tokenValue = new URL(created.data.inviteUrl).searchParams.get("startapp");

  const enrolled = actionRequest(context, "100001", "client_portal_enroll", undefined, tokenValue);
  assert.equal(enrolled.ok, true, JSON.stringify(enrolled));
  assert.equal(sheets["Доступ клиентов"].rows.length, 2);
  assert.equal(sheets["Доступ клиентов"].rows[1][1], "100001");
  assert.equal(sheets["Доступ клиентов"].rows[1][2], "CL-A");
  assert.equal(sheets["Приглашения Client Portal"].rows[1][3], "used");

  const replay = actionRequest(context, "100001", "client_portal_enroll", undefined, tokenValue);
  assert.equal(replay.ok, false);
  assert.equal(replay.error, "enrollment_invite_invalid");
  assert.equal(sheets["Доступ клиентов"].rows.length, 2);
});

test("tampered, expired and revoked invites fail closed", () => {
  const sheets = fixtures([]);
  const context = createContext({ sheets });
  const created = actionRequest(context, "999999", "create_client_portal_invite", { clientId: "CL-A" });
  const tokenValue = new URL(created.data.inviteUrl).searchParams.get("startapp");
  const tampered = `${tokenValue.slice(0, -1)}${tokenValue.endsWith("A") ? "B" : "A"}`;
  assert.equal(actionRequest(context, "100001", "client_portal_enroll", undefined, tampered).error,
    "enrollment_invite_invalid");

  sheets["Приглашения Client Portal"].rows[1][4] = new Date(Date.now() - 1_000);
  assert.equal(actionRequest(context, "100001", "client_portal_enroll", undefined, tokenValue).error,
    "enrollment_invite_expired");
  assert.equal(sheets["Доступ клиентов"].rows.length, 1);

  const sheets2 = fixtures([]);
  const context2 = createContext({ sheets: sheets2 });
  const created2 = actionRequest(context2, "999999", "create_client_portal_invite", { clientId: "CL-A" });
  const inviteId = created2.data.clientPortal.activeInvite.inviteId;
  const token2 = new URL(created2.data.inviteUrl).searchParams.get("startapp");
  assert.equal(actionRequest(context2, "999999", "revoke_client_portal_invite", {
    clientId: "CL-A", inviteId,
  }).ok, true);
  assert.equal(actionRequest(context2, "100001", "client_portal_enroll", undefined, token2).error,
    "enrollment_invite_invalid");
});

test("one-to-one invariants reject client and Telegram conflicts and selectors", () => {
  const sheets = fixtures([["BND-A", "100001", "CL-A", "active", "", ""]]);
  const context = createContext({ sheets });
  assert.equal(actionRequest(context, "999999", "create_client_portal_invite", { clientId: "CL-A" }).error,
    "client_already_linked");

  const fresh = fixtures([["BND-A", "100001", "CL-A", "active", "", ""]]);
  const freshContext = createContext({ sheets: fresh });
  const created = actionRequest(freshContext, "999999", "create_client_portal_invite", { clientId: "CL-B" });
  const tokenValue = new URL(created.data.inviteUrl).searchParams.get("startapp");
  assert.equal(actionRequest(freshContext, "100001", "client_portal_enroll", undefined, tokenValue).error,
    "client_link_conflict");
  assert.equal(fresh["Доступ клиентов"].rows.length, 2);

  const selector = freshContext.handleDmsMiniAppRequest_({
    dmsMiniApp: "dms-fitness-miniapp",
    version: 1,
    initData: signedInitData("100002", nowSeconds, tokenValue),
    action: "client_portal_enroll",
    clientId: "CL-B",
  });
  assert.equal(JSON.parse(selector.text).error, "invalid_request");
});

test("client cannot create invites and lock serializes race attempts", () => {
  const sheets = fixtures([]);
  const context = createContext({ sheets });
  assert.equal(actionRequest(context, "100001", "create_client_portal_invite", { clientId: "CL-A" }).error,
    "access_denied");
  const created = actionRequest(context, "999999", "create_client_portal_invite", { clientId: "CL-A" });
  const tokenValue = new URL(created.data.inviteUrl).searchParams.get("startapp");
  const first = actionRequest(context, "100001", "client_portal_enroll", undefined, tokenValue);
  const second = actionRequest(context, "100002", "client_portal_enroll", undefined, tokenValue);
  assert.equal(first.ok, true);
  assert.equal(second.error, "enrollment_invite_invalid");
  assert.equal(sheets["Доступ клиентов"].rows.length, 2);
});

test("admin measurement create validates allow-list and rejects duplicate dates", () => {
  const sheets = fixtures([]);
  sheets["Замеры"] = new FakeSheet([measurementHeaders]);
  const context = createContext({ sheets });
  const created = actionRequest(context, "999999", "create_client_measurement", {
    clientId: "CL-A",
    measuredAt: "2026-09-01",
    metrics: { weightKg: 78.5, waistCm: 85 },
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.data.measurements.active.length, 1);
  assert.equal(created.data.measurements.auditCount, 1);
  assert.equal(sheets["Замеры"].rows[1][1], "CL-A");
  assert.equal(sheets["Замеры"].rows[1][3], 78.5);
  assert.equal(sheets["Замеры"].rows[1][9], "");
  assert.equal(sheets["Замеры"].rows[1][11], "999999");

  const duplicate = actionRequest(context, "999999", "create_client_measurement", {
    clientId: "CL-A",
    measuredAt: "2026-09-01",
    metrics: { weightKg: 78 },
  });
  assert.equal(duplicate.error, "measurement_duplicate");
  assert.equal(sheets["Замеры"].rows.length, 2);

  const forbidden = actionRequest(context, "999999", "create_client_measurement", {
    clientId: "CL-A",
    measuredAt: "2026-09-02",
    metrics: { bloodPressure: 120 },
  });
  assert.equal(forbidden.error, "measurement_invalid");
});

test("correction appends audit history and client sees only the corrected value", () => {
  const sheets = fixtures([["BND-A", "100001", "CL-A", "active", "", ""]]);
  sheets["Замеры"] = new FakeSheet([measurementHeaders]);
  const context = createContext({ sheets });
  const created = actionRequest(context, "999999", "create_client_measurement", {
    clientId: "CL-A",
    measuredAt: "2026-09-01",
    metrics: { weightKg: 78.5, waistCm: 85 },
  });
  const originalId = created.data.measurements.active[0].measurementId;
  const corrected = actionRequest(context, "999999", "correct_client_measurement", {
    clientId: "CL-A",
    measurementId: originalId,
    measuredAt: "2026-09-01",
    metrics: { weightKg: 78.1, waistCm: 84.5 },
  });
  assert.equal(corrected.ok, true, JSON.stringify(corrected));
  assert.equal(corrected.data.measurements.active.length, 1);
  assert.equal(corrected.data.measurements.auditCount, 2);
  assert.equal(corrected.data.measurements.active[0].corrected, true);
  assert.equal(sheets["Замеры"].rows[2][9], originalId);

  const client = request(context, "100001");
  assert.equal(client.ok, true, JSON.stringify(client));
  assert.equal(client.data.measurements.length, 1);
  assert.equal(client.data.latestMeasurement.metrics.weightKg, 78.1);
  assert.equal(JSON.stringify(client).includes(originalId), false);

  const secondCorrection = actionRequest(context, "999999", "correct_client_measurement", {
    clientId: "CL-A",
    measurementId: originalId,
    measuredAt: "2026-09-01",
    metrics: { weightKg: 77.9 },
  });
  assert.equal(secondCorrection.error, "measurement_correction_conflict");
  assert.equal(sheets["Замеры"].rows.length, 3);
});

test("server rejects a no-op correction without appending audit history", () => {
  const sheets = fixtures([]);
  sheets["Замеры"] = new FakeSheet([measurementHeaders]);
  const context = createContext({ sheets });
  const created = actionRequest(context, "999999", "create_client_measurement", {
    clientId: "CL-A",
    measuredAt: "2026-09-01",
    metrics: { weightKg: 78.5, waistCm: 85 },
  });
  const originalId = created.data.measurements.active[0].measurementId;

  const noOp = actionRequest(context, "999999", "correct_client_measurement", {
    clientId: "CL-A",
    measurementId: originalId,
    measuredAt: "2026-09-01",
    metrics: { weightKg: 78.5, waistCm: 85 },
  });

  assert.equal(noOp.error, "measurement_noop");
  assert.equal(noOp.status, 409);
  assert.equal(sheets["Замеры"].rows.length, 2);
});

test("measurement writes remain admin-only and reject invalid ranges or future dates", () => {
  const sheets = fixtures([]);
  sheets["Замеры"] = new FakeSheet([measurementHeaders]);
  const context = createContext({ sheets });
  assert.equal(actionRequest(context, "100001", "create_client_measurement", {
    clientId: "CL-A", measuredAt: "2026-09-01", metrics: { weightKg: 80 },
  }).error, "access_denied");
  assert.equal(actionRequest(context, "999999", "create_client_measurement", {
    clientId: "CL-A", measuredAt: "2026-09-01", metrics: { weightKg: 999 },
  }).error, "measurement_invalid");
  assert.equal(actionRequest(context, "999999", "create_client_measurement", {
    clientId: "CL-A", measuredAt: "2099-01-01", metrics: { weightKg: 80 },
  }).error, "measurement_invalid");
  assert.equal(sheets["Замеры"].rows.length, 1);
});
