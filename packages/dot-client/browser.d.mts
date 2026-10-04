export interface ComputerState { connection: string; controlling: boolean; stream: MediaStream | null; error: string | null }
export class ComputerSession {
  state: ComputerState;
  constructor(createSession: (offer: string, signal: AbortSignal) => Promise<string>, options?: { createPeer?: () => RTCPeerConnection; controlTimeoutMs?: number });
  subscribe(listener: (state: ComputerState) => void): () => void;
  connect(): Promise<void>;
  requestControl(): Promise<void>;
  releaseControl(): void;
  click(x: number, y: number, button?: number): void;
  key(key: number, down: boolean): void;
  wheel(x: number, y: number): void;
  close(): void;
}
