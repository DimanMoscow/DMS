export const EXPECTED_APPS_SCRIPT_RUNTIME = {
  "service": "dms-fitness-apps-script",
  "release": "calendar-ingestion-stabilization",
  "routerSha256": "fe206783b972575e9265cb1c5fc172661814b83662e0603d88c8b8a93000783f",
  "clientPortalSha256": "8175d6dc221392814d284d209720d0a65b25f704e32818cdf8e3103ee05935ec",
  "telegramConfirmationsSha256": "4e96c3ac5242083f1ab39bfcfdfbdd148be76723e7ffd7e2f0ebb71a615e6f5b"
} as const;

export function matchesAppsScriptRuntime(identity: Record<string, unknown>) {
  return identity.ok === true && identity.clientPortalHandlerLoaded === true &&
    identity.telegramConfirmationsHandlerLoaded === true &&
    Object.entries(EXPECTED_APPS_SCRIPT_RUNTIME).every(([key, value]) => identity[key] === value);
}
