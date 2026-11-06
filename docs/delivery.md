# Delivery

One application, three ways to run it. Nothing is rewritten between them.

## Command line

```bash
npm install
node index.js 8000
```

`bin/totem.js` (`bin` of `package.json`, Node.js 22 or newer) wraps it for users:

| Command | Does |
|---|---|
| `totem` | Starts the server on port 8000 and opens the browser |
| `totem serve [port]` | Starts only the server |
| `totem run "prompt" [--project path] [--model name] [--url server] [--token t] [--auto-accept] [--yes]` | Headless: creates a session, subscribes to its events, sends the prompt, prints the answer on stdout and tool calls on stderr, exits 0 when the run ends idle and 1 otherwise. Without `--url` it starts a temporary local server. Permission questions are rejected unless `--yes` (allow once) or `--auto-accept` (file edits) is given |
| `totem config` | Prints the path of the config and data folders |

Today the data folder is `databases/` inside the application folder (`totem config` prints it). Moving it to a per-user folder is an open decision. A project can carry `.totem/` for skills.

## Docker

The image is the application and nothing else:

- Base: the maintained Node.js LTS on Alpine, pinned and updated with the security releases.
- Projects are bind-mounted (`/workspace`), data is a volume (`/data`), config is a mounted file.
- Runs as a non-root user. The server listens on `0.0.0.0` inside the container, so an access token is mandatory and the container refuses to start without one.
- Because commands run inside the container, this is also the isolated mode recommended for untrusted models ([security](security.md)).
- Published image, tags per version and for `latest`; a `compose` example in `docs/` for the common case.

## Native windows

A native app is a thin shell: it starts the same server on a random local port with a one-time token, loads `http://127.0.0.1:<port>` in a web view, and stops the server when the window closes. It adds only what a web page cannot do: a folder chooser, menu bar, notifications, file association, auto-start of the server, and update checks against the project's own release feed.

Shell technology is an open decision ([decisions](decisions.md)). Whatever it is, it must keep these properties:

- The server inside is the unmodified application (bundled Node.js runtime).
- macOS builds are signed and notarized; Windows and Linux artifacts are checksummed.
- The release workflow builds from a tag, per operating system and architecture, and publishes checksums with the installers.

## Releases

- One version number for the application, the image and the native builds.
- A tag `v<version>` starts the workflow; nothing publishes from a branch.
- Release notes list user-visible changes only.
