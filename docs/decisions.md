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
