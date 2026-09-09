export const EXPECTED_APPS_SCRIPT_RUNTIME = {
  "service": "dms-fitness-apps-script",
  "release": "p1-scheduled-automation-health",
  "routerSha256": "fe206783b972575e9265cb1c5fc172661814b83662e0603d88c8b8a93000783f",
  "clientPortalSha256": "8175d6dc221392814d284d209720d0a65b25f704e32818cdf8e3103ee05935ec",
  "telegramConfirmationsSha256": "b4b53f34f3c9a44d2d8ea57d0bcdd27c77fa5a75603b2b3b9348fa7dd5521ba4"
} as const;

export function matchesAppsScriptRuntime(identity: Record<string, unknown>) {
  return identity.ok === true && identity.clientPortalHandlerLoaded === true &&
    identity.telegramConfirmationsHandlerLoaded === true &&
    Object.entries(EXPECTED_APPS_SCRIPT_RUNTIME).every(([key, value]) => identity[key] === value);
}
