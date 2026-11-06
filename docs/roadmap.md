# Roadmap

Each phase ends when its condition is true, shown by a test or a demonstration, not by the list of work done.

## Phase 0: design

Pages in `docs/`, the repository skeleton, `AGENTS.md`, the conventions check. **Done when** the pages are reviewed and the open decisions of phase 1 are closed.

## Phase 1: the smallest working agent

- Application skeleton in the Total.js 5 layout, `config`, login for one local user.
- One provider through `NEWAIMODEL` (OpenAI-compatible, which reaches OpenRouter; Ollama second).
- Tools: read, glob, grep, write, edit, bash as `Tools|...` actions.
- The loop with streaming, abort and step limit; sessions and parts stored in NoSQL.
- Permission rules with ask/allow/deny and the project boundary.
- Interface: projects, chat with parts, permission questions, settings for one provider, file tree.

**Done when** a native test starts the server with a disposable data folder and a scripted fake provider, sends a prompt, and verifies the whole chain (stream events, a file edit, a permission ask, abort), and a manual session with a real model edits a Total.js project and the project still starts.

## Phase 2: review, context, daily use (implemented, see the notes below)

- Snapshots, per-session diff, undo; git status; auto-accept mode.
- `AGENTS.md` instructions, skills, patch/fetch/todo/ask tools, compaction, retry.
- Output secret scanning; terminal output panel; shortcuts, themes, translations.
- `totem` and `totem run`.
- The Total.js skill pack and conventions check available to the agent.

**Done when** one week of real work on Forge and a Total.js app uses it without leaving for another tool, and the test suite covers undo, compaction and secret scanning.

Status: snapshots, per-session diff, undo, auto-accept, `AGENTS.md`, skills, patch/fetch/todo/ask tools, retry, two levels of compaction, secret scanning, the changes panel, shortcuts (`Esc` stops, `Alt+D` toggles changes), `totem` and `totem run` are in code with tests. Not done yet: git status in the interface, terminal output panel, a full dark theme, translations, and shipping the Total.js conventions skills with Totem. The week of real use has not happened.

## Phase 3: breadth (in progress)

Done: provider templates, detection of Ollama, llama.cpp and LM Studio on this computer, full model lists with context window, tool, reasoning and free flags (Ollama through `/api/show`, catalogues through `/models`), a model without tool support gets a request without tools, the context window of the model sets the compaction limit, token usage per step with a counter in the session bar. Pending: the Anthropic and Gemini request formats and parsers, cost counters, reasoning mode controls, sub-agents, custom commands, MCP client and server, attachments, split diff, the Forge documentation search tool.


- All five provider parsers, model catalogue, reasoning mode, token and cost counters.
- Sub-agents, custom commands, MCP client and server, attachments, split diff.
- Forge documentation search tool.

**Done when** each provider kind passes a recorded-stream test and an MCP server's tools are used in a session.

## Phase 4: depth

Interactive terminal (PTY), language server diagnostics. **Done when** the agent reads diagnostics after an edit and the terminal survives a reload.

## Phase 5: shipping on servers

Docker image, scheduled prompts, worktrees for parallel sessions, multi-user hardening. **Done when** the image runs from `docker run` with a token, with a mounted project, and the smoke test passes in CI.

## Phase 6: native windows

Shell, signed installers for macOS, Windows and Linux, update feed. **Done when** a tag produces installers that open, start the server and complete a session on each system.
