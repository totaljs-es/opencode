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

## Open

| # | Question | Options | Needed by |
|---|---|---|---|
| 1 | Where does the agent loop get the read-only classification of tools | A list in `modules/agent.js`; a custom property on the action read by the loop | Phase 1 |
| 2 | Flatten `toAITool()` arguments for the model, or send the nested `input` object | Flatten (shorter, fewer model mistakes); keep nested (no translation layer) | Phase 1: try both with two models |
| 3 | Search tool | System `rg` when present with a built-in fallback; built-in only | Phase 1 |
| 4 | Diff source | From snapshots (design); from git when available | Phase 2 |
| 5 | Interactive terminal | A PTY dependency (native module); pipes only, no TUI programs | Phase 4 |
| 6 | Language servers | Spawn per language on demand; skip | Phase 4 |
| 7 | Native shell technology | Electron; a system web view in Swift/C#/GTK per OS; Tauri | Phase 6 |
| 8 | Licence of the application | MIT like the framework | Phase 1, before the first public code |
| 9 | Name of the headless command and the config folder | `totem`, `~/.totem` | Phase 2 |
| 10 | Context compaction summaries | Model-written with the session's own model; a cheaper configured model | Phase 2 |
