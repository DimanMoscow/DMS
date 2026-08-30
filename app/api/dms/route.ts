import { getDmsAppsScriptUrl } from "@/lib/dms-server-config";

export const dynamic = "force-dynamic";

const actions = new Set(["bootstrap", "client", "health", "set_queue_decision", "confirm_day"]);

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-vercel-id") || "";
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

  const backendUrl = getDmsAppsScriptUrl();
  if (!backendUrl) {
    console.error(JSON.stringify({
      level: "error",
      message: "dms_backend_not_configured",
      action,
      requestId,
    }));
    return Response.json({ ok: false, error: "backend_not_configured" }, { status: 503 });
  }

  console.log(JSON.stringify({
    level: "info",
    message: "dms_request_started",
    action,
    requestId,
  }));

  try {
    const upstream = await fetch(backendUrl, {
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
      console.error(JSON.stringify({
        level: "error",
        message: "dms_upstream_invalid_response",
        action,
        requestId,
        upstreamStatus: upstream.status,
        durationMs: Date.now() - startedAt,
      }));
      return Response.json({ ok: false, error: "invalid_upstream_response" }, { status: 502 });
    }
    const status = Number(result.status);
    const responseStatus = status >= 400 && status <= 599 ? status : upstream.ok ? 200 : 502;
    const log = responseStatus >= 400 ? console.error : console.log;
    log(JSON.stringify({
      level: responseStatus >= 400 ? "error" : "info",
      message: responseStatus >= 400 ? "dms_request_failed" : "dms_request_completed",
      action,
      requestId,
      upstreamStatus: upstream.status,
      responseStatus,
      error: typeof result.error === "string" ? result.error : "",
      durationMs: Date.now() - startedAt,
    }));
    return Response.json(result, {
      status: responseStatus,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "dms_backend_unavailable",
      action,
      requestId,
      error: error instanceof Error ? error.name : "unknown",
      durationMs: Date.now() - startedAt,
    }));
    return Response.json({ ok: false, error: "backend_unavailable" }, { status: 503 });
  }
}
