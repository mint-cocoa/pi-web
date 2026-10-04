import { assertId, DotError } from "@/packages/dot-client/core.mjs";
import { getDotServices } from "@/lib/dot/runtime";
import { guardDotRequest, dotErrorResponse } from "@/lib/dot/http";
import { hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    guardDotRequest(request);
    const threadId = new URL(request.url).searchParams.get("threadId");
    if (threadId) assertId(threadId);
    const { client } = await getDotServices(request.signal);
    const data = threadId ? await client.snapshot(threadId, request.signal) : await client.list(request.signal);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return dotErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    guardDotRequest(request);
    if (!hasJsonContentType(request)) throw new DotError("invalid_content_type", "JSON content is required.", { status: 415 });
    const raw = await request.text();
    if (raw.length > 80000) throw new DotError("request_too_large", "Request exceeded the size limit.", { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { throw new DotError("invalid_json", "Invalid JSON request.", { status: 400 }); }
    if (!body || typeof body !== "object" || !["send", "computer"].includes(body.action)) {
      throw new DotError("invalid_action", "Unknown dot action.", { status: 400 });
    }
    const threadId = assertId(body.threadId);
    if (body.action === "send") {
      assertId(body.requestId);
      if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 16000) {
        throw new DotError("invalid_message", "Message must contain 1–16000 characters.", { status: 400 });
      }
    } else if (typeof body.offer !== "string" || body.offer.length > 64000 || !body.offer.startsWith("v=0") || !body.offer.includes("m=video")) {
      throw new DotError("invalid_sdp", "Invalid computer session offer.", { status: 400 });
    }
    const { client } = await getDotServices(request.signal);
    const result = body.action === "send"
      ? await client.send(threadId, body.text, body.requestId, request.signal)
      : { sdp: await client.computerOffer(threadId, body.offer, request.signal) };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return dotErrorResponse(error); }
}
