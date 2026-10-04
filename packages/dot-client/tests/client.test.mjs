import test from "node:test";
import assert from "node:assert/strict";
import { DotClient, DotRuntime } from "../server.mjs";
import { encodeMove, encodeKey, encodeWheel, videoCoordinates, normalizeMessage, decodeSse } from "../core.mjs";
import { ComputerSession } from "../browser.mjs";

const dot = { id: "dot~1", active_root_thread_id: "thread-1", messaging_room_id: "room-1", display_name: "My dot", status: "active" };
const credential = { get: async () => ({ accessToken: "private-test-token", accountId: "account-1" }) };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("computer packets match the captured uint16/uint64 little-endian protocol", () => {
  assert.deepEqual([...new Uint8Array(encodeMove(500, 300))], [1, 4, 0, 244, 1, 44, 1]);
  assert.deepEqual([...new Uint8Array(encodeKey(1, true))], [3, 8, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...new Uint8Array(encodeKey(1, false))], [4, 8, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...new Uint8Array(encodeWheel(-2, 3))], [2, 4, 0, 254, 255, 3, 0]);
  assert.throws(() => encodeMove(-1, 0));
});

test("letterbox coordinates reject black bars and scale to original pixels", () => {
  assert.equal(videoCoordinates(20, 20, 800, 800, 1600, 800), null);
  assert.deepEqual(videoCoordinates(250, 350, 800, 800, 1600, 800), { x: 500, y: 300 });
  assert.equal(videoCoordinates(0, 0, 0, 800, 1600, 800), null);
});

test("history omits internal/deleted messages and upstream metadata", () => {
  assert.equal(normalizeMessage({ id: "1", role: "system", content: { text: "hidden" } }), null);
  assert.equal(normalizeMessage({ id: "1", role: "assistant", channel: "analysis", content: { text: "hidden" } }), null);
  assert.equal(normalizeMessage({ id: "1", role: "user", deleted_at: "now", content: { text: "deleted" } }), null);
  const result = normalizeMessage({ id: "1", role: "user", content: { text: "hello" }, account_user_id: "private" });
  assert.equal(result.text, "hello"); assert.equal("account_user_id" in result, false);
});

test("messaging role=user for a dot is mapped through room membership, not guessed from JWT identity", () => {
  const members = [{ account_user_id: "human", name: "Human" }, { account_user_id: "bot", aeon_id: "dot-1", name: "Dot" }];
  const value = { id: "1", role: "user", account_user_id: "bot", content: { text: "hello" } };
  assert.equal(normalizeMessage(value, members, "dot-1").role, "assistant");
  assert.equal(normalizeMessage(value, members, "dot-1").authorName, "Dot");
  assert.equal(normalizeMessage({ ...value, account_user_id: "human" }, members, "dot-1").role, "user");
});

test("path injection is rejected before any credential resolution", async () => {
  let calls = 0;
  const client = new DotClient({ get: async () => { calls++; return credential.get(); } });
  await assert.rejects(client.resolve("../auth"), { code: "invalid_id" });
  assert.equal(calls, 0);
});

test("authenticated requests use the fixed origin and serialize only safe snapshots", async () => {
  const urls = [];
  const client = new DotClient(credential, { fetch: async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer private-test-token");
    if (url.includes("by-thread")) return json(dot);
    if (url.includes("environment/status")) return json({ status: "connected", capabilities: [{ type: "remote_desktop", status: "ready", error: null }], token: "secret" });
    if (!url.includes("/messages?")) return json({ members: [], aeon_id: "dot~1" });
    return json({ items: [{ id: "msg-1", role: "user", content: { text: "hello" }, created_at: "2026-10-04T00:00:00Z" }] });
  } });
  const result = await client.snapshot("child-thread");
  assert.equal(result.dot.threadId, "child-thread");
  assert.equal(result.environment.status, "connected");
  assert.ok(urls.every((url) => url.startsWith("https://chatgpt.com/backend-api/")));
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.ok(!JSON.stringify(result).includes("private-test-token"));
});

test("history enforces the upstream maximum of 32 before making requests", async () => {
  let calls = 0;
  const client = new DotClient({ get: async () => { calls++; return credential.get(); } });
  await assert.rejects(client.messages({ roomId: "room-1" }, { limit: 33 }), { code: "invalid_limit" });
  assert.equal(calls, 0);
});

