# Data model

Everything is local. The data folder (`config`: `data`, default `databases/` next to the application, or a mounted volume in Docker) holds NoSQL databases and FILESTORAGE; the project's own files are never copied into it except snapshots.

## Entities

| Entity | Key fields | Store |
|---|---|---|
| **user** | `id`, `name`, `login`, `password` hash, `sa`, `dtcreated` | NoSQL `users` |
| **project** | `id`, `name`, `path`, `instructions` (detected), `dtcreated`, `dtopened`, `ownerid` | NoSQL `projects` |
| **session** | `id`, `projectid`, `name`, `agent`, `model`, `status` (`idle`, `running`, `aborted`, `error`), `maxsteps`, `parentid`, `dtcreated`, `dtupdated` | NoSQL `sessions` |
| **message** | `id`, `sessionid`, `role` (`user`, `assistant`), `model`, `cost`, `tokens`, `dtcreated` | NoSQL `messages` |
| **part** | `id`, `messageid`, `sessionid`, `type`, `data`, `dtcreated` | NoSQL `parts` |
| **permission rule** | `id`, `projectid` (or global), `tool`, `pattern`, `action` (`allow`, `ask`, `deny`) | NoSQL `permissions` |
| **provider** | `id`, `name`, `kind` (parser), `url`, `key` (encrypted), `models[]`, `enabled` | settings file |
| **snapshot** | `id`, `sessionid`, `messageid`, `files[]` (path, hash, blob id) | NoSQL `snapshots` + FILESTORAGE blobs |
| **todo** | `id`, `sessionid`, `text`, `status` | NoSQL `todos` |

Names follow the conventions: lowercase, short, `id`, `dtcreated`, `dtupdated`; ids are `UID()`, dates are `NOW`.

## Parts

A message is an ordered list of parts, so the interface renders any step uniformly and a reload reproduces the screen.

| `type` | `data` |
|---|---|
| `text` | `{ text }` |
| `reasoning` | `{ text }` |
| `tool` | `{ call, tool, input, status: 'pending' \| 'running' \| 'done' \| 'error' \| 'denied', output, error, duration }` |
| `file` | `{ name, mime, blob }` (attachments) |
| `patch` | `{ files: [{ path, additions, deletions }] }` summary of the edits of a step |
| `step` | `{ tokens, cost, finish }` end of one model call |

Streaming deltas are not stored one by one: the loop buffers a part and writes it when it closes, and a crash leaves the last completed part.

## Snapshots and undo

Before a tool changes a file, `modules/snapshots.js` stores the previous content (FILESTORAGE blob, keyed by hash) and records it for the message. Undo of a message restores those files. If the project is a git repository the diff shown to the user is computed from snapshots, not from `git`, so unrelated uncommitted work never appears in a session's diff. The agent does not commit unless asked.

## Settings and secrets

- `config` (native config file): port, data folder, default provider, limits.
- `private/`: built-in catalogue of models, prompts and agent definitions (read-only, versioned).
- Provider keys are stored encrypted with a key derived from the application secret in `config`. They are written only by the settings action and never returned to the interface.

## Retention

Sessions stay until the user removes them. Removing a project removes its sessions, parts and snapshot blobs. Nothing is uploaded.
