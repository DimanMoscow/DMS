const CANONICAL_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwVqAML0_4L8Geee5tKZsjKJpwPUvf1cUuQg-YMKRPT-VYXqn8ce381HoMUAwJboBRn/exec";

export function getDmsAppsScriptUrl() {
  return process.env.DMS_APPS_SCRIPT_URL?.trim() || CANONICAL_APPS_SCRIPT_URL;
}

export function isDmsBackendConfigured() {
  return Boolean(getDmsAppsScriptUrl());
}
