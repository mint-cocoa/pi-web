import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DotClient } from "./vendor/dot-client/server.mjs";
import { pythonFetch } from "./vendor/dot-client/python-http.mjs";
import { createPiCredentialProvider } from "./pi-credentials.mjs";
import { registerDotPlugin } from "./plugin.mjs";

export default function dotExtension(pi: ExtensionAPI) {
  registerDotPlugin(pi, new DotClient(createPiCredentialProvider(), { fetch: pythonFetch }));
}
