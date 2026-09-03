import assert from "node:assert/strict";
import test from "node:test";

import {
  getMiniAppEntryMode,
  getSignedStartParam,
} from "../lib/telegram-init-data.ts";

test("Main Mini App routes signed start_param launches to enrollment", () => {
  const token = "invalid_smoke_00000000000000000000000000000";
  const initData = new URLSearchParams({
    auth_date: "1788378504",
    query_id: "test",
    start_param: token,
    hash: "test",
  }).toString();

  assert.equal(getSignedStartParam(initData), token);
  assert.equal(getMiniAppEntryMode(initData), "client-enrollment");
});

test("ordinary bot menu launches require server role resolution", () => {
  const initData = new URLSearchParams({
    auth_date: "1788378504",
    query_id: "test",
    hash: "test",
  }).toString();

  assert.equal(getSignedStartParam(initData), "");
  assert.equal(getMiniAppEntryMode(initData), "role-resolution");
});
