export const MINIAPP_RELEASE = "0.2.6";

export const MINIAPP_RUNTIME_FINGERPRINT =
  "miniapp-r7-api-no-store";

const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40}$/i;

export function getMiniAppSourceRevision() {
  const candidate = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return SOURCE_REVISION_PATTERN.test(candidate) ? candidate.toLowerCase() : "unavailable";
}
