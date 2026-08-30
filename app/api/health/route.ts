import { isDmsBackendConfigured } from "@/lib/dms-server-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "dms-fitness-miniapp",
      release: "0.2.1",
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
