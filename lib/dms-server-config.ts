export function getDmsAppsScriptUrl() {
  return process.env.DMS_APPS_SCRIPT_URL?.trim() || undefined;
}

export function isDmsBackendConfigured() {
  return Boolean(getDmsAppsScriptUrl());
}
