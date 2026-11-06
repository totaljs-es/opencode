# Permissions and security

## What the agent may do

The agent acts through tools only. Each tool call is checked before it runs:

1. **Rule match.** Rules are `tool` + `pattern` → `allow`, `ask` or `deny`, taken from the project, then the global settings, then the built-in defaults. The most specific rule wins; `deny` beats `allow` at equal specificity.
2. **Ask.** With `ask` the loop sends `permission.ask` and waits. The reply is `once`, `always` (stores an `allow` rule for the pattern) or `reject`.
3. **Run or refuse.** A rejected or denied call returns an error result to the model so it can change course; it is stored as a `tool` part with status `denied`.

Patterns: for `bash` the command line (`git status*`), for file tools the path relative to the project (`src/**`), for `fetch` the host.

### Defaults

| Tool | Default |
|---|---|
| read, glob, grep, skill, todo, ask | allow (inside the project) |
| write, edit, patch | ask |
| bash | ask, except a short list of read-only commands |
| fetch | ask |
| `.env` and `.env.*` (read, write, edit; `.env.example`, `.sample` and `.template` are fine) | ask |
| any path outside the project root | deny |
| every tool that changes files or runs a command, in Plan mode | deny (code, not a prompt) |
| MCP servers of the project, and Forge in Total.js projects | ask before each one starts (`mcp-start`: a project file can start a program; the question says where a remote one goes) |
| MCP tools | ask before each call |

A session can run in **auto-accept edits** mode (write/edit/patch become allow for that session); it never changes `bash` or `fetch`.

## Project boundary

Every file path is resolved with `Total.Path`, normalized, and rejected unless it stays inside the session's project root after resolving symbolic links. The same check applies to patch targets and to the working directory of commands. This boundary is code, not a prompt instruction.

## Commands

- Run as child processes (`Total.Child`) with the project as working directory, a timeout (default 2 minutes), an output cap and a minimal environment: the server's configuration and provider keys are not passed down.
- Killed on abort or when the session is removed.
- Honest limit: a command runs with the user's own permissions. The permission check and the diff review protect against mistakes, not against a hostile model. For isolation, run Totem in the Docker image ([delivery](delivery.md)).

## The server

- Listens on `127.0.0.1` by default. Listening on other interfaces requires a configured access token.
- One `AUTH()` accepts the session cookie or an `Authorization` token. All routes are `+` (authenticated) except the login page and static files.
- The WebSocket checks the same authentication, plus the `Origin` header.
- CSRF protection follows the framework defaults for cookie sessions.
- No request is made to any third party except the provider the user configured and the URLs the user allowed to `fetch` or an MCP server.

## Secrets

- Provider keys: encrypted at rest, never returned by the API, never written to logs or to the model context.
- Tool output is scanned for the configured keys before it is stored or sent back to the model; a match is replaced by a marker.
- Configuration lives in the native config file; there are no environment overrides.

## Prompt injection

Text read from files, web pages or MCP servers is untrusted. The base prompt says so, and the permission check does not depend on what the model says: a file that tells the agent to run a command still produces an `ask`. Tool results are marked as data in the message history.

## Audit

Every tool call, permission decision and file change is a stored part with its time, so "what did the agent do" is answered from the session, not from memory.
