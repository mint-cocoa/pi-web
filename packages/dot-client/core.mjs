export class DotError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "DotError";
    this.code = code;
    this.status = options.status ?? 500;
    this.deliveryUnknown = options.deliveryUnknown ?? false;
  }
}

export function assertId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.~-]{1,256}$/.test(value)) {
    throw new DotError("invalid_id", "Invalid dot identifier.", { status: 400 });
  }
  return value;
}

export function normalizeDot(value) {
  if (!value || typeof value !== "object") throw new DotError("invalid_response", "Invalid dot response.");
  return {
    id: assertId(value.id),
    threadId: assertId(value.active_root_thread_id),
    roomId: assertId(value.messaging_room_id),
    name: typeof value.display_name === "string" ? value.display_name.slice(0, 256) : "Dot",
    status: typeof value.status === "string" ? value.status : "unknown",
  };
}

export function normalizeMessage(value, members = [], aeonId) {
  if (!value || typeof value !== "object" || value.deleted_at) return null;
  if (!["user", "assistant"].includes(value.role) || value.channel === "analysis"
      || value.metadata?.is_hidden === true || value.metadata?.hidden === true) return null;
  const text = value.content?.text;
  if (typeof value.id !== "string" || typeof text !== "string") return null;
  const author = members.find((member) => member.account_user_id === value.account_user_id);
  const fromDot = Boolean(aeonId && author?.aeon_id === aeonId);
  return {
    id: value.id,
    role: value.role === "assistant" || fromDot ? "assistant" : "user",
    authorName: typeof author?.name === "string" ? author.name.slice(0, 256) : null,
    text: text.slice(0, 32000),
    truncated: text.length > 32000,
    createdAt: typeof value.created_at === "string" ? value.created_at : "",
  };
}

function unsigned(value, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new DotError("invalid_input", "Input is outside the supported range.", { status: 400 });
  }
  return value;
}

export function encodeMove(x, y) {
  const packet = new ArrayBuffer(7);
  const view = new DataView(packet);
  view.setUint8(0, 1);
  view.setUint16(1, 4, true);
  view.setUint16(3, unsigned(x, 65535), true);
  view.setUint16(5, unsigned(y, 65535), true);
  return packet;
}

export function encodeKey(key, down) {
  unsigned(key, 0xffffffff);
  const packet = new ArrayBuffer(11);
  const view = new DataView(packet);
  view.setUint8(0, down ? 3 : 4);
  view.setUint16(1, 8, true);
  // Equivalent to the original client's little-endian uint64, without BigInt syntax.
  view.setUint32(3, key, true);
  view.setUint32(7, 0, true);
  return packet;
}

export function encodeWheel(x, y) {
  const packet = new ArrayBuffer(7);
  const view = new DataView(packet);
  view.setUint8(0, 2);
  view.setUint16(1, 4, true);
  for (const [offset, value] of [[3, x], [5, y]]) {
    if (!Number.isInteger(value) || value < -32768 || value > 32767) {
      throw new DotError("invalid_input", "Invalid scroll offset.", { status: 400 });
    }
    view.setInt16(offset, value, true);
  }
  return packet;
}

export function videoCoordinates(x, y, boxWidth, boxHeight, videoWidth, videoHeight) {
  if (![x, y, boxWidth, boxHeight, videoWidth, videoHeight].every(Number.isFinite)
      || Math.min(boxWidth, boxHeight, videoWidth, videoHeight) <= 0) return null;
  const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight);
  const left = (boxWidth - videoWidth * scale) / 2;
  const top = (boxHeight - videoHeight * scale) / 2;
  if (x < left || y < top || x >= boxWidth - left || y >= boxHeight - top) return null;
  return {
    x: Math.min(videoWidth - 1, Math.max(0, Math.round((x - left) / scale))),
    y: Math.min(videoHeight - 1, Math.max(0, Math.round((y - top) / scale))),
  };
}

const keysyms = { Enter: 0xff0d, Backspace: 0xff08, Tab: 0xff09, Escape: 0xff1b,
  Delete: 0xffff, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53,
  ArrowDown: 0xff54, Home: 0xff50, End: 0xff57, PageUp: 0xff55, PageDown: 0xff56,
  Shift: 0xffe1, Control: 0xffe3, Alt: 0xffe9, Meta: 0xffeb };

export function browserKeysym(key) {
  if (keysyms[key]) return keysyms[key];
  const chars = [...key];
  if (chars.length !== 1) return null;
  const code = key.codePointAt(0);
  return code <= 255 ? code : 0x01000000 + code;
}

export async function* decodeSse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const result = await reader.read();
      buffer += decoder.decode(result.value, { stream: !result.done });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 1024 * 1024) throw new DotError("invalid_response", "Dot event exceeded the size limit.");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = [];
        let event = "message";
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          if (line.startsWith("event:")) event = line.slice(6).trim();
        }
        if (data.length) yield { event, data: data.join("\n") };
      }
      if (result.done) break;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
