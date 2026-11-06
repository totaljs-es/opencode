# Protocol

Two channels: REST for commands and reads, one WebSocket for events.

## REST

Routes use the `+API` style of the conventions (`$api` is `/api/`), each to an action. Names are `collection_verb`; the action is `Collection|verb`.

| Endpoint | Action | Purpose |
|---|---|---|
| `-account` | `Account\|read` | Current user and capabilities |
| `-projects`, `+projects_open`, `-projects_remove/{id}` | `Projects\|...` | List, open a folder, forget a project |
| `-folders` | `Folders\|list` | Folders of the computer (query `path`, default the home folder; `hidden`): `{ path, sep, home, items: [{ name }], places }` |
| `-projects_files/{id}` | `Projects\|files` | File tree (lazy, one level per call) |
| `-sessions`, `+sessions_create`, `-sessions_read/{id}`, `-sessions_remove/{id}` | `Sessions\|...` | Sessions of a project |
| `+sessions_update/{id}` | `Sessions\|update` | Rename a session (input `name`) |
| `-sessions_messages/{id}` | `Sessions\|messages` | Messages with parts |
| `+sessions_prompt/{id}` | `Sessions\|prompt` | Send a prompt (`text`, and optionally `model`, `autoaccept`, `reasoning` and `attachments: [{ name, mime, data (base64) }]`); answers `{ messageid }` immediately. The body can be up to 20 MB |
| `GET /attachments/{id}/` | | A file that was attached to a prompt: images with their type, text files as plain text |
| `-sessions_abort/{id}` | `Sessions\|abort` | Stop the run |
| `-projects_commands/{id}` | `Projects\|commands` | Commands (`.totem/commands`) and agents of a project |
| `+questions_reply/{id}` | `Questions\|reply` | Answer a question of the `ask` tool |
| `-sessions_todos/{id}` | `Sessions\|todos` | Task list of the session |
| `+sessions_undo/{id}` | `Sessions\|undo` | Restore the files that a message and the later ones changed (input `messageid`) |
| `-sessions_diff/{id}` | `Sessions\|diff` | Files changed in the session: `{ path, status, additions, deletions, patch }` |
| `+permissions_reply/{id}` | `Permissions\|reply` | Answer a pending permission question |
| `-providers`, `+providers_save`, `-providers_remove/{id}`, `-providers_models` | `Providers\|...` | Providers (the key is write-only) and the models that a session can use |
| `-providers_templates` | `Providers\|templates` | Known providers (`private/providers.json`): Ollama, llama.cpp, LM Studio, OpenRouter, OpenAI, Groq, Mistral, DeepSeek, Together |
| `-providers_detect` | `Providers\|detect` | Local servers that answer on this computer, with their models |
| `+providers_available` | `Providers\|available` | Every model that a provider offers (`url`, `kind`, `key`, or `id` of a saved provider) with `context`, `tools`, `reasoning`, `free` |
| `-providers_catalog` | `Providers\|catalog` | The models that a session can use, with what each can do, and the name and icon of their provider |
| `-permissions`, `-permissions_remove/{id}` | `Permissions\|...` | Permission rules of a project |
| `+login`, `+logout` | `Account\|...` | Sign in with the access token (only when `token` is set) |

Answers follow the conventions: `$.callback(data)`, `$.success(id)`, `$.invalid(...)`.

## WebSocket

`/ws/` (authenticated by the same cookie). The client sends `{ type: 'subscribe', sessionid }` and `{ type: 'unsubscribe', sessionid }`; it receives events for the subscribed sessions and for its project list.

Every event: `{ type, sessionid, ts, data }`.

| `type` | `data` | Meaning |
|---|---|---|
| `session.status` | `{ status }` | `running`, `idle`, `aborted`, `error` |
| `session.updated` | `{ session }` | The name of the session changed (the user renamed it, or the first prompt named it) |
| `message.created` | `{ message }` | New user or assistant message |
| `part.created` | `{ part }` | A part opened (text, reasoning, tool, knowledge) |
| `part.delta` | `{ partid, text }` | Appended text of an open part |
| `part.updated` | `{ part }` | A part changed state (a tool went `running` → `done`) |
| `part.closed` | `{ partid }` | The part is complete and stored |
| `permission.ask` | `{ id, tool, input, patterns }` | Waiting for the user |
| `permission.replied` | `{ id, reply }` | Answered (also by another client) |
| `question.ask` | `{ id, text, options }` | The `ask` tool is waiting |
| `todo.updated` | `{ items }` | Task list changed |
| `diff.updated` | `{ path }` or `{ paths }` | A file was snapshotted or restored: read `Sessions\|diff` again |
| `question.replied` | `{ id }` | A question of the `ask` tool was answered |
| `error` | `{ message, retry }` | A run-level error. `retry: true` means Totem retries after a pause. When the run ends with an error this event comes before the final `session.status` |

A client that subscribes to a session receives again the questions that are waiting there (`permission.ask`, `question.ask`), so a question is never lost because the page was closed or reloaded.

Ordering: events of one session are sent in order. A client that reconnects calls `Sessions|messages` for the stored state and subscribes again; parts still open arrive as `part.created` followed by deltas from that point.

## External interface

- `POST /$mcp/` (Total.js MCP) is available when `CONF.$mcp` is set, for actions marked `mcp: true`. The agent's file and shell tools are not marked.
- A headless call for scripts: `POST /api/sessions_prompt/{id}` with a token header, then polling `Sessions|read` or listening to the WebSocket. The `totem run` command ([delivery](delivery.md)) uses exactly this.
