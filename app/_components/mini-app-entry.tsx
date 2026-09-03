"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getMiniAppEntryMode } from "@/lib/telegram-init-data";
import { ClientPortal } from "../client/client-portal";
import { MiniAppShell } from "./mini-app-shell";

type EntryRole = "admin" | "client" | "unlinked";
type EntryResponse = { ok: boolean; error?: string; data?: { role?: string } };

async function resolveMiniAppEntry(initData: string): Promise<EntryRole> {
  const response = await fetch("/api/dms", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData, action: "resolve_miniapp_entry" }),
    signal: AbortSignal.timeout(25_000),
  });
  const result = (await response.json()) as EntryResponse;
  const role = result.data?.role;
  if (!response.ok || !result.ok || !["admin", "client", "unlinked"].includes(role || "")) {
    throw new Error(result.error || "invalid_upstream_response");
  }
  return role as EntryRole;
}

export function MiniAppEntry() {
  const hydrated = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [role, setRole] = useState<EntryRole | "loading" | "fallback">("loading");
  const initData = hydrated ? (window.Telegram?.WebApp?.initData ?? "") : "";
  const mode = getMiniAppEntryMode(initData);

  useEffect(() => {
    if (!hydrated || !initData || mode === "client-enrollment") return;
    let active = true;
    resolveMiniAppEntry(initData)
      .then((nextRole) => { if (active) setRole(nextRole); })
      .catch(() => { if (active) setRole("fallback"); });
    return () => { active = false; };
  }, [hydrated, initData, mode]);

  if (!hydrated) return null;
  if (mode === "client-enrollment") return <ClientPortal />;
  if (!initData) return <MiniAppShell />;
  if (role === "admin") return <MiniAppShell />;
  if (role === "client" || role === "unlinked" || role === "fallback") return <ClientPortal />;
  return <main className="app-shell"><aside className="state-card">
    <span className="spinner" />Определяю доступ…
  </aside></main>;
}
