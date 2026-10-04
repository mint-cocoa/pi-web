import { DotError, encodeMove, encodeKey, encodeWheel } from "./core.mjs";

/** No React or DOM elements. The caller owns video rendering and credential-free SDP relay. */
export class ComputerSession {
  constructor(createSession, options = {}) {
    this.createSession = createSession;
    this.createPeer = options.createPeer ?? (() => new RTCPeerConnection());
    this.controlTimeoutMs = options.controlTimeoutMs ?? 5000;
    this.listeners = new Set();
    this.heldKeys = new Set();
    this.generation = 0;
    this.state = { connection: "disconnected", controlling: false, stream: null, error: null };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  update(value) {
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener(this.state);
  }

  async connect() {
    this.close();
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const peer = this.createPeer();
    this.peer = peer;
    const current = () => generation === this.generation && !abort.signal.aborted;
    this.update({ connection: "connecting", error: null });
    peer.addTransceiver("audio", { direction: "recvonly" });
    peer.addTransceiver("video", { direction: "recvonly" });
    const channel = peer.createDataChannel("");
    this.channel = channel;
    peer.ontrack = (event) => {
      if (current() && event.track.kind === "video") {
        this.update({ stream: event.streams[0] ?? new MediaStream([event.track]) });
      }
    };
    peer.onconnectionstatechange = () => {
      if (!current()) return;
      this.update({ connection: peer.connectionState, ...(peer.connectionState !== "connected" ? { controlling: false } : {}) });
      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) this.releaseControl();
    };
    channel.onmessage = (event) => {
      if (!current() || typeof event.data !== "string") return;
      let value;
      try { value = JSON.parse(event.data); } catch { return; }
      if (value.event === "control/locked") {
        if (!this.wantsControl) { this.releaseControl(); return; }
        this.update({ controlling: true });
        this.pendingControl?.resolve();
      }
      if (value.event === "control/release") {
        this.wantsControl = false;
        this.pendingControl?.reject(new DotError("control_denied", "Computer control was released."));
        this.update({ controlling: false });
      }
    };
    channel.onclose = () => { if (current()) this.releaseControl(); };
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answer = await this.createSession(offer.sdp ?? "", abort.signal);
      if (!current()) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (error) {
      if (!current()) return;
      this.close();
      this.update({ connection: "failed", error: error instanceof DotError ? error.message : "Computer connection failed." });
      throw error;
    }
  }

  async requestControl() {
    if (this.state.controlling) return;
    if (this.channel?.readyState !== "open") throw new DotError("not_connected", "Connect the computer first.");
    if (this.pendingControl) return this.pendingControl.promise;
    this.wantsControl = true;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const pending = { promise, resolve, reject };
    this.pendingControl = pending;
    const timer = setTimeout(() => {
      pending.reject(new DotError("control_timeout", "Computer control was not granted."));
      this.releaseControl();
    }, this.controlTimeoutMs);
    try {
      this.channel.send(JSON.stringify({ event: "control/request" }));
      await promise;
    } finally {
      clearTimeout(timer);
      if (this.pendingControl === pending) this.pendingControl = null;
    }
  }

  releaseControl() {
    const requested = this.wantsControl || this.state.controlling;
    if (this.channel?.readyState === "open" && this.state.controlling) {
      for (const key of this.heldKeys) this.channel.send(encodeKey(key, false));
    }
    this.heldKeys.clear();
    this.wantsControl = false;
    this.pendingControl?.reject(new DotError("control_cancelled", "Computer control was cancelled."));
    if (requested && this.channel?.readyState === "open") this.channel.send(JSON.stringify({ event: "control/release" }));
    this.update({ controlling: false });
  }

  send(packet) {
    if (!this.state.controlling || this.channel?.readyState !== "open") {
      throw new DotError("control_required", "Request computer control before sending input.");
    }
    this.channel.send(packet);
  }

  click(x, y, button = 1) {
    if (![1, 2, 3].includes(button)) throw new DotError("invalid_input", "Invalid mouse button.");
    const move = encodeMove(x, y);
    this.send(move);
    this.send(encodeKey(button, true));
    this.send(encodeKey(button, false));
  }

  key(key, down) {
    this.send(encodeKey(key, down));
    if (down) this.heldKeys.add(key); else this.heldKeys.delete(key);
  }
  wheel(x, y) { this.send(encodeWheel(x, y)); }

  close() {
    ++this.generation;
    this.abort?.abort();
    this.releaseControl();
    if (this.channel) { this.channel.onmessage = null; this.channel.onclose = null; this.channel.close(); }
    if (this.peer) { this.peer.ontrack = null; this.peer.onconnectionstatechange = null; this.peer.close(); }
    this.channel = null;
    this.peer = null;
    this.update({ connection: "disconnected", stream: null, controlling: false });
  }
}