test("send follows the observed content/idempotency schema and never retries an ambiguous delivery", async () => {
  let posts = 0;
  const client = new DotClient(credential, { fetch: async (_url, options) => {
    if (options.method === "GET") return json(dot);
    posts++;
    const body = JSON.parse(options.body);
    assert.deepEqual(body, { content: { text: "hello", attachments: [] }, request_id: "request-1", idempotency_token: "request-1" });
    throw new Error("request headers included private-test-token");
  } });
  await assert.rejects(client.send("thread-1", "hello", "request-1"), (error) => {
    assert.equal(error.deliveryUnknown, true);
    assert.ok(!error.message.includes("private-test-token")); return true;
  });
  assert.equal(posts, 1);
});

test("upstream verification refusal remains an error and never bypasses a challenge", async () => {
  const client = new DotClient(credential, { fetch: async () => new Response("private challenge body", { status: 403 }) });
  await assert.rejects(client.list(), (error) => error.code === "access_denied" && !error.message.includes("private challenge body"));
});

test("SSE decoder handles split CRLF and multiline data, cancelling the reader", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('event: changed\r'));
    controller.enqueue(encoder.encode('\ndata: one\r\ndata: two\r\n\r\n'));
  }, cancel() { cancelled = true; } });
  for await (const event of decodeSse(stream)) {
    assert.deepEqual(event, { event: "changed", data: "one\ntwo" }); break;
  }
  assert.equal(cancelled, true);
});

test("runtime shares one refresh and aborts only after the final subscriber leaves", async () => {
  let calls = 0, signal;
  const runtime = new DotRuntime({ async snapshot(_id, requestSignal) {
    calls++; signal = requestSignal; return { dot: {} };
  } }, { intervalMs: 100000 });
  const received = [];
  const stop1 = runtime.subscribe("thread-1", (event) => received.push(event));
  const stop2 = runtime.subscribe("thread-1", () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(received[0].type, "snapshot");
  stop1(); assert.equal(signal.aborted, false);
  stop2(); assert.equal(signal.aborted, true); runtime.close();
});

function fakePeer() {
  const channel = { readyState: "open", sent: [], send(value) { this.sent.push(value); }, close() { this.readyState = "closed"; } };
  return { channel, connectionState: "new", addTransceiver() {}, createDataChannel() { return channel; },
    async createOffer() { return { sdp: "v=0\nm=video" }; }, async setLocalDescription() {},
    async setRemoteDescription(value) { this.answer = value; }, close() { this.closed = true; } };
}

test("input requires control/locked acknowledgement; held keys are released before relinquishing control", async () => {
  const peer = fakePeer();
  const computer = new ComputerSession(async () => "answer", { createPeer: () => peer });
  await computer.connect();
  assert.throws(() => computer.click(500, 300), { code: "control_required" });
  const grant = computer.requestControl();
  assert.equal(peer.channel.sent.length, 1);
  assert.equal(JSON.parse(peer.channel.sent[0]).event, "control/request");
  peer.channel.onmessage({ data: '{"event":"control/locked"}' });
  await grant;
  computer.click(500, 300);
  assert.equal(peer.channel.sent.length, 4);
  computer.key(0xffe3, true); computer.releaseControl();
  assert.equal(new DataView(peer.channel.sent.at(-2)).getUint8(0), 4);
  assert.equal(JSON.parse(peer.channel.sent.at(-1)).event, "control/release");
  assert.equal(computer.state.controlling, false); computer.close();
});

test("a stale SDP reply cannot attach to a closed computer session", async () => {
  const peer = fakePeer(); let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const computer = new ComputerSession(async () => response, { createPeer: () => peer });
  const pending = computer.connect();
  await new Promise((resolve) => setImmediate(resolve));
  computer.close(); finish("late-answer"); await pending;
  assert.equal(peer.answer, undefined); assert.equal(computer.state.connection, "disconnected");
});

test("control timeout releases a late grant rather than accepting it", async () => {
  const peer = fakePeer();
  const computer = new ComputerSession(async () => "answer", { createPeer: () => peer, controlTimeoutMs: 5 });
  await computer.connect();
  await assert.rejects(computer.requestControl(), { code: "control_timeout" });
  peer.channel.onmessage({ data: '{"event":"control/locked"}' });
  assert.equal(computer.state.controlling, false); computer.close();
});
