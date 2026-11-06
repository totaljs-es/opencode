// Shared state of the application
MAIN.running = {};   // sessionid -> state of a run in progress
MAIN.asks = {};      // askid -> pending permission question
MAIN.children = {};  // sessionid -> child processes started by tools
MAIN.ws = null;      // the WebSocket controller
