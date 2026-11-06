# Architecture

## Shape

```
Browser / native window
        │  REST (+API routes)      WebSocket (events)
        ▼
┌──────────────────────────────────────────────┐
│ Total.js application (one Node.js process)   │
│                                              │
│  controllers/  routes                        │
│  schemas/      actions: API + agent tools    │
│  modules/      agent loop, runner, snapshots │
│  definitions/  auth, init, FUNC, providers   │
│  plugins/      interface screens             │
│                                              │
│  NoSQL (sessions, messages)  FILESTORAGE     │
└───────────────┬──────────────────────────────┘
                │  tools work inside the project root
                ▼
      project folder on disk  ·  model provider (HTTP)
```

One process, no worker fleet. Long jobs (a command, a model stream) are asynchronous inside it. A command that must not block the server runs as a child process that the runner supervises.

## Folders

Follows the Total.js 5 conventions.

| Folder | Content |
|---|---|
| `index.js` | Starts the framework (`F.run(options)`) |
| `config` | Port, data folder, defaults; secrets are read from here, never from the environment |
| `controllers/` | `api.js` (REST), `socket.js` (WebSocket), `default.js` (pages) |
| `schemas/` | One file per collection: `projects.js`, `sessions.js`, `messages.js`, `providers.js`, `permissions.js`, `settings.js` and `tools-*.js` for the agent tools |
| `definitions/` | `auth.js`, `init.js`, `func.js`, `db.js`, `providers.js` (registers the models) |
| `modules/` | `agent.js` (the loop), `runner.js` (commands), `snapshots.js`, `instructions.js`, `mcpclient.js` |
| `plugins/` | One folder per screen: `chat`, `files`, `diff`, `terminal`, `settings`, `projects` |
| `views/`, `public/`, `resources/` | Shell page, assets, translations |
| `private/` | Default model catalogue, built-in prompts, database scripts if any |
| `docs/` | These pages. The running application never reads them |
| `tests/` | Native tests (`total5/test`) with a disposable data folder |

## How Total.js features are used

| Need | Feature | Where it is defined |
|---|---|---|
| Talk to a model, stream the answer | `NEWAIMODEL(name, config, callback)`, `AIMODEL(...)` returning an object with `system`, `user`, `tool`, `stream`, `callback`, `promise` | `framework5/aimodel.js`, `global.js` |
| Parse provider streams | `AIPARSER(provider)` for `ollama`, `openai_chat`, `openai_responses`, `anthropic`, `gemini` | `framework5/aimodel.js` |
| Give the model tools | Every action has `toAITool()` returning `{ name, description, inputSchema }` | `framework5/builders.js`, `mcp.js` |
| Expose tools to other agents | Actions with `mcp: true` are served at `POST /$mcp/` when `CONF.$mcp` is set | `framework5/mcp.js` |
| Call an action internally | `ACTION('Tools\|read', payload).user(user).promise()` | `framework5/builders.js` |
| Push events to the interface | `ROUTE('+SOCKET ...')` | `framework5/websocket.js` |
| Store sessions | NoSQL databases; large blobs in FILESTORAGE | `framework5/nosql.js`, `filestorage.js` |
| Authentication | One `AUTH()`, cookie session | `definitions/auth.js` |
| Interface | jComponent 20, `COMPONENTATOR()`, `PLUGIN` | conventions `frontend/` |

The agent loop itself is not in the framework; it is the part we write ([agent loop](agent-loop.md)).

## The request path

1. The interface sends a prompt: `POST /api/sessions_prompt/{id}` (an `+API` route to `Sessions|prompt`).
2. The action stores the user message, answers at once with the message id, and starts the loop in `modules/agent.js`.
3. The loop streams the model answer and every step to the session's WebSocket subscribers as events ([protocol](protocol.md)).
4. Tool calls run through the permission check, then as actions inside the project root.
5. The loop ends when the model answers without tool calls, the user aborts, or a limit is reached. The final state is stored and a `session.idle` event is sent.

The interface never waits on the HTTP request for the answer: it renders from events, so a reload resumes from stored state plus live events.

## Processes and state

- **State in memory**: running sessions (abort handles, pending permission questions), open WebSocket subscriptions. Lost on restart; a restarted server marks interrupted runs as `aborted`.
- **State on disk**: everything else ([data model](data-model.md)).
- **One server, many users**: the model supports several users from the beginning (`$.user`); a single-user local install is the same code with one session cookie.

## Boundaries that keep it simple

- The agent never writes outside the project root of its session.
- The server never evaluates model output as code in its own process; commands run as child processes with the project as working directory.
- Providers are data, not code: a provider is a configuration that picks one of the five parsers.
