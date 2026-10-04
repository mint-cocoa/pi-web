export interface Dot { id: string; threadId: string; roomId: string; name: string; status: string }
export interface DotMessage { id: string; role: "user" | "assistant"; authorName: string | null; text: string; createdAt: string; truncated: boolean }
export interface Environment { status: string; capabilities: { type: string; status: string; error: string | null }[] }
export interface DotSnapshot { dot: Dot; messages: DotMessage[]; environment: Environment; capturedAt: string }
export interface Credential { accessToken: string; accountId: string }
export interface CredentialProvider { get(signal?: AbortSignal): Promise<Credential> }
export class DotError extends Error {
  code: string; status: number; deliveryUnknown: boolean;
  constructor(code: string, message: string, options?: { status?: number; deliveryUnknown?: boolean });
}
export function assertId(value: unknown): string;
export function normalizeDot(value: unknown): Dot;
export function normalizeMessage(value: unknown, members?: { account_user_id?: string; aeon_id?: string; name?: string }[], aeonId?: string): DotMessage | null;
export function encodeMove(x: number, y: number): ArrayBuffer;
export function encodeKey(key: number, down: boolean): ArrayBuffer;
export function encodeWheel(x: number, y: number): ArrayBuffer;
export function videoCoordinates(x: number, y: number, boxWidth: number, boxHeight: number, videoWidth: number, videoHeight: number): { x: number; y: number } | null;
export function browserKeysym(key: string): number | null;
export function decodeSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event: string; data: string }>;
