## Debugging

- To test the opencode app, use the playwright MCP server, the app is already
  running at http://localhost:3000
- NEVER try to restart the app, or the server process, EVER.
- When running the app in the browser (not desktop), it connects to the OpenCode server at `http://localhost:4096` by default. Start the server with `opencode serve --port 4096` (or set `VITE_OPENCODE_SERVER_PORT`; see `.env.example`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
