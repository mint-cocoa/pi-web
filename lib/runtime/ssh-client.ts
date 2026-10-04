import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { JsonLines, validAlias } from "../connections/protocol";
import { GATEWAY_SOURCE } from "./gateway-source";

const INSTALLER = `import base64,os,pathlib,sys\nroot=pathlib.Path.home()/'.local/share/pi-web-runtime'\nroot.mkdir(parents=True,exist_ok=True,mode=0o700)\nos.chmod(root,0o700)\npath=root/'gateway.py'\nsource=base64.b64decode('${GATEWAY_SOURCE}')\nif not path.is_file() or path.read_bytes()!=source:\n temp=root/'gateway.py.tmp'\n temp.write_bytes(source)\n os.chmod(temp,0o600)\n os.replace(temp,path)\nos.execv(sys.executable,[sys.executable,'-u',str(path),'--client'])`;

export class GatewayClient {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  constructor(alias?: string) {
    if (alias && !validAlias(alias)) throw new Error("Invalid SSH alias.");
    const command = `python3 -u -c 'import base64;exec(base64.b64decode("${Buffer.from(INSTALLER).toString("base64")}"))'`;
    this.child = alias ? spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2", "-o", "ControlPath=none", alias, command], { stdio: "pipe", windowsHide: true })
      : spawn("python3", ["-u", "-c", INSTALLER], { stdio: "pipe", windowsHide: true });
    const decoder = new StringDecoder("utf8");
    const lines = new JsonLines(value => {
      const response = value as { id: string; result?: unknown; error?: string };
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(response.id);
      if (response.error) pending.reject(new Error(response.error)); else pending.resolve(response.result);
    }, 16_000_000);
    this.child.stdout.on("data", (data: Buffer) => { try { lines.push(decoder.write(data)); } catch { this.close(); } });
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.close());
    this.child.on("error", () => this.close()); this.child.on("close", () => this.close());
  }
  get alive() { return !this.closed; }
  request<T>(backend: "pi" | "codex", method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Execution transport disconnected."));
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Runtime request timed out; delivery may already have occurred. Do not resend automatically.")); }, 40_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.child.stdin.write(JSON.stringify({ id, backend, method, params }) + "\n");
    });
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Execution transport disconnected.")); }
    this.pending.clear(); this.child.stdin.end(); this.child.kill();
  }
}
