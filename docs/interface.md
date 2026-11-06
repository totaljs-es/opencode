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
| `projects` | `index.html`, `form.html` | Projects and their sessions (each session shows the icon of its provider); open a folder with a folder picker; new session; forget a project; opens Settings |
| `chat` | `index.html` | Messages with parts (text as Markdown, tool calls with input and output), permission questions, prompt box, model picker, stop; subscribes to the session over WebSocket and renders events |
| `settings` | `index.html`, `form.html` | Providers: look for servers on this computer and add them with their models, add from a template (Ollama, llama.cpp, LM Studio, OpenRouter, OpenAI...), load the full model list of a provider with search and Tools / Free filters, choose the models; the API key is write-only |

The login page (`views/login.html`) is used only when `token` is set in `config`.

## Choosing a folder

The folder of a project is chosen with the component `folder` (j-Folder), which browses the computer where Totem runs through `Folders|list`: a path bar, the folders of the current one, up, and shortcuts to Home, Volumes and Root. Only the names of folders are listed. The component `filebrowser` is not used: it is the file chooser of the browser, which never gives the path of a file on the computer, and a project needs a path. The picker uses `/` as separator; drives of Windows are not listed yet.

## Prompt box

`Enter` sends (the component `enter` with no delay). The text is read from the input at that moment, because the input copies its value to the model a little later than the key arrives.

## Design

- **IntranetCSS** (the component `intranetcss`) provides the base: `message`, `badge`, `caption`, `listing`, `toolbar`. Totem adds `public/css/default.css` with a few variables and its own buttons (`tbtn`, not `btn`, which jComponent already defines).
- **Dark theme.** IntranetCSS styles the class `ui-dark` of the body, which `APPEARANCE({ dark })` switches. Settings has Auto (follows the system), Light and Dark; the choice is kept in the browser.
- **Logo.** `assets/` keeps the sources. `public/img/totem-light.svg` (dark greens, for a light background) and `totem-dark.svg` (light greens) are shown with the class of the theme. The favicon and the app icons use the dark tile.
- **Provider icons.** `public/img/providers/*.svg` are drawn as a mask in the colour of the text, so they work in both themes. See `SOURCE.md` there. They appear in Settings, the template menu (a class of `default.css`, `provi provi-openai`, because the menu takes a class), the model selector (a template per item), the model of the session in the bar and the sessions of the sidebar. A provider without an icon shows its initial.

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
