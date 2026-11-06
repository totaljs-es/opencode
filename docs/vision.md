# Vision

## What it is

A coding agent for people who build with Total.js, and for anyone else who wants a local, inspectable one. It is a normal Total.js application: `node index.js` starts a server, the browser (or a native window) is the interface.

## Why a Total.js application first

1. **One codebase for every form.** The terminal command, the Docker image and the desktop window are the same server. Nothing is ported.
2. **The framework already has the pieces.** Model streaming (`NEWAIMODEL`), tools (an action converts to a tool definition with `toAITool()`), MCP, WebSocket, NoSQL, FILESTORAGE, jComponent. We write the agent, not the plumbing.
3. **It proves something.** An AI development environment built only with Total.js is the best example of what a Total.js application can be.
4. **People can read it.** The agent's tools are actions in `schemas/`; whoever knows Total.js knows how to add one.

## Who it is for

- Total.js developers who want an agent that already knows the conventions of the framework.
- Teams that need the agent on their own server, with their own model, and nothing leaving it.
- Anyone who wants to choose the model: free cloud, local (Ollama) or paid, per session.

## Principles

- **The model is yours.** Totem calls only the provider you configure. No hosted service of ours sits in the middle and nothing is sent anywhere by default.
- **Local first.** Projects, sessions and settings are files and databases on your disk.
- **Nothing happens silently.** Edits are shown as diffs, commands are shown before they run unless you allowed them, and every change can be undone.
- **Small surface.** An action does one thing. A tool is an action. A screen is a plugin.
- **Total.js conventions.** The code follows https://github.com/totaljs-es/conventions: ES5, prototypes, pipe action names, `MODS`, jComponent 20, no TypeScript.

## What it will not do

- It will not be a hosted service or require an account.
- It will not bundle a model; it connects to one.
- It will not hide the agent's steps: every tool call is visible and logged.
- It will not depend on a particular editor. An editor integration can come later over the same API.

## Success

A developer installs Totem, points it at a Total.js project and a model, asks for a feature, reviews a diff, accepts it, and the app still runs. The first phase in [roadmap](roadmap.md) is that sentence, reduced to the smallest working version.
