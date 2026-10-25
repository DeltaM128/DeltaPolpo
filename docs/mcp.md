# Polpo as an MCP connector

Every Polpo server is also an [MCP](https://modelcontextprotocol.io) server. Claude Code, Codex, Claude Desktop, Cursor and any other MCP client can use your instance: ask Polpo to do things, chat with agents, follow tasks and missions, read data, make artifacts, approve requests, and call any REST operation.

- **Endpoint:** `https://<your-polpo-host>/mcp` (Streamable HTTP, stateless).
- **Authentication:** your Polpo API key, as `Authorization: Bearer <key>` (or `X-API-Key: <key>`). A server started without any API key or login accepts local calls without one, since it listens only on localhost.
- **Local process instead of a URL:** `polpo mcp --url <server> --api-key <key>` runs the same tools over stdio and forwards them to the server.

## Tools

The connector exposes a small set of tools designed for what people do, rather than one tool per endpoint. Hundreds of tool definitions would fill the model's context and make it choose worse.

| Tool | What it does |
|---|---|
| `ask_polpo` | Ask Polpo in natural language: it can do anything the instance can (plan, run, manage agents, query data, make artifacts). Returns a `session_id` to continue the conversation. |
| `chat_with_agent` | Talk to one agent, with its tools, memory and skills; `session_id` continues the conversation. |
| `list_agents` | The agents. |
| `list_tasks`, `get_task`, `create_task` | Follow and create tasks. |
| `list_missions`, `get_mission` | Missions and their plans. |
| `list_artifacts`, `get_artifact`, `create_artifact` | Documents, html dashboards and designs, diagrams. |
| `list_data_sources`, `query_data` | Structured data. |
| `list_approvals`, `resolve_approval` | Decide on requests that wait for a person. |
| `list_operations`, `call_operation` | Every REST operation of the server (more than 300), for anything else. |

Read-only tools are marked as such (`readOnlyHint`); `call_operation` and `resolve_approval` are marked destructive, so clients ask before running them.

## Setup

### Claude Code

```bash
claude mcp add --transport http polpo https://<your-polpo-host>/mcp --header "Authorization: Bearer <your-api-key>"
```

### OpenAI Codex

In `~/.codex/config.toml` (or `.codex/config.toml` in a trusted project):

```toml
[mcp_servers.polpo]
url = "https://<your-polpo-host>/mcp"
bearer_token_env_var = "POLPO_API_KEY"
```

Then export `POLPO_API_KEY` before starting Codex.

### Claude Desktop (local configuration)

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "polpo": {
      "command": "polpo",
      "args": ["mcp", "--url", "https://<your-polpo-host>"],
      "env": { "POLPO_API_KEY": "<your-api-key>" }
    }
  }
}
```

### Cursor and other clients with HTTP and headers

```json
{
  "mcpServers": {
    "polpo": {
      "url": "https://<your-polpo-host>/mcp",
      "headers": { "Authorization": "Bearer <your-api-key>" }
    }
  }
}
```

### Claude (web, Desktop, mobile) and ChatGPT as custom connectors

These connect with OAuth: a sign-in with your Polpo account instead of a key. OAuth support for the connector is coming next. Until then, use a client that sends the API key in a header.

## Security

- The API key gives the same access as the REST API: keep it secret, and never put it in a URL.
- Every tool goes through the server's own API, with the same checks as the dashboard.
- Serve Polpo over HTTPS when you expose it beyond localhost (for example with Tailscale or a reverse proxy).
