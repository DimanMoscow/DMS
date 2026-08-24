export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "dms-fitness-miniapp",
      release: "0.2.0",
      dataMode: process.env.DMS_APPS_SCRIPT_URL ? "connected" : "not-configured",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
