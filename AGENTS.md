# AGENTS.md

Total.js Totem is an AI coding environment written as a Total.js 5 application. The design is in `docs/`; start at `docs/README.md`.

- Follow the Total.js 5 conventions at https://github.com/totaljs-es/conventions: ES5, Total.js prototypes, pipe-separated action names, `MODS`, jComponent 20, no TypeScript.
- Actions belong in `schemas/`, routes in `controllers/`, shared helpers in `FUNC` and state in `MAIN`.
- Use CONF and the native config file for settings; do not add environment overrides.
- The running application never reads `docs/`.
- When a page in `docs/` and the code disagree, resolve it in the same change.
