# Protocol

Two channels: REST for commands and reads, one WebSocket for events.

## REST

Routes use the `+API` style of the conventions (`$api` is `/api/`), each to an action. Names are `collection_verb`; the action is `Collection|verb`.

| Endpoint | Action | Purpose |
|---|---|---|
| `-account` | `Account\|read` | Current user and capabilities |
| `-projects`, `+projects_open`, `-projects_remove/{id}` | `Projects\|...` | List, open a folder, forget a project |
| `-projects_files/{id}` | `Projects\|files` | File tree (lazy, one level per call) |
| `-sessions`, `+sessions_create`, `-sessions_read/{id}`, `-sessions_remove/{id}` | `Sessions\|...` | Sessions of a project |
| `-sessions_messages/{id}` | `Sessions\|messages` | Messages with parts |
| `+sessions_prompt/{id}` | `Sessions\|prompt` | Send a prompt; answers `{ messageid }` immediately |
| `-sessions_abort/{id}` | `Sessions\|abort` | Stop the run |
| `-sessions_undo/{id}` | `Sessions\|undo` | Restore files from a message snapshot |
| `-sessions_diff/{id}` | `Sessions\|diff` | Diff of the session |
| `+permissions_reply/{id}` | `Permissions\|reply` | Answer a pending permission question |
| `-providers`, `+providers_save`, `-providers_models/{id}` | `Providers\|...` | Providers and their model list |
| `-settings_read`, `+settings_save` | `Settings\|...` | Application settings |

Answers follow the conventions: `$.callback(data)`, `$.success(id)`, `$.invalid(...)`.

## WebSocket

`/ws/` (authenticated by the same cookie). The client sends `{ type: 'subscribe', sessionid }` and `{ type: 'unsubscribe', sessionid }`; it receives events for the subscribed sessions and for its project list.

Every event: `{ type, sessionid, ts, data }`.

| `type` | `data` | Meaning |
|---|---|---|
| `session.status` | `{ status }` | `running`, `idle`, `aborted`, `error` |
| `message.created` | `{ message }` | New user or assistant message |
| `part.created` | `{ part }` | A part opened (text, reasoning, tool) |
| `part.delta` | `{ partid, text }` | Appended text of an open part |
| `part.updated` | `{ part }` | A part changed state (a tool went `running` → `done`) |
| `part.closed` | `{ partid }` | The part is complete and stored |
| `permission.ask` | `{ id, tool, input, patterns }` | Waiting for the user |
| `permission.replied` | `{ id, reply }` | Answered (also by another client) |
| `question.ask` | `{ id, text, options }` | The `ask` tool is waiting |
| `todo.updated` | `{ items }` | Task list changed |
| `diff.updated` | `{ files }` | Files changed in the session |
| `error` | `{ message, retry }` | A run-level error |

Ordering: events of one session are sent in order. A client that reconnects calls `Sessions|messages` for the stored state and subscribes again; parts still open arrive as `part.created` followed by deltas from that point.

## External interface

- `POST /$mcp/` (Total.js MCP) is available when `CONF.$mcp` is set, for actions marked `mcp: true`. The agent's file and shell tools are not marked.
- A headless call for scripts: `POST /api/sessions_prompt/{id}` with a token header, then polling `Sessions|read` or listening to the WebSocket. The `totem run` command ([delivery](delivery.md)) uses exactly this.
