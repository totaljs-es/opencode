# Capabilities

What Totem covers, grouped, each with the phase that delivers it ([roadmap](roadmap.md)). The list is the scope of a complete coding agent; nothing in it depends on a particular existing product.

| Area | Capability | Phase |
|---|---|---|
| **Models** | Providers by parser: OpenAI-compatible (includes OpenRouter), OpenAI Responses, Anthropic, Gemini, Ollama | 1 (one), 3 (all) |
| | Model list per provider, default model, per-session model | 1 / 3 |
| | Bundled catalogue of free and local models, editable by hand | 3 |
| | Reasoning/think mode where the provider supports it | 3 |
| | Token and cost counters per step and per session | 3 |
| | Retry with backoff, context compaction | 2 |
| **Agent** | Loop with streaming, abort, step limit | 1 |
| | Tools: read, glob, grep, write, edit, bash | 1 |
| | Tools: patch, fetch, todo, ask, skill | 2 |
| | Sub-agents and agent definitions in files | 3 |
| | Instructions from `AGENTS.md` (project and nested) | 2 |
| | Skills (folders with `SKILL.md`) | 2 |
| | Custom commands (`/name` from files) | 3 |
| | MCP client (stdio, HTTP) | 3 |
| | MCP server (selected actions via `/$mcp/`) | 3 |
| | Scheduled prompts | 5 |
| **Projects** | Open a folder, detect Total.js projects, list sessions | 1 |
| | File tree and viewer | 1 |
| | Git awareness: branch, status, working tree diff | 2 |
| | Worktrees for parallel sessions | 5 |
| | Attachments: images and files in the prompt | 3 |
| **Review** | Per-session diff, undo per message (snapshots) | 2 |
| | Split diff, accept/reject per file | 3 |
| **Safety** | Permission rules with ask/allow/deny, project boundary | 1 |
| | Auto-accept edits mode | 2 |
| | Output secret scanning | 2 |
| **Interface** | Chat, parts rendering, projects, settings | 1 |
| | Terminal output panel | 2 |
| | Interactive terminal (PTY) | 4 |
| | Language server diagnostics fed to the agent | 4 |
| | Shortcuts, themes, translations | 2 |
| **Delivery** | `totem` command, `totem run` headless | 2 |
| | Docker image | 5 |
| | Native windows (macOS, Windows, Linux), signed | 6 |
| **Total.js** | A skill pack and instructions for Total.js 5 projects (the conventions plugin) | 2 |
| | Knowledge tools: search the Forge documentation from the agent | 3 |

## Not planned

Hosted accounts, usage billing, a built-in model, voice input, sharing sessions through a public service. They can be revisited, each as its own decision.
