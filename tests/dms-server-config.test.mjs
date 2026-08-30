import assert from "node:assert/strict";
import test from "node:test";

import {
  getDmsAppsScriptUrl,
  isDmsBackendConfigured,
} from "../lib/dms-server-config.ts";

test("Apps Script backend requires explicit server-only configuration", () => {
  const previous = process.env.DMS_APPS_SCRIPT_URL;

  try {
    delete process.env.DMS_APPS_SCRIPT_URL;
    assert.equal(getDmsAppsScriptUrl(), undefined);
    assert.equal(isDmsBackendConfigured(), false);

    process.env.DMS_APPS_SCRIPT_URL = "   ";
    assert.equal(getDmsAppsScriptUrl(), undefined);
    assert.equal(isDmsBackendConfigured(), false);

    process.env.DMS_APPS_SCRIPT_URL = " https://example.invalid/apps-script ";
    assert.equal(getDmsAppsScriptUrl(), "https://example.invalid/apps-script");
    assert.equal(isDmsBackendConfigured(), true);
  } finally {
    if (previous === undefined) {
      delete process.env.DMS_APPS_SCRIPT_URL;
    } else {
      process.env.DMS_APPS_SCRIPT_URL = previous;
    }
  }
});
