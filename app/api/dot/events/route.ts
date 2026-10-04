import { assertId } from "@/packages/dot-client/core.mjs";
import { getDotServices } from "@/lib/dot/runtime";
import { guardDotRequest, dotErrorResponse } from "@/lib/dot/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    guardDotRequest(request);
    const threadId = assertId(new URL(request.url).searchParams.get("threadId"));
    const services = await getDotServices(request.signal);
    const encoder = new TextEncoder();
    let stop: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      stop?.();
      clearInterval(heartbeat);
      request.signal.removeEventListener("abort", cleanup);
    };
    const stream = new ReadableStream({
      start(controller) {
        stop = services.runtime.subscribe(threadId, (event) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
          catch { cleanup(); }
        });
        heartbeat = setInterval(() => {
          if (!closed) { try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { cleanup(); } }
        }, 15000);
        request.signal.addEventListener("abort", cleanup, { once: true });
        if (request.signal.aborted) cleanup();
      },
      cancel: cleanup,
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store",
      "X-Accel-Buffering": "no", Connection: "keep-alive",
    } });
  } catch (error) { return dotErrorResponse(error); }
}
