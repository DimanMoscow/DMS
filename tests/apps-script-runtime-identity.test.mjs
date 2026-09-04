import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const candidateDirectory = "apps-script/candidates/v46";
const telegramSource = fs.readFileSync(`${candidateDirectory}/TelegramBot.gs`, "utf8");

function sha256(fileName) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(`${candidateDirectory}/${fileName}`))
    .digest("hex");
}

function createContext({ clientPortalHandlerLoaded = true } = {}) {
  const context = vm.createContext({
    JSON,
    ContentService: {
      MimeType: { JSON: "application/json", TEXT: "text/plain" },
      createTextOutput(text) {
        return {
          text,
          mimeType: "",
          setMimeType(mimeType) {
            this.mimeType = mimeType;
            return this;
          },
        };
      },
    },
  });
  if (clientPortalHandlerLoaded) {
    context.handleDmsClientPortalRequest_ = () => {};
  }
  vm.runInContext(telegramSource, context);
  return context;
}

test("runtime identity fingerprints the exact client router sources", () => {
  const context = createContext();
  const response = context.doGet({ parameter: { dms_runtime_identity: "1" } });
  const identity = JSON.parse(response.text);

  assert.equal(response.mimeType, "application/json");
  assert.deepEqual(Object.keys(identity).sort(), [
    "clientPortalHandlerLoaded",
    "clientPortalSha256",
    "ok",
    "release",
    "routerSha256",
    "service",
  ]);
  assert.equal(identity.ok, true);
  assert.equal(identity.service, "dms-fitness-apps-script");
  assert.equal(identity.release, "client-portal-measurement-guard-r5");
  assert.equal(identity.routerSha256, sha256("ZZZZZZZZMiniAppApi.gs"));
  assert.equal(identity.clientPortalSha256, sha256("ZZZZZZZZZZZClientPortal.gs"));
  assert.equal(identity.clientPortalHandlerLoaded, true);
});

test("runtime identity fails its load marker when the portal module is absent", () => {
  const identity = createContext({ clientPortalHandlerLoaded: false })
    .getDmsRuntimeIdentity_();
  assert.equal(identity.clientPortalHandlerLoaded, false);
});

test("default GET response remains backward-compatible", () => {
  const response = createContext().doGet({ parameter: {} });
  assert.equal(response.text, "DMS Fitness Telegram integration is running.");
  assert.equal(response.mimeType, "text/plain");
});
