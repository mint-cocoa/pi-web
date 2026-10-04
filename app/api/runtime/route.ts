import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { executionProvider, runtimeInfo } from "@/lib/runtime/manager";
import type { RuntimeTarget } from "@/lib/runtime/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failed(error: unknown) { return Response.json({ error: error instanceof Error ? error.message : "Runtime request failed." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const target = { connectionId: params.get("connectionId") || "local", backend: params.get("backend") || "pi" } as RuntimeTarget;
  try {
    if (params.get("action") === "info") return Response.json(await runtimeInfo(target), { headers: { "Cache-Control": "no-store" } });
    const provider = executionProvider(target);
    return Response.json(params.get("action") === "models" ? { models: await provider.models() } : params.get("sessionId") ? await provider.open({ ...target, id: params.get("sessionId")! }) : { sessions: await provider.list() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request." }, { status: 403 });
  if (!hasJsonContentType(request)) return Response.json({ error: "JSON required." }, { status: 415 });
  try {
    const raw = await request.text(); if (Buffer.byteLength(raw, "utf8") > 120000) throw new Error("Request too large.");
    const input = JSON.parse(raw), target = (input.target || input.ref) as RuntimeTarget;
    const provider = executionProvider(target);
    if (input.action === "create") return Response.json(await provider.create(input.options));
    if (input.action === "open") return Response.json(await provider.open(input.ref));
    if (input.action === "send") return Response.json(await provider.send(input.ref, input.message));
    if (input.action === "interrupt") return Response.json(await provider.interrupt(input.ref));
    if (input.action === "reply") return Response.json(await provider.reply(input.ref, input.requestId, input.answer));
    throw new Error("Unsupported runtime operation.");
  } catch (error) { return failed(error); }
}
