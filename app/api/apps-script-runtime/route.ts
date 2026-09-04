import { EXPECTED_APPS_SCRIPT_RUNTIME } from "@/lib/apps-script-runtime-identity";
import { getDmsAppsScriptUrl } from "@/lib/dms-server-config";

export const dynamic = "force-dynamic";

function jsonNoStore(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  const backendUrl = getDmsAppsScriptUrl();
  if (!backendUrl) {
    return jsonNoStore({ ok: false, error: "backend_not_configured" }, 503);
  }

  try {
    const probeUrl = new URL(backendUrl);
    probeUrl.searchParams.set("dms_runtime_identity", "1");
    probeUrl.searchParams.set("probe", `vercel-${Date.now()}`);
    const upstream = await fetch(probeUrl, {
      cache: "no-store",
      redirect: "follow",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const identity = await upstream.json() as Record<string, unknown>;
    const matches = upstream.ok &&
      identity.ok === true &&
      identity.service === EXPECTED_APPS_SCRIPT_RUNTIME.service &&
      identity.release === EXPECTED_APPS_SCRIPT_RUNTIME.release &&
      identity.routerSha256 === EXPECTED_APPS_SCRIPT_RUNTIME.routerSha256 &&
      identity.clientPortalSha256 === EXPECTED_APPS_SCRIPT_RUNTIME.clientPortalSha256 &&
      identity.clientPortalHandlerLoaded === true;

    if (!matches) {
      return jsonNoStore({ ok: false, error: "runtime_identity_mismatch" }, 502);
    }

    return jsonNoStore({
      ok: true,
      service: identity.service,
      release: identity.release,
      routerSha256: identity.routerSha256,
      clientPortalSha256: identity.clientPortalSha256,
      clientPortalHandlerLoaded: true,
    }, 200);
  } catch {
    return jsonNoStore({ ok: false, error: "runtime_identity_unavailable" }, 503);
  }
}
