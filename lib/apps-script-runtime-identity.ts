export const EXPECTED_APPS_SCRIPT_RUNTIME = {
  "service": "dms-fitness-apps-script",
  "release": "emergency-semantic-recovery",
  "routerSha256": "845880a146750df5f7d94ceae4ddfcb533fe2f995d566b26a1635630721ffbd7",
  "clientPortalSha256": "763e56aebc3bd07db8bae8e70e33e40ea3ab29856f7fb9ed408c482e979e4b98",
  "telegramConfirmationsSha256": "cdf03fac0af9b7757c0ba5090817fadac35819ff9685c4afba6ac4590b1fbb7e"
} as const;

export function matchesAppsScriptRuntime(identity: Record<string, unknown>) {
  return identity.ok === true && identity.clientPortalHandlerLoaded === true &&
    identity.telegramConfirmationsHandlerLoaded === true &&
    Object.entries(EXPECTED_APPS_SCRIPT_RUNTIME).every(([key, value]) => identity[key] === value);
}
