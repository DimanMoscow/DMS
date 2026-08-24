import { getDmsAppsScriptUrl } from "@/lib/dms-server-config";

export const dynamic = "force-dynamic";

const actions = new Set(["bootstrap", "client", "health"]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const initData = typeof input.initData === "string" ? input.initData : "";
  const action = typeof input.action === "string" ? input.action : "bootstrap";
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};

  if (!initData || initData.length > 8192 || !actions.has(action)) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  try {
    const upstream = await fetch(getDmsAppsScriptUrl(), {
      method: "POST",
      redirect: "follow",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dmsMiniApp: "dms-fitness-miniapp",
        version: 1,
        initData,
        action,
        payload,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await upstream.text();
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return Response.json({ ok: false, error: "invalid_upstream_response" }, { status: 502 });
    }
    const status = Number(result.status);
    return Response.json(result, {
      status: status >= 400 && status <= 599 ? status : upstream.ok ? 200 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "backend_unavailable" }, { status: 503 });
  }
}
