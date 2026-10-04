import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { JsonLines, sshArguments } from "./protocol";
import { REMOTE_BRIDGE } from "./bridge";

interface Reply { id: number; result?: unknown; error?: string }
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

/** Owns exactly one SSH process. Closing it cannot affect other SSH clients. */
export class SshConnection {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private closed = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastActivity = Date.now();
  constructor(alias: string, private readonly onClose: (error?: string) => void,
    spawnProcess: typeof spawn = spawn) {
    this.process = spawnProcess("ssh", sshArguments(alias, REMOTE_BRIDGE), { stdio: "pipe", windowsHide: true });
    const decoder = new StringDecoder("utf8");
    const lines = new JsonLines(value => {
      if (!value || typeof value !== "object") throw new Error("Invalid remote protocol.");
      const reply = value as Reply;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      clearTimeout(pending.timer);
      if (reply.error) pending.reject(new Error("Remote session data is unavailable. Refresh the session list."));
      else pending.resolve(reply.result);
    });
    this.process.stdout.on("data", (chunk: Buffer) => {
      try { lines.push(decoder.write(chunk)); } catch { this.close("Invalid or oversized response from the remote helper."); }
    });
    // Drain diagnostic output without returning config, paths or credentials to clients.
    this.process.stderr.resume();
    this.process.stdin.on("error", () => this.close("SSH input stream closed."));
    this.process.on("error", () => this.close("Could not start SSH. Check that OpenSSH is installed on the Pi Web server."));
    this.process.on("close", () => this.close("SSH connection ended. Check the server's SSH alias, key and known_hosts."));
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastActivity > 30 * 60_000) { this.close(); return; }
      void this.request("ping", {}, false).catch(() => this.close("SSH heartbeat timed out."));
    }, 30_000);
    this.heartbeat.unref();
  }
  request<T>(method: "inventory" | "transcript" | "ping", params: Record<string, unknown> = {}, userActivity = true): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Connect to this server first."));
    if (this.pending.size >= 10) return Promise.reject(new Error("Too many pending remote requests."));
    if (userActivity) this.lastActivity = Date.now();
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.close("SSH request timed out. Check connectivity, authentication and known_hosts."), 20_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.process.stdin.write(JSON.stringify({ id, method, ...params }) + "\n", error => {
        if (error) this.close("SSH input stream closed.");
      });
    });
  }
  close(error?: string) {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(error || "SSH connection was disconnected."));
    }
    this.pending.clear();
    this.process.stdin.end();
    this.process.kill("SIGTERM");
    const force = setTimeout(() => { if (this.process.exitCode === null) this.process.kill("SIGKILL"); }, 2000);
    force.unref();
    this.onClose(error);
  }
}
