# Dot integration

`packages/dot-client` is the transport/protocol implementation. It may import
neither Pi nor React/Next. `packages/pi-dot` owns Pi credentials and extension
registration. `lib/dot` and `app/api/dot` are the web host adapters;
`components/dot` and `hooks/useDotConversation` display state and forward explicit
user operations. This does not create a Pi SessionManager for a cloud conversation.

AppShell owns only a boolean for the floating Dot window. DotFloatingPanel owns
window geometry/minimization; DotWorkspace owns presentation, while transport and
computer state remain in their independent clients. The same workspace also runs
at `/dot`. Embedded selection must not rewrite the main Pi URL. Closing unmounts
the adapters and releases their connections; minimizing releases computer control.
Window keyboard events must not reach the main Pi agent's global stop shortcut.

- Credentials are resolved by Pi ModelRuntime, never copied from auth.json. Raw
  OAuth credentials are never returned to the browser. SDP's temporary ICE values
  are returned only to the same-origin computer client for WebRTC negotiation.
- The runtime is process/account-owned and shared across subscribers, not owned by
  a React component. Last-subscriber cleanup aborts its local refresh. It never
  suspends, deletes or stops the remote dot.
- A changed subscription account closes the previous account runtime. Every
  transport request rechecks the account through its injected credential provider.
- The API accepts typed operations and identifiers, never caller-supplied URLs or
  request headers. GETs are guarded too, because they access account data.
- Oracle selects the optional `pythonFetch` transport. It uses Python 3's ordinary
  certificate-verified HTTP, a fixed origin, rejected redirects and cancellation.
  Request credentials/body travel only on stdin. A refused challenge is an error;
  never add challenge solving, app-attestation synthesis or TLS impersonation.
- Message writes use the observed content/request_id/idempotency_token schema.
  Preserve a request ID when the same text is retried. Never retry automatically;
  loss of an acknowledgement is an unknown delivery, not a rejected message.
- Only read tools are model-visible. `/dot-send` and the web Send button represent
  explicitly entered user operations. Live tests must not send arbitrary messages.
- Computer input requires a received `control/locked` grant. Ignore stale peer
  callbacks; reject black-bar clicks; release held keys/control on blur, closing,
  or a failed control request. Do not automatically acquire control when connecting.
- The API runtime exposes normalized snapshots every five seconds. Upstream
  room-live events only signal changes; the history API supplies message bodies.
- Text history and keyboard/click/scroll are implemented. Attachments, embedded
  widgets, drag gestures, clipboard and local WebAuthn relay are outside this UI.
- Messaging returns `role: user` for both humans and dots. Classify the selected
  dot via room.members' account_user_id and matching aeon_id, retaining the
  participant's display name. JWT account-user IDs are a different identity space.
  The upstream history limit is at most 32, not 40.

Validation: `npm run test:dot`, normal tests/typecheck/lint/build; a local staging
server verifies actual list/status/history and WebRTC frames with the existing
subscription. Message POST and input packets use protocol tests unless the user
has explicitly requested an actual message or computer operation.
