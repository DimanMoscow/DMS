import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const apiSource = fs.readFileSync("apps-script/candidates/v41/ZZZZZZZZMiniAppApi.gs", "utf8");
const portalSource = fs.readFileSync("apps-script/candidates/v41/ZZZZZZZZZZZClientPortal.gs", "utf8");
const token = "fixture-token-not-a-production-secret";
const nowSeconds = Math.floor(Date.now() / 1000);

const accessHeaders = [
  "Binding ID", "Telegram User ID", "Client ID", "Status", "Created At", "Updated At",
];
const measurementHeaders = [
  "Measurement ID", "Client ID", "Measured At", "Weight Kg", "Chest Cm",
  "Waist Cm", "Hips Cm", "Upper Arm Cm", "Thigh Cm",
];

class FakeRange {
  constructor(values) {
    this.values = values;
  }
  getValues() {
    return this.values.map((row) => row.slice());
  }
  getDisplayValues() {
    return this.values.map((row) => row.map((value) => {
      if (value instanceof Date) return value.toISOString();
      return value === null || value === undefined ? "" : String(value);
    }));
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
    const values = Array.from({ length: rowCount }, (_, rowOffset) =>
      Array.from({ length: columnCount }, (_, columnOffset) =>
        this.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ""));
    return new FakeRange(values);
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
      ["MSR-A1", "CL-A", new Date("2026-08-20T09:00:00.000Z"), 80, 102, 88, 98, 35, 58],
      ["MSR-A2", "CL-A", new Date("2026-08-27T09:00:00.000Z"), 79, 101, 86, 97, 35, 58],
      ["MSR-B1", "CL-B", new Date("2026-08-25T09:00:00.000Z"), 65, 91, 70, 94, 29, 52],
    ]),
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
        return { getSheetByName: (name) => sheets[name] ?? null };
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
      return { code: error?.message || "mini_app_api_failed", status: 500 };
    },
    Utilities: {
      newBlob(value) {
        return { getBytes: () => Array.from(Buffer.from(value, "utf8")) };
      },
      computeHmacSha256Signature(value, key) {
        return Array.from(crypto.createHmac("sha256", bytes(key)).update(bytes(value)).digest());
      },
    },
    getDmsMiniAppBootstrap_: adminBootstrap,
  });
  vm.runInContext(`${apiSource}\n${portalSource}`, context);
  context.getDmsMiniAppBootstrap_ = adminBootstrap;
  return context;
}

function signedInitData(userId, authDate = nowSeconds) {
  const values = {
    auth_date: String(authDate),
    query_id: `fixture-${userId}`,
    user: JSON.stringify({ id: Number(userId), first_name: "Fixture" }),
  };
  const dataCheckString = Object.keys(values).sort().map((key) => `${key}=${values[key]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
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
