# Interface

Single-page application in the Total.js admin style: jComponent 20, plugins loaded on demand, English keys translated with the native resources. Components come from the catalogue through `COMPONENTATOR()`; a missing one is a reusable `COMPONENT()` in `public/`.

## Layout

```
┌────────────┬───────────────────────────────┬───────────────┐
│ Projects   │ Session                       │ Side panel    │
│  └ sessions│  messages and parts           │  Files        │
│            │  prompt box                   │  Changes      │
│            │                               │  Terminal     │
└────────────┴───────────────────────────────┴───────────────┘
```

## What exists (phase 1)

Three plugins, mounted by the shell `views/index.html` with `page` components named by their `if` value (`projects`, `chat`) and two importers for the forms. Forms loaded by an importer use `~PATH~` (the importer's `if` value), not `CLASS`, for `miniform` `if` and `plugin`.

| Plugin | Files | Does |
|---|---|---|
| `projects` | `index.html`, `form.html` | Projects and their sessions; open a folder; new session; forget a project; opens Settings |
| `chat` | `index.html` | Messages with parts (text as Markdown, tool calls with input and output), permission questions, prompt box, model picker, stop; subscribes to the session over WebSocket and renders events |
| `settings` | `index.html`, `form.html` | Providers: list, add, edit, remove; the API key is write-only |

The login page (`views/login.html`) is used only when `token` is set in `config`.

## Screens (plugins)

| Plugin | Shows | Notes |
|---|---|---|
| `projects` | Projects and their sessions, open folder | Opening a folder uses the server's folder browser (a path field and a tree) |
| `chat` | The conversation: text, reasoning (collapsed), tool calls, permission questions, todo list | Renders from parts and events; Markdown with code highlighting |
| `prompt` | Input, model picker, agent picker, attachments, auto-accept toggle | `@file` mention completes from the file tree; `/` lists commands |
| `files` | Tree and file viewer with line numbers | Read-only in phase 1 |
| `diff` | Changes of the session, per file, accept/undo per message | Unified first, split later |
| `terminal` | Output of commands run by the agent; later an interactive shell | See [decisions](decisions.md) for the PTY |
| `settings` | Providers, models, permission rules, appearance, language | Keys are write-only fields |

## Behaviour that matters

- The chat renders only from stored parts plus events, so reload, a second browser tab and a native window show the same thing.
- A permission question is part of the conversation, answered inline, and visible in every open client.
- The prompt box stays usable while a run is going: a new prompt queues, `Esc` aborts.
- Long output (commands, files) is collapsed by default, with a size note.
- Dark and light themes follow the system (`intranetcss` with its dark mode).

## Components to reuse

From the Forge catalogue (https://forge.totaljs.es/en/components/): `exec`, `input`, `form`, `miniform`, `importer`, `menu`, `message`, `approve`, `notify`, `search`, `viewbox`, `navlayout`, `listing`, `datagrid`, `markdown`/`cloudeditor` for viewing and editing, `shortcuts`, `loading`, `errorhandler`. Each is verified against the catalogue page before use; anything absent becomes a new component listed in the roadmap phase that needs it.

## Accessibility and language

Keyboard-first (shortcuts for send, abort, switch session, accept/undo), focus managed after each event, labels for every control, all text as `@(English key)` with translations in `resources/`.
