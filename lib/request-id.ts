const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,180}$/;

export function getSafeRequestId(request: Request) {
  const candidate = request.headers.get("x-vercel-id")?.trim() || "";
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : crypto.randomUUID();
}
