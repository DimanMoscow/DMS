"use client";

import { useSyncExternalStore } from "react";
import { getMiniAppEntryMode } from "@/lib/telegram-init-data";
import { ClientPortal } from "../client/client-portal";
import { MiniAppShell } from "./mini-app-shell";

export function MiniAppEntry() {
  const hydrated = useSyncExternalStore(() => () => undefined, () => true, () => false);
  if (!hydrated) return null;

  const initData = window.Telegram?.WebApp?.initData ?? "";
  return getMiniAppEntryMode(initData) === "client-enrollment"
    ? <ClientPortal />
    : <MiniAppShell />;
}
