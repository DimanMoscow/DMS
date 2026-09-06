import assert from "node:assert/strict";
import fs from "node:fs";

import { validateAuthorizationProfile } from "./check-credential-profile.mjs";

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPE_SETS = Object.freeze({
  reader: Object.freeze([
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/script.deployments.readonly",
    "https://www.googleapis.com/auth/script.projects.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]),
  writer: Object.freeze([
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/spreadsheets",
  ]),
});

export function loadAuthorizationProfile(profilePath, mode) {
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  validateAuthorizationProfile(profile, mode);
  return profile;
}

export async function refreshGoogleAccessToken(profile, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: profile.client_id,
    client_secret: profile.client_secret,
    refresh_token: profile.refresh_token,
    grant_type: "refresh_token",
  });
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `Google token refresh failed with HTTP ${response.status}`);
  assert.equal(typeof payload.access_token, "string", "Google token refresh returned no access token");
  assert.ok(payload.access_token.length >= 20, "Google access token is invalid");
  return payload.access_token;
}

export async function googleJson(accessToken, url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Google API returned non-JSON HTTP ${response.status}`);
    }
  }
  if (!response.ok) {
    const reason = String(payload?.error?.status || payload?.error || "request_failed");
    throw new Error(`Google API ${response.status}: ${reason}`);
  }
  return payload;
}
