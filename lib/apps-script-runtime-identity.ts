export const EXPECTED_APPS_SCRIPT_RUNTIME = {
  "service": "dms-fitness-apps-script",
  "release": "emergency-semantic-recovery",
  "routerSha256": "845880a146750df5f7d94ceae4ddfcb533fe2f995d566b26a1635630721ffbd7",
  "clientPortalSha256": "763e56aebc3bd07db8bae8e70e33e40ea3ab29856f7fb9ed408c482e979e4b98",
  "telegramConfirmationsSha256": "cdf03fac0af9b7757c0ba5090817fadac35819ff9685c4afba6ac4590b1fbb7e"
} as const;

const VERIFIED_V57_RUNTIME = {
  service: "dms-fitness-apps-script",
  release: "post-burn-in-audit",
  routerSha256: "161d134be312bf1e35206e31f290c670f930b16daaa9c3f50559b6e5d7dd4866",
  clientPortalSha256: "763e56aebc3bd07db8bae8e70e33e40ea3ab29856f7fb9ed408c482e979e4b98",
  telegramConfirmationsSha256: "b2e901820acae7e6453d57d562d244caeb916abb1a190583c95e0318a1460ba5",
} as const;

// Immutable Web phase, never a request/env override. A later reviewed Web commit
// removes v56 after completed natural v57 sync. Full source is owner-attested;
// the public probe only carries the existing P1 identity fields below.
export const RUNTIME_MIGRATION = {
  phase: "v56-v57-transition",
  contract: "dms-exact-runtime-transition-1",
  identities: [
    { version: 56, sourceCommit: "4ab73e2103e85c3e0dd199ac220db51d2ccd61d3",
      sourceTreeSha256: "873ec728daf92883c31f67eed8857b092360a7fe1fbba3e3d30d316379470a7d",
      runtime: EXPECTED_APPS_SCRIPT_RUNTIME },
    { version: 57, sourceCommit: "af99236e18b1dd13273768171972063dc11af6eb",
      sourceTreeSha256: "332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c",
      runtime: VERIFIED_V57_RUNTIME },
  ],
} as const;

export function admittedAppsScriptRuntime(identity: Record<string, unknown>) {
  if (!identity || identity.ok !== true || identity.clientPortalHandlerLoaded !== true ||
      identity.telegramConfirmationsHandlerLoaded !== true) return undefined;
  return RUNTIME_MIGRATION.identities.find(entry =>
    Object.entries(entry.runtime).every(([key, value]) => identity[key] === value));
}

export function matchesAppsScriptRuntime(identity: Record<string, unknown>) {
  return admittedAppsScriptRuntime(identity) !== undefined;
}
