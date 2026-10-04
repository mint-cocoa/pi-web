import test from "node:test";
import assert from "node:assert/strict";
import { registerDotPlugin } from "../plugin.mjs";

test("the agent receives read-only tools; only an explicitly invoked command can send text", async () => {
  const tools = new Map(), commands = new Map(), messages = [];
  const pi = { registerTool(tool) { tools.set(tool.name, tool); }, registerCommand(name, value) { commands.set(name, value); }, on() {}, async sendMessage(message, options) { messages.push({ message, options }); } };
  let sends = 0;
  const client = { async list() { return []; }, async resolve() { return {}; }, async environment() { return { status: "ready" }; },
    async messages() { return { messages: [] }; }, async send(thread, text) { sends++; assert.equal(thread, "thread-1"); assert.equal(text, "hello dot"); return { accepted: true }; } };
  registerDotPlugin(pi, client);
  assert.deepEqual([...tools.keys()], ["dot_list", "dot_status", "dot_messages"]);
  const result = await tools.get("dot_list").execute("id", {});
  assert.deepEqual(result.structuredContent, []); assert.equal(sends, 0);
  const ctx = { ui: { notify() {} } };
  await commands.get("dot-send").handler("", ctx); assert.equal(sends, 0);
  await commands.get("dot-send").handler("thread-1 hello dot", ctx);
  assert.equal(sends, 1); assert.equal(messages[0].options.triggerTurn, false);
});
