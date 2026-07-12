const DEFAULT_MAX_BYTES = 64 * 1024;

export type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

export async function readBoundedJson(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<JsonResult> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, response: Response.json({ error: "JSON形式で送信してください。" }, { status: 415 }) };
  }
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, response: Response.json({ error: "送信内容が大きすぎます。" }, { status: 413 }) };
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    return { ok: false, response: Response.json({ error: "送信内容が大きすぎます。" }, { status: 413 }) };
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, response: Response.json({ error: "JSONを読み取れませんでした。" }, { status: 400 }) };
  }
}
