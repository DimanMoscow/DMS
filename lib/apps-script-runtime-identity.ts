export const EXPECTED_APPS_SCRIPT_RUNTIME = {
  service: "dms-fitness-apps-script",
  release: "calendar-onboarding-r8-production-guards",
  routerSha256: "fe206783b972575e9265cb1c5fc172661814b83662e0603d88c8b8a93000783f",
  clientPortalSha256: "5b1e75207fce0184a89870848b79e1b0eea738359ccd11d0c17684902b34ebf5",
  telegramConfirmationsSha256: "3122547e3eb8631756071eae2b1e62fb43acb6c2c698bb2eb4471e7fd58a7584",
} as const;

// Exact temporary bridge; remove v50 only after the combined backend rollout.
export const CANDIDATE_APPS_SCRIPT_RUNTIME = {
  "service": "dms-fitness-apps-script",
  "release": "calendar-onboarding-r8-production-guards",
  "routerSha256": "fe206783b972575e9265cb1c5fc172661814b83662e0603d88c8b8a93000783f",
  "clientPortalSha256": "8175d6dc221392814d284d209720d0a65b25f704e32818cdf8e3103ee05935ec",
  "telegramConfirmationsSha256": "1dc817c07a7bbc09a39ac93e2c17adee2fd8a4587d18319499baae2221cf49ce"
} as const;

export function matchesAppsScriptRuntime(identity: Record<string, unknown>) {
  return identity.ok === true && identity.clientPortalHandlerLoaded === true &&
    identity.telegramConfirmationsHandlerLoaded === true &&
    [EXPECTED_APPS_SCRIPT_RUNTIME, CANDIDATE_APPS_SCRIPT_RUNTIME].some(expected =>
      Object.entries(expected).every(([key, value]) => identity[key] === value));
}
