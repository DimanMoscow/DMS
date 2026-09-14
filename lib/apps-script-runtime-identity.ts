export const EXPECTED_APPS_SCRIPT_RUNTIME = {
  "service": "dms-fitness-apps-script",
  "release": "post-burn-in-audit",
  "routerSha256": "161d134be312bf1e35206e31f290c670f930b16daaa9c3f50559b6e5d7dd4866",
  "clientPortalSha256": "763e56aebc3bd07db8bae8e70e33e40ea3ab29856f7fb9ed408c482e979e4b98",
  "telegramConfirmationsSha256": "b2e901820acae7e6453d57d562d244caeb916abb1a190583c95e0318a1460ba5"
} as const;

export function matchesAppsScriptRuntime(identity: Record<string, unknown>) {
  return identity.ok === true && identity.clientPortalHandlerLoaded === true &&
    identity.telegramConfirmationsHandlerLoaded === true &&
    Object.entries(EXPECTED_APPS_SCRIPT_RUNTIME).every(([key, value]) => identity[key] === value);
}
