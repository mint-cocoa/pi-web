import type { SessionRef } from "../session-provider";
import type { AgentMessage } from "../types";
export interface RuntimeRequest { id: string | number; method: string; title: string; detail: string; kind: "approval" | "question"; questions?: { id: string; header?: string; question: string; isSecret?: boolean; options?: { label: string; description?: string }[] }[] }
export interface RuntimeAnswer { decision?: "accept" | "decline" | "cancel"; answers?: Record<string, string>; value?: string; cancelled?: boolean }
export interface RuntimeSnapshot {
  ref: SessionRef; title: string; cwd: string; phase: "idle" | "running" | "approval" | "error";
  messages: AgentMessage[]; requests: RuntimeRequest[]; cursor: number; epoch: string; error?: string;
  model?: { provider: string; modelId: string } | null;
}
export interface RuntimeSessionSummary { id: string; title: string; cwd: string; updatedAt: string; phase?: string }
export interface RuntimeTarget { connectionId: string; backend: "pi" | "codex" }
