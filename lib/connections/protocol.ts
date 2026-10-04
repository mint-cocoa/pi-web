export function validAlias(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value);
}

export function configuredAliases(source: string): string[] {
  const aliases = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*Host\s+(.+?)\s*(?:#.*)?$/i.exec(line);
    if (match) for (const alias of match[1].split(/\s+/)) if (validAlias(alias)) aliases.add(alias);
  }
  return [...aliases].sort();
}

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function sshArguments(alias: string, bridge: string): string[] {
  if (!validAlias(alias)) throw new Error("Invalid SSH alias.");
  return ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=8",
    "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2", "-o", "ControlMaster=no",
    "-o", "ControlPath=none", alias, "python3 -u -c " + shellQuote(bridge)];
}

/** JSONL splits only on LF; JSON strings may contain Unicode line separators. */
export class JsonLines {
  private buffer = "";
  private readonly onLine: (value: unknown) => void;
  private readonly limit: number;
  constructor(onLine: (value: unknown) => void, limit = 2_000_000) { this.onLine = onLine; this.limit = limit; }
  push(chunk: string) {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      if (line.length > this.limit) throw new Error("Remote response exceeded the size limit.");
      if (line) this.onLine(JSON.parse(line));
    }
    if (this.buffer.length > this.limit) throw new Error("Remote response exceeded the size limit.");
  }
}
