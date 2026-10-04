import { DotClient, DotRuntime } from "@/packages/dot-client/server.mjs";
import { DotError } from "@/packages/dot-client/core.mjs";
import { pythonFetch } from "@/packages/dot-client/python-http.mjs";
import { createPiCredentialProvider } from "@/packages/pi-dot/pi-credentials.mjs";

const credentials = createPiCredentialProvider();
type Services = { accountId: string; client: DotClient; runtime: DotRuntime };
declare global { var __piDotServices: Services | undefined; }

export async function getDotServices(signal?: AbortSignal): Promise<Services> {
  const { accountId } = await credentials.get(signal);
  if (globalThis.__piDotServices?.accountId !== accountId) {
    globalThis.__piDotServices?.runtime.close();
    const client = new DotClient({
      async get(requestSignal) {
        const current = await credentials.get(requestSignal);
        if (current.accountId !== accountId) throw new DotError("account_changed", "The subscription account changed.", { status: 409 });
        return current;
      },
    }, { fetch: pythonFetch });
    globalThis.__piDotServices = { accountId, client, runtime: new DotRuntime(client) };
  }
  return globalThis.__piDotServices;
}
