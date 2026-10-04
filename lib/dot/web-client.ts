import { DotError } from "@/packages/dot-client/core.mjs";

export async function dotFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DotError(value?.code ?? "request_failed", value?.error ?? "The dot request failed.", {
      status: response.status, deliveryUnknown: value?.deliveryUnknown === true,
    });
  }
  return value as T;
}

export function dotCommand<T>(body: unknown, signal?: AbortSignal) {
  return dotFetch<T>("/api/dot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}
