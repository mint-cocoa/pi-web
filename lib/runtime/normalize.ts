import type { AgentMessage, AssistantMessage } from "../types";
import type { RuntimeRequest } from "./types";
export function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(item => item && typeof item === "object" && typeof item.text === "string" ? item.text : "").filter(Boolean).join("\n");
}
export function codexMessages(thread: { turns?: { items?: Record<string, unknown>[] }[] }, model = ""): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const turn of thread.turns || []) for (const item of turn.items || []) {
    if (item.type === "userMessage") messages.push({ role: "user", content: textContent(item.content) });
    else if (item.type === "agentMessage") messages.push({ role: "assistant", content: [{ type: "text", text: String(item.text || "") }], model, provider: "openai-codex" });
    else if (item.type === "commandExecution" || item.type === "fileChange" || item.type === "mcpToolCall") {
      const id = String(item.id || ""), name = item.type === "commandExecution" ? "bash" : item.type === "fileChange" ? "edit" : String(item.tool || "mcp");
      messages.push({ role: "assistant", content: [{ type: "toolCall", toolCallId: id, toolName: name, input: item.type === "commandExecution" ? { command: item.command, cwd: item.cwd } : { changes: item.changes, arguments: item.arguments } }], model, provider: "openai-codex" });
      const output = item.aggregatedOutput || item.output || item.result;
      if (output) messages.push({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }], isError: item.status === "failed" });
    }
  }
  return messages.slice(-400);
}
export function approvalRecord(record: { id?: string | number; method?: string; params?: Record<string, unknown> }): RuntimeRequest | null {
  if (record.id === undefined || !record.method) return null;
  const params = record.params || {};
  if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"].includes(record.method)) return { id: record.id, method: record.method, kind: "approval", title: record.method.includes("fileChange") ? "파일 변경 승인" : record.method.includes("permissions") ? "권한 요청" : "실행 승인", detail: JSON.stringify(params, null, 2).slice(0, 20000) };
  if (record.method === "item/tool/requestUserInput") return { id: record.id, method: record.method, kind: "question", title: "추가 정보 요청", detail: "", questions: params.questions as RuntimeRequest["questions"] };
  return null;
}
export function piRequest(record: Record<string, unknown>): RuntimeRequest | null {
  if (record.type !== "extension_ui_request" || typeof record.id !== "string") return null;
  const method = String(record.method), title = String(record.title || "Pi 요청");
  if (method === "confirm") return { id: record.id, method: "pi:confirm", kind: "approval", title, detail: String(record.message || "") };
  if (["input", "editor", "select"].includes(method)) return { id: record.id, method: `pi:${method}`, kind: "question", title, detail: "", questions: [{ id: "value", question: title, options: Array.isArray(record.options) ? record.options.map(label => ({ label: String(label) })) : undefined }] };
  return null;
}
export function codexDelta(messages: AgentMessage[], delta: string, model: string, continuing = true): AgentMessage[] {
  const last = messages[messages.length - 1];
  if (continuing && last?.role === "assistant" && last.content.length === 1 && last.content[0].type === "text") return [...messages.slice(0, -1), { ...last, content: [{ type: "text", text: last.content[0].text + delta }] }];
  return [...messages, { role: "assistant", content: [{ type: "text", text: delta }], model, provider: "openai-codex" } as AssistantMessage];
}
