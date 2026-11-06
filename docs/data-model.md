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
| **provider** | `id`, `name`, `url`, `kind` (`openai`, `ollama`, `openrouter`: how its models are listed), `key` (encrypted), `models[]` (the ones a session can use), `meta` (per model: `context`, `tools`, `reasoning`, `free`, `size`; unknown values are null), `disabled` | NoSQL `providers` |
| **snapshot** | `id`, `sessionid`, `messageid`, `path`, `existed`, `size`, `dtcreated` | NoSQL `snapshots` + a file per snapshot |
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
| `compaction` | `{ removed, summary }` older turns were replaced by a summary in what is sent to the model (the stored history is untouched) |

Streaming deltas are not stored one by one: the loop buffers a part and writes it when it closes, and a crash leaves the last completed part.

## Snapshots and undo

Before a tool changes a file, `modules/snapshots.js` stores the previous content (a file in `databases/snapshots/<id>`, up to 2 MB; larger files are recorded without content and cannot be restored) and a `snapshots` document for the message. Only the first change of a file in a message is kept. Undo of a message restores those files. If the project is a git repository the diff shown to the user is computed from snapshots, not from `git`, so unrelated uncommitted work never appears in a session's diff. The agent does not commit unless asked.

## Settings and secrets

- `config` (native config file): port, data folder, default provider, limits.
- `private/`: built-in catalogue of models, prompts and agent definitions (read-only, versioned).
- Provider keys are stored encrypted with the application secret (`secret` in `config`; when empty, a random one is created once in `databases/secret.txt`). `Providers|save` writes them and `Providers|list` never returns them (only `haskey`). Phase 1 implements the `openai` kind (Chat Completions); the other parsers come in phase 3.

## Retention

Sessions stay until the user removes them. Removing a project removes its sessions, parts and snapshot blobs. Nothing is uploaded.
