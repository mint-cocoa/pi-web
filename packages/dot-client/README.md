# Dot client

Independent, dependency-free client for the dot endpoints observed in the official
ChatGPT web client. It has no Pi, React or Next.js imports.

- `server.mjs`: injected `CredentialProvider`, fixed-origin HTTP transport,
  normalized conversation snapshots, explicit message submission, SDP relay,
  room-live parsing, shared subscriber runtime.
- `browser.mjs`: injected SDP relay and peer factory, video stream and input
  state. The host attaches the returned MediaStream to its own video element.
- `core.mjs`: DTO normalization, identifiers, SSE parsing and binary input codec.

The server's only credential contract is `{ get(signal): Promise<{ accessToken,
accountId }> }`. No file paths, credential storage, SDK login or token refresh
implementation belongs in this package. The Pi adapter uses Pi's own ModelRuntime.

The endpoints are internal and may change. A refused challenge is returned to the
caller; the client does not imitate app attestation or bypass verification. Writes
are never automatically retried. Message request IDs must be retained for a retry
of the same user action. Closing a computer session releases locally held keys and
control, then closes the peer. Replacing it invalidates all prior callbacks.

`npm test` exercises packet vectors, letterboxing, credential boundaries,
idempotency, stream cancellation, subscriber ownership and control acknowledgements.

The current chat DTO includes visible text messages only; attachments and embedded
widgets are not rendered. The runtime uses a shared five-second snapshot refresh
because the room-live stream does not carry the complete message history.
