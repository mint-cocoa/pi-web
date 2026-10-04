export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
export interface RemoteSession {
  id: string;
  backend: "pi" | "codex";
  title: string;
  cwd: string;
  updatedAt: string;
  archived?: boolean;
  pinned?: boolean;
}
export interface RemoteInventory {
  hostname: string;
  user: string;
  agents: { pi: boolean; codex: boolean };
  sessions: RemoteSession[];
  truncated: boolean;
}
export interface RemoteConnection {
  id: string;
  alias: string;
  label: string;
  state: ConnectionState;
  checkedAt?: string;
  error?: string;
  inventory?: RemoteInventory;
}
export interface RemoteTranscript {
  messages: { role: string; text: string }[];
  truncated: boolean;
}
