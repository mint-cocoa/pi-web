import { DotError } from "@/packages/dot-client/core.mjs";
import { isApiRequestAllowed } from "@/lib/request-security";

export function guardDotRequest(request: Request) {
  if (!isApiRequestAllowed(request)) throw new DotError("untrusted_request", "Untrusted API request.", { status: 403 });
}

export function dotErrorResponse(error: unknown) {
  const known = error instanceof DotError || (error instanceof Error && error.name === "DotError");
  const value = known ? error as DotError : new DotError("request_failed", "The dot request failed.");
  return Response.json({ error: value.message, code: value.code, deliveryUnknown: value.deliveryUnknown }, {
    status: value.status >= 400 && value.status <= 599 ? value.status : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
