# Agent loop and tools

## The loop (`modules/agent.js`)

```
run(session, message)
  messages = system prompt + instructions + history + message
  repeat
    stream the model answer          → events: text and reasoning deltas
    collect tool calls
    if none: finish
    for each tool call
      permission check               → may ask the user and wait
      run the tool action            → events: tool start / end
      append the tool result
  until finish, abort or step limit
```

Design points:

- **One model call per step.** A step is one request to the provider; its answer holds text, reasoning and zero or more tool calls. Calls of one step run in order unless the tool is marked read-only, in which case they run together.
- **Streaming first.** The loop uses `AIMODEL(name)...stream(fn)` and forwards each delta. The provider-specific parsing is the framework's (`AIPARSER`).
- **Abort is a first-class state.** Aborting cancels the stream, kills running child processes and stores the partial answer.
- **Step limit.** A session has `maxsteps` (default 50). Reaching it ends the run with a visible reason, never silently.
- **Retries.** A failed provider call retries with backoff for transient errors (network, 429, 5xx) and stops on authentication or invalid request errors.
- **Context size.** Before each call the loop estimates tokens. Over the model limit it compacts: old tool results are replaced by a one-line summary, then old turns by a model-written summary. The stored history is never rewritten; compaction produces a derived message list.

## The prompt

Built in this order; each part is a file or a function, never a hidden string:

1. Base prompt (`private/prompts/base.txt`): role, how to use tools, how to answer.
2. Environment: working directory, platform, date, whether the folder is a git repository.
3. Instructions found in the project: `AGENTS.md` and its pointers, loaded from the project root and, when the agent reads a file, from that file's folders.
4. Skills: name and description of each available skill; the body loads when the agent asks for it.
5. The tool definitions.

## Tools are actions

Each tool is a `NEWACTION` in `schemas/tools-*.js` named `Tools|verb`. The model-facing definition comes from the action itself (`toAITool()`), so the input declaration is written once and serves validation and the model.

```js
NEWACTION('Tools|read', {
	name: 'Read a file',
	summary: 'Reads a text file of the project, optionally a range of lines.',
	input: '*path:String // Path relative to the project root, offset:Number // First line, limit:Number // Number of lines',
	action: function($, model) {
		// resolves the path inside the project root, reads, returns numbered lines
	}
});
```

Notes:

- `toAITool()` produces arguments nested as `input` / `query` / `params`. The loop flattens them for the model (tools use `input` only). `ACTION(name, payload)` receives the flat payload as the input.
- Field comments after `//` are the argument descriptions the model sees.
- Tools are **not** exposed through `/$mcp/` by default. File and shell tools behind a network endpoint are a risk; `mcp: true` is a per-tool setting that stays off until someone turns it on.
- Whether a tool is read-only is not an action property of the framework. The loop keeps it in one list in `modules/agent.js` (design).
- The runtime context (project root, session, user) travels with the call as `.user(user)` plus the action `env`/options, never as global state.

### Core tools

| Tool | Does | Read-only |
|---|---|---|
| `Tools\|read` | Reads a file or lists a directory | yes |
| `Tools\|glob` | Finds files by pattern | yes |
| `Tools\|grep` | Searches content (uses the system `rg` when present, a built-in search otherwise) | yes |
| `Tools\|write` | Creates or replaces a file | no |
| `Tools\|edit` | Replaces an exact string in a file | no |
| `Tools\|patch` | Applies a multi-file patch | no |
| `Tools\|bash` | Runs a shell command with timeout and output limit | no |
| `Tools\|fetch` | Fetches a URL as text or Markdown | yes |
| `Tools\|todo` | Keeps the visible task list of the session | no |
| `Tools\|ask` | Asks the user a question and waits | no |
| `Tools\|task` | Starts a sub-agent with its own context ([capabilities](capabilities.md)) | no |
| `Tools\|skill` | Loads the body of a skill | yes |

Every file tool: resolves paths against the project root, refuses anything that leaves it, records a snapshot before changing a file, truncates large output and says it truncated.

### Tools from outside

Tools from MCP servers (stdio and HTTP) are registered at session start by `modules/mcpclient.js`. They appear to the loop as tools named `server_tool` and pass through the same permission check.

## Sub-agents

`Tools|task` starts a nested run with a fresh context, a restricted tool list and its own step limit; only its final answer returns to the parent. Agent definitions are files (`.totem/agents/*.md` in the project, `private/agents/*.md` built in) with a name, description, tool list and prompt.
