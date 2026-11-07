// Shared state of the application
MAIN.running = {};   // sessionid -> state of a run in progress
MAIN.asks = {};      // askid -> pending permission question
MAIN.jobs = {};      // id -> a command that runs in the background (kept after Stop, ended with the session or the server)
MAIN.terminals = {}; // sessionid -> the interactive terminal of a session (a shell in a pseudo-terminal, opened by the user)
MAIN.children = {};  // sessionid -> child processes started by tools
MAIN.ws = null;      // the WebSocket controller
