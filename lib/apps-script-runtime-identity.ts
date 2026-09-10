export const EXPECTED_APPS_SCRIPT_RUNTIME = {
  "service": "dms-fitness-apps-script",
  "release": "system-stabilization",
  "routerSha256": "c3fa2b044a4bc591d18103a475d0c6a92fd5252d3faf123ba7ba16f395acba39",
  "clientPortalSha256": "763e56aebc3bd07db8bae8e70e33e40ea3ab29856f7fb9ed408c482e979e4b98",
  "telegramConfirmationsSha256": "2b0c01e90f0c03242ff2b249a60abd1f065927f6956893f41f28634ebedd1e61"
} as const;

export function matchesAppsScriptRuntime(identity: Record<string, unknown>) {
  return identity.ok === true && identity.clientPortalHandlerLoaded === true &&
    identity.telegramConfirmationsHandlerLoaded === true &&
    Object.entries(EXPECTED_APPS_SCRIPT_RUNTIME).every(([key, value]) => identity[key] === value);
}
