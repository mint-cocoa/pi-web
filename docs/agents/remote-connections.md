# Remote SSH connections

Main toolbar **연결** opens `components/connections/RemoteConnections`. Shared SettingsUi blocks handle layout, forms and controls; the modal owns Escape, focus restoration and Tab cycling. Closing the panel leaves registered connections alive. Names are currently Korean custom UI strings.

`lib/connections` is independent of AppShell, the local AgentSession registry and Dot. The UI calls `/api/connections`; every request passes the normal host/origin guard and the existing web-password proxy. Actions: save/remove/connect/disconnect/refresh/transcript. No arbitrary remote commands, paths, password uploads or key transfers.

`manager.ts` stores alias/id/label only in `PI_CODING_AGENT_DIR/remote-connections.json` (default ~/.pi/agent), atomically replaced with mode 0600. Mutations are serialized across route bundles through globalThis; this registry is for a single Pi Web server process. Connection status and process ownership stay in memory. Existing explicit oracle/cocoamini Host aliases are pre-registered but are never automatically connected. Other aliases from ~/.ssh/config can be added; wildcard/negation/Include-only aliases are not offered.

`transport.ts` starts one owned OpenSSH process per connection with BatchMode, strict existing known_hosts, server keepalive and connection deadlines. Reusing arbitrary SSH control masters is disabled. A fixed Python 3 helper over JSONL stdin/stdout supports inventory, transcript and ping only. Keys and remote model credentials remain in the server's existing stores. No Pi or Codex model process is started. A failed/oversized protocol or deadline closes that process and rejects all waiting requests. Heartbeat every 30 seconds; 30 minutes without user requests disconnects. Disconnect/remove kills only the owned process, not other SSH or agent processes.

`bridge.ts` walks fixed remote ~/.pi/agent/sessions and ~/.codex/sessions roots without following directory/file symlinks. It indexes at most 5000 files per backend and returns at most 300 recent records; callers request a hashed id held in that remote process. Transcript is a bounded chronological log preview (up to 12 MB scanned, last 100 user/assistant messages from that scan, text capped at 6000 characters). Pi branches and Codex compaction are not reconstructed as live model context. Session files are never modified. These are saved records; the UI must not imply that they are live or that SSH status measures agent execution. Remote paths must never enter the local session-reader/file-access API.

Agent installation badges indicate executable availability only, not authenticated model access. The backend works with a POSIX SSH server having Python 3; the browser's OS and SSH config are irrelevant.

Codex titles and existing pinned/archive badges come from the remote state_*.sqlite threads table opened read-only (optional; failures fall back to user_message events/ids). Injected AGENTS/environment setup response items are not human titles or chat messages. This feature does not change Codex's sidebar flags or SQLite data.

Current Codex rollouts store human user response items with `internal_chat_message_metadata_passthrough.content_item_kinds` containing `user.*`. Use these alongside legacy user_message events; adjacent duplicates collapse. Items marked only as setup/context are excluded. Older records without metadata use a conservative known-setup-prefix filter for the read-only preview.

Tests cover unsafe aliases, strict host keys, JSONL Unicode framing, process closure and pending request cancellation. Live verification should connect and read records only; do not send prompts while checking the connection manager.
