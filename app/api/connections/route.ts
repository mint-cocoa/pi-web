import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { listConnections, saveConnection, removeConnection, connectConnection, disconnectConnection, refreshConnection, readRemoteSession } from "@/lib/connections/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  // No raw OS/process errors in browser responses.
  const message = error instanceof Error && !/^(E[A-Z]+|Unexpected token)/.test(error.message) ? error.message : "Remote connection request failed.";
  return Response.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request." }, { status: 403 });
  try { return Response.json(await listConnections(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request." }, { status: 403 });
  if (!hasJsonContentType(request)) return Response.json({ error: "JSON required." }, { status: 415 });
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw new Error("Request is too large.");
    const input = JSON.parse(raw);
    if (!input || typeof input !== "object") throw new Error("Invalid request.");
    if (input.action === "save") {
      if (typeof input.alias !== "string" || typeof input.label !== "string" || (input.id !== undefined && typeof input.id !== "string")) throw new Error("Invalid connection fields.");
      return Response.json(await saveConnection(input));
    }
    if (typeof input.id !== "string") throw new Error("Connection id is required.");
    if (input.action === "remove") { await removeConnection(input.id); return Response.json({ removed: true }); }
    if (input.action === "connect") return Response.json(await connectConnection(input.id));
    if (input.action === "disconnect") return Response.json(await disconnectConnection(input.id));
    if (input.action === "refresh") return Response.json(await refreshConnection(input.id));
    if (input.action === "transcript" && typeof input.sessionId === "string") return Response.json(await readRemoteSession(input.id, input.sessionId), { headers: { "Cache-Control": "no-store" } });
    throw new Error("Unsupported connection operation.");
  } catch (error) { return failure(error); }
}
