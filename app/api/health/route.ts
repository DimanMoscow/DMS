import { isDmsBackendConfigured } from "@/lib/dms-server-config";
import {
  getMiniAppSourceRevision,
  MINIAPP_RELEASE,
  MINIAPP_RUNTIME_FINGERPRINT,
} from "@/lib/release-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "dms-fitness-miniapp",
      release: MINIAPP_RELEASE,
      runtimeFingerprint: MINIAPP_RUNTIME_FINGERPRINT,
      sourceRevision: getMiniAppSourceRevision(),
      dataMode: isDmsBackendConfigured() ? "connected" : "not-configured",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
