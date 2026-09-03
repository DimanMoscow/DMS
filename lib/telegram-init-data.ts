export type MiniAppEntryMode = "role-resolution" | "client-enrollment";

export function getSignedStartParam(initData: string) {
  try {
    return new URLSearchParams(initData).get("start_param")?.trim() ?? "";
  } catch {
    return "";
  }
}

export function getMiniAppEntryMode(initData: string): MiniAppEntryMode {
  return getSignedStartParam(initData) ? "client-enrollment" : "role-resolution";
}
