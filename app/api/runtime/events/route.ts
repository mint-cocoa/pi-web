import { isApiRequestAllowed } from "@/lib/request-security";
import { executionProvider } from "@/lib/runtime/manager";
import type { SessionRef } from "@/lib/session-provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const ref = { connectionId: params.get("connectionId"), backend: params.get("backend"), id: params.get("sessionId") } as SessionRef;
  const encoder = new TextEncoder(); let dispose: (() => void) | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  let ended = false, finish: (() => void) | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      finish = () => { if (ended) return; ended = true; dispose?.(); if (heartbeat) clearInterval(heartbeat); request.signal.removeEventListener("abort", finish!); try { controller.close(); } catch {} };
      if (request.signal.aborted) { finish(); return; }
      request.signal.addEventListener("abort", finish, { once: true });
      try {
        dispose = await executionProvider(ref).watch(ref, snapshot => { if (!ended) controller.enqueue(encoder.encode(`id: ${snapshot.cursor}\ndata: ${JSON.stringify(snapshot)}\n\n`)); });
        if (ended) { dispose(); return; }
        heartbeat = setInterval(() => { if (!ended) controller.enqueue(encoder.encode(": heartbeat\n\n")); }, 15000);
      } catch { if (!ended) controller.enqueue(encoder.encode(`event: runtime-error\ndata: ${JSON.stringify({ error: "Could not attach to the runtime. Refresh the session." })}\n\n`)); finish(); }
    },
    cancel() { finish?.(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
