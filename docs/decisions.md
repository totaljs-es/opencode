# Decisions

## Taken

| Decision | Reason |
|---|---|
| Totem is a Total.js 5 application first; Docker and native windows wrap it | One codebase; the framework provides model streaming, tools, MCP, sockets and storage |
| English product text, Total.js conventions, ES5, no TypeScript | Same as the rest of Total.js |
| Sessions, messages and parts in NoSQL; blobs in FILESTORAGE | Append-heavy data owned by one process; no external database to install |
| Tools are actions (`Tools\|verb`); definitions come from `toAITool()` | Input declared once; anyone can add a tool |
| File and shell tools are not exposed through `/$mcp/` by default | A network endpoint with file and shell access is a risk |
| The server listens on `127.0.0.1` unless a token is configured | Safe default for a local app |
| Provider keys in the native config/settings, encrypted; no environment overrides | Project rule |
| The earlier prototype stays outside this repository | This repository is public and starts clean |
| Read-only tools are one list in `modules/agent.js` | Visible, and no property that the framework does not define |
| The model sees flattened arguments (`{ path, offset }`); the loop wraps them in `input` before calling the action | Fewer mistakes from small models, shorter prompts |
| `grep` and `glob` use the system `rg` when present and a built-in search otherwise | Works in a minimal Docker image and in native builds |
| Model lists come from the provider itself (`/api/tags` + `/api/show` for Ollama, `/models` for catalogues), not from a list bundled in Totem | A bundled list gets old; the provider knows its own models, context windows and prices |
| Total.js knowledge comes from Forge (MCP, asks first) and from the conventions (a skill and a check of what the tools write), only in projects that depend on `total5` | The agent knows Total.js without a bundled copy of the documentation, and other projects are not affected |
| Total.js is the default for new and Total.js folders, with the primer in the prompt and Forge searched before the first step | A small model does not call tools reliably, but it writes well from the page in front of it; the search is explicit and its pages are shown to the user |
| MIT licence, same holder as the other `totaljs-es` repositories | No inherited attribution: no code from the earlier prototype is copied |

## Open

| # | Question | Options | Needed by |
|---|---|---|---|
| 1 | Diff source | From snapshots (design); from git when available | Phase 2 |
| 2 | Interactive terminal | A PTY dependency (native module); pipes only, no TUI programs | Phase 4 |
| 3 | Language servers | Spawn per language on demand; skip | Phase 4 |
| 4 | Native shell technology | Electron; a system web view in Swift/C#/GTK per OS; Tauri | Phase 6 |
| 5 | Name of the headless command and the config folder | `totem`, `~/.totem` | Phase 2 |
| 6 | Context compaction summaries | Model-written with the session's own model; a cheaper configured model | Phase 2 |

## Ollama through its own API

Ollama's OpenAI-compatible `/v1` cuts the prompt to its default context (2048 or 4096 tokens), which removed part of Totem's system prompt and tool definitions, so small models answered with plain JavaScript. Providers of kind `ollama` now use `/api/chat` with `options.num_ctx` (`contextsize()` in `modules/provider.js`: at least `ollamactx`, grown in steps of 4096 to fit the request, never above the model window or `ollamactxmax`). Local servers get `temperature` from `config`. In Total.js projects a short reminder of the conventions is appended to the request. Forge tools are reduced to a whitelist in `private/mcp.json`, and starting Forge can be allowed once for every project.

## What was taken from OpenCode

Plan and Build modes, formatters after edits, `/init` and the secret-file rule were taken because they help small models and cost little. The boundary of the project stays a hard deny (OpenCode lets a project allow outside paths): a path outside the root is never read. LSP diagnostics were left out on purpose: the lint and test commands of the project in `AGENTS.md` do the same job with less noise. Then done: redo (one level), fork of a session, commands in the background with a `job` tool. Also done: MCP prompts (as a tool, not as slash commands, because a server only starts inside a run after the user allows it), instruction files in `.totem/instructions.json` (no URLs: no request to a third party that the user did not allow), `allow:` and `deny:` per agent, notices of the browser. The comparison with OpenCode is closed.
