import { spawn } from "node:child_process";

// Ordinary certificate-verified HTTP transport for the Oracle environment.
// No cookies, challenge solvers, TLS impersonation or attestation synthesis.
const program = String.raw`
import json,sys,urllib.request,urllib.error,urllib.parse
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args): return None
try:
 request=json.loads(sys.stdin.readline())
 url=urllib.parse.urlsplit(request['url'])
 if url.scheme!='https' or url.hostname!='chatgpt.com' or not url.path.startswith('/backend-api/') or url.username or url.password:
  raise ValueError('Invalid endpoint')
 headers=request['headers'];headers['User-Agent']='Pi-Web-Dot-Client/0.1'
 body=request.get('body')
 req=urllib.request.Request(request['url'],headers=headers,data=body.encode('utf-8') if body is not None else None,method=request['method'])
 try: response=urllib.request.build_opener(NoRedirect).open(req,timeout=25)
 except urllib.error.HTTPError as error: response=error
 with response:
  print(json.dumps({'status':response.status,'headers':{'Content-Type':response.headers.get('Content-Type','application/octet-stream')}}),flush=True)
  while True:
   chunk=response.read1(65536)
   if not chunk: break
   sys.stdout.buffer.write(chunk);sys.stdout.buffer.flush()
except Exception:
 sys.exit(2)
`;

export function pythonFetch(input, init = {}) {
  const url = String(input);
  const parsed = new URL(url);
  if (parsed.origin !== "https://chatgpt.com" || !parsed.pathname.startsWith("/backend-api/") || parsed.username || parsed.password) {
    return Promise.reject(new Error("Invalid dot endpoint."));
  }
  const signal = init.signal;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PI_DOT_PYTHON || "python3", ["-u", "-c", program], {
      stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
    });
    let header = Buffer.alloc(0), controller, ready = false, finished = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const fail = () => {
      if (finished) return;
      finished = true; cleanup(); child.kill();
      const error = new Error("Dot HTTP transport failed.");
      if (ready) controller?.error(error); else reject(error);
    };
    const abort = () => {
      if (finished) return;
      finished = true; cleanup(); child.kill();
      if (ready) controller?.error(signal.reason); else reject(signal.reason);
    };
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("data", (chunk) => {
      if (finished) return;
      if (ready) { controller?.enqueue(new Uint8Array(chunk)); return; }
      header = Buffer.concat([header, chunk]);
      const newline = header.indexOf(10);
      if (newline < 0) { if (header.length > 8192) fail(); return; }
      try {
        const metadata = JSON.parse(header.subarray(0, newline).toString("utf8"));
        const remainder = header.subarray(newline + 1);
        ready = true;
        const body = new ReadableStream({
          start(value) { controller = value; if (remainder.length) value.enqueue(new Uint8Array(remainder)); },
          cancel() { if (!finished) { finished = true; cleanup(); child.kill(); } },
        });
        resolve(new Response([204, 205, 304].includes(metadata.status) ? null : body, metadata));
      } catch { fail(); }
    });
    child.on("close", (code) => {
      if (finished) return;
      if (code !== 0 || !ready) { fail(); return; }
      finished = true; cleanup(); controller?.close();
    });
    signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(JSON.stringify({ url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)), body: init.body ?? null }) + "\n");
  });
}
