import { DotError, assertId, normalizeDot, normalizeMessage, decodeSse } from "./core.mjs";

const ORIGIN = "https://chatgpt.com";

async function limitedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new DotError("invalid_response", "Dot response exceeded the size limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const decoder = new TextDecoder();
  return chunks.map((part) => decoder.decode(part, { stream: true })).join("") + decoder.decode();
}

export class DotClient {
  constructor(credentials, options = {}) {
    this.credentials = credentials;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async request(path, options = {}) {
    const { method = "GET", body, mime = "application/json", signal, stream = false } = options;
    const credential = await this.credentials.get(signal);
    signal?.throwIfAborted();
    const headers = {
      Authorization: `Bearer ${credential.accessToken}`,
      "ChatGPT-Account-Id": credential.accountId,
      Originator: "Codex Browser", Origin: ORIGIN, Referer: `${ORIGIN}/`,
      Accept: stream ? "text/event-stream" : "application/json",
      ...(body !== undefined ? { "Content-Type": mime } : {}),
    };
    let response;
    try {
      response = await this.fetch(`${ORIGIN}/backend-api${path}`, {
        method, headers, body, redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
    } catch {
      signal?.throwIfAborted();
      throw new DotError("connection_failed", "Could not reach the dot service.", {
        status: 502, deliveryUnknown: method === "POST" && body !== undefined && mime === "application/json",
      });
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new DotError(response.status === 401 ? "sign_in_required" : response.status === 403 ? "access_denied" : "upstream_error",
        response.status === 403 ? "OpenAI refused this request; complete any required verification in the official client."
          : `Dot service returned HTTP ${response.status}.`, { status: response.status });
    }
    return stream ? response : limitedText(response);
  }

  async json(path, options) {
    const text = await this.request(path, options);
    try { return JSON.parse(text); }
    catch { throw new DotError("invalid_response", "Dot returned an invalid response.", { status: 502 }); }
  }

  async list(signal) {
    const value = await this.json("/tbo", { signal });
    if (!Array.isArray(value.items)) throw new DotError("invalid_response", "Invalid dot list.");
    return value.items.flatMap((item) => {
      if (!item.active_root_thread_id || !item.messaging_room_id) return [];
      return [normalizeDot(item)];
    });
  }

  async resolve(threadId, signal) {
    assertId(threadId);
    const dot = normalizeDot(await this.json(`/tbo/by-thread/${encodeURIComponent(threadId)}`, { signal }));
    // A selected child thread uses the same room/computer but must retain its own identifier.
    return { ...dot, threadId };
  }

  async messages(dot, { limit = 30, before, signal } = {}) {
    assertId(dot.roomId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new DotError("invalid_limit", "Limit must be between 1 and 32.", { status: 400 });
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set("before", assertId(before));
    const [value, room] = await Promise.all([
      this.json(`/messaging/rooms/${encodeURIComponent(dot.roomId)}/messages?${query}`, { signal }),
      this.json(`/messaging/rooms/${encodeURIComponent(dot.roomId)}`, { signal }),
    ]);
    if (!Array.isArray(value.items)) throw new DotError("invalid_response", "Invalid message list.");
    if (!Array.isArray(room.members)) throw new DotError("invalid_response", "Invalid message participants.");
    return {
      messages: value.items.map((message) => normalizeMessage(message, room.members, room.aeon_id)).filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      before: typeof value.prev_cursor === "string" ? value.prev_cursor : null,
    };
  }

  async environment(dot, signal) {
    assertId(dot.id); assertId(dot.threadId);
    const value = await this.json(`/tbo/${encodeURIComponent(dot.id)}/environment/status?thread_id=${encodeURIComponent(dot.threadId)}`, { signal });
    return {
      status: typeof value.status === "string" ? value.status : "unknown",
      capabilities: (Array.isArray(value.capabilities) ? value.capabilities : []).map((item) => ({
        type: String(item.type ?? "unknown"), status: String(item.status ?? "unknown"),
        error: item.error == null ? null : "Capability unavailable.",
      })),
    };
  }

  async snapshot(threadId, signal) {
    const dot = await this.resolve(threadId, signal);
    const [history, environment] = await Promise.all([this.messages(dot, { signal }), this.environment(dot, signal)]);
    return { dot, messages: history.messages, environment, capturedAt: new Date().toISOString() };
  }

  async send(threadId, text, requestId, signal) {
    assertId(requestId);
    if (typeof text !== "string" || !text.trim() || text.length > 16000) {
      throw new DotError("invalid_message", "Message must contain 1–16000 characters.", { status: 400 });
    }
    const dot = await this.resolve(threadId, signal);
    // Source: official web client's send() in 385910.71a81f043e.js.
    // No automatic retry: the acknowledgement can be lost after the message was accepted.
    await this.request(`/messaging/rooms/${encodeURIComponent(dot.roomId)}/messages`, {
      method: "POST", signal,
      body: JSON.stringify({ content: { text, attachments: [] }, request_id: requestId, idempotency_token: requestId }),
    });
    return { accepted: true, requestId };
  }

  async computerOffer(threadId, offer, signal) {
    if (typeof offer !== "string" || offer.length > 64000 || !offer.startsWith("v=0") || !offer.includes("m=video")) {
      throw new DotError("invalid_sdp", "Invalid computer session offer.", { status: 400 });
    }
    const dot = await this.resolve(threadId, signal);
    const answer = await this.request(`/tbo/${encodeURIComponent(dot.id)}/computer/sessions?thread_id=${encodeURIComponent(threadId)}`, {
      method: "POST", mime: "application/sdp", body: offer, signal,
    });
    if (!answer.startsWith("v=0") || !answer.includes("m=video")) throw new DotError("invalid_sdp", "Invalid computer session answer.");
    return answer;
  }

  async *live(threadId, signal) {
    const dot = await this.resolve(threadId, signal);
    const response = await this.request(`/messaging/rooms/${encodeURIComponent(dot.roomId)}/live`, {
      method: "POST", stream: true, signal,
    });
    if (!response.body) throw new DotError("invalid_response", "Dot event stream is empty.");
    // Room-live events indicate changes. Message bodies come from the history API.
    for await (const event of decodeSse(response.body, signal)) {
      if (event.event !== "ping") yield { type: "changed" };
    }
  }
}

/** A UI-independent, account-owned runtime. Subscriptions share one refresh loop. */
export class DotRuntime {
  constructor(client, { intervalMs = 5000 } = {}) {
    this.client = client;
    this.intervalMs = intervalMs;
    this.entries = new Map();
  }

  subscribe(threadId, listener) {
    assertId(threadId);
    let entry = this.entries.get(threadId);
    if (!entry) {
      entry = { listeners: new Set(), abort: new AbortController(), snapshot: null };
      this.entries.set(threadId, entry);
    }
    entry.listeners.add(listener);
    if (entry.snapshot) listener({ type: "snapshot", snapshot: entry.snapshot });
    if (!entry.running) {
      entry.running = this.run(threadId, entry);
    }
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size && this.entries.get(threadId) === entry) {
        this.entries.delete(threadId);
        entry.abort.abort();
      }
    };
  }

  async run(threadId, entry) {
    const signal = entry.abort.signal;
    const emit = (value) => { for (const listener of entry.listeners) { try { listener(value); } catch { /* Subscriber isolation. */ } } };
    while (!signal.aborted) {
      try {
        const snapshot = await this.client.snapshot(threadId, signal);
        if (signal.aborted) return;
        entry.snapshot = snapshot;
        emit({ type: "snapshot", snapshot });
      } catch (error) {
        if (signal.aborted) return;
        emit({ type: "error", code: error instanceof DotError ? error.code : "connection_failed" });
      }
      await new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, this.intervalMs);
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
    }
  }

  close() {
    for (const entry of this.entries.values()) entry.abort.abort();
    this.entries.clear();
  }
}
