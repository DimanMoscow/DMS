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

// Prepared source artifact, not an assigned Google numbered version or a live
// source attestation. Admission is one exact reviewed tuple, never a hash range.
export const ATTENTION_CANCELLATION_CANDIDATE = {
  version: null,
  candidate: "attention-checked-bootstrap-integrated",
  bootstrapSourceCommit: "b3f20bbccb4bfe6f92cf5935c7640d35b372e982",
  carrySourceCommit: "40a9e51bacf7babf4d2fa6e494bac68afab12545",
  sourceBaseCommit: "35c3f7c85960c3630f0653a42e2aff944c69758c",
  sourceTreeSha256: "df2382d9e578efa90d5c62c71fb87de61e678517fd10de139d25dc8c2538190a",
  runtime: {
    ...VERIFIED_V57_RUNTIME,
    telegramConfirmationsSha256: "af1c916b52356d0d8839f4031e666af9dfb9eadfe27a19ef6157957a0b1b5035",
  },
} as const;

// Immutable Web phase, never a request/env override. Removal of any exact rollback
// identity requires a later reviewed Web commit. Full source is owner-attested;
// the public probe only carries the existing P1 identity fields below.
export const RUNTIME_MIGRATION = {
  phase: "v56-v57-attention-checked-transition",
  contract: "dms-exact-runtime-transition-5",
  identities: [
    { version: 56, sourceCommit: "4ab73e2103e85c3e0dd199ac220db51d2ccd61d3",
      sourceTreeSha256: "873ec728daf92883c31f67eed8857b092360a7fe1fbba3e3d30d316379470a7d",
      runtime: EXPECTED_APPS_SCRIPT_RUNTIME },
    { version: 57, sourceCommit: "af99236e18b1dd13273768171972063dc11af6eb",
      sourceTreeSha256: "332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c",
      runtime: VERIFIED_V57_RUNTIME },
  ],
  candidates: [ATTENTION_CANCELLATION_CANDIDATE],
} as const;

export function admittedAppsScriptRuntime(identity: Record<string, unknown>) {
  if (!identity || identity.ok !== true || identity.clientPortalHandlerLoaded !== true ||
      identity.telegramConfirmationsHandlerLoaded !== true) return undefined;
  return [...RUNTIME_MIGRATION.identities, ...RUNTIME_MIGRATION.candidates].find(entry =>
    Object.entries(entry.runtime).every(([key, value]) => identity[key] === value));
}

export function matchesAppsScriptRuntime(identity: Record<string, unknown>) {
  return admittedAppsScriptRuntime(identity) !== undefined;
}
