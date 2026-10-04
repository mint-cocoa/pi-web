import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DotError } from "./vendor/dot-client/core.mjs";

/** Pi owns credential locking and refresh. No auth.json copies or second refresh implementation. */
export function createPiCredentialProvider() {
  let pending;
  return {
    async get(signal) {
      signal?.throwIfAborted();
      if (!pending) {
        pending = (async () => {
          const runtime = await ModelRuntime.create({ refreshOnCreate: false });
          const provider = runtime.getProvider("openai-codex");
          if (!provider || new URL(provider.baseUrl ?? "").origin !== "https://chatgpt.com") {
            throw new DotError("invalid_provider", "Dot requires the official ChatGPT subscription provider.", { status: 403 });
          }
          const resolved = await runtime.getAuth("openai-codex");
          const accessToken = resolved?.auth.apiKey;
          if (!accessToken) throw new DotError("sign_in_required", "Sign in to ChatGPT Plus/Pro in Models first.", { status: 401 });
          let accountId;
          try {
            const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
            accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
          } catch { /* Never include the token or underlying parser error in a response. */ }
          if (typeof accountId !== "string" || !accountId) throw new DotError("invalid_credential", "The subscription credential has no account identifier.", { status: 401 });
          return { accessToken, accountId };
        })().catch((error) => {
          if (error instanceof DotError) throw error;
          throw new DotError("sign_in_required", "Subscription authentication is unavailable. Sign in again in Models.", { status: 401 });
        }).finally(() => { pending = null; });
      }
      const credential = await pending;
      signal?.throwIfAborted();
      return credential;
    },
  };
}
