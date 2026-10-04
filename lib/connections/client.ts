import type { RemoteConnection, RemoteSession } from "./types";

export interface ConnectionSnapshot { connections: RemoteConnection[]; aliases: string[]; configPath: string }
export interface RemoteSelection { connection: Pick<RemoteConnection, "id" | "alias" | "label">; session: RemoteSession }
export async function connectionRequest<T>(body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/connections", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal } : { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "연결 요청에 실패했습니다.");
  if (body && typeof window !== "undefined" && body.action !== "transcript") window.dispatchEvent(new Event("pi-web:connections-changed"));
  return result;
}
