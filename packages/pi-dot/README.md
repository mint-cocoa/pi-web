# Pi Dot extension

This package adapts the independent dot client to Pi. The existing `openai-codex`
subscription login is resolved through `ModelRuntime.getAuth()`, including Pi's
credential locking and renewal. It does not copy or write auth.json.

From the repository root, build its generated vendor directory:

```sh
npm run build:dot-plugin
pi install /absolute/path/to/pi-web-src/packages/pi-dot
```

Tools: `dot_list`, `dot_status`, `dot_messages`. They only read remote data.
Commands: `/dot-list`, `/dot-status <threadId>`, `/dot-send <threadId> <message>`.
Only the last, explicitly entered command writes a message. It does not start a Pi
model turn. The plugin has no React imports or web routes. The web host supplies
the separate `/dot` UI and authenticated API adapters.

`npm pack` runs the build step and includes the generated, dependency-free client,
so the plugin tarball does not depend on a sibling source directory. Pi SDK and
typebox are peer dependencies. Upstream verification refusals remain errors.

Oracle uses the independent client's ordinary Python HTTP adapter because Node's
HTTP requests receive a network challenge there while Python's standard,
certificate-verified requests succeed. Python 3 is required; `PI_DOT_PYTHON` can
select its executable. Credentials travel only through the child's stdin, never
through command arguments, environment variables, logs or files. Neither adapter
solves a challenge or synthesizes app attestation.
