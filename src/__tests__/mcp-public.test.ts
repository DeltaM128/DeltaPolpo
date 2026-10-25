import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";

// An instance with no API key on its dashboard and REST API that publishes only its MCP connector,
// mounted under a path by a public proxy (Tailscale Funnel: https://host/shoplix → http://127.0.0.1:3000).
const PUBLIC = "https://polpo.example.com/shoplix";
const MCP_KEY = "mcp-key-for-tests";
let tmpDir: string;
let app: Hono;

beforeAll(async () => {
  process.env.POLPO_PUBLIC_URL = PUBLIC;
  process.env.POLPO_MCP_KEY = MCP_KEY;
  tmpDir = await mkdtemp(join(tmpdir(), "polpo-mcp-public-"));
  await mkdir(join(tmpDir, ".polpo"), { recursive: true });
  await writeFile(join(tmpDir, ".polpo", "polpo.json"), JSON.stringify({
    project: "mcp-public", team: { name: "t", agents: [{ name: "agent-1", role: "Test agent" }] }, settings: { logLevel: "quiet" },
  }));
  const { Orchestrator } = await import("../core/orchestrator.js");
  const { SSEBridge } = await import("../server/sse-bridge.js");
  const { createApp } = await import("../server/app.js");
  const orchestrator = new Orchestrator(tmpDir);
  await orchestrator.initInteractive("mcp-public", { name: "t", agents: [{ name: "agent-1", role: "Test agent" }] });
  app = createApp(orchestrator, new SSEBridge(orchestrator), { workDir: tmpDir });
}, 30_000);

afterAll(async () => {
  delete process.env.POLPO_PUBLIC_URL;
  delete process.env.POLPO_MCP_KEY;
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

const publicHeaders = { "x-forwarded-host": "polpo.example.com", "x-forwarded-proto": "https" };
const initialize = (headers: Record<string, string>) => app.request("/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
});

describe("MCP connector published on its own", () => {
  it("needs the MCP key or a token, and points clients to the public URL", async () => {
    const res = await initialize(publicHeaders);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource/mcp"`);
    expect((await initialize({ ...publicHeaders, authorization: `Bearer ${MCP_KEY}` })).status).toBe(200);
    expect((await initialize({ ...publicHeaders, authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("the MCP key leaves the dashboard and REST API as they were", async () => {
    expect((await app.request("/api/v1/agents")).status).toBe(200);
  });

  it("the public URL applies only to requests through its host", async () => {
    const pub = await (await app.request("/.well-known/oauth-protected-resource/mcp", { headers: publicHeaders })).json();
    expect(pub).toMatchObject({ resource: `${PUBLIC}/mcp`, authorization_servers: [PUBLIC] });
    // the same instance on the tailnet, on its own port
    const tailnet = await (await app.request("/.well-known/oauth-protected-resource/mcp", {
      headers: { "x-forwarded-host": "lumea-dev.example.ts.net:3000", "x-forwarded-proto": "https" },
    })).json();
    expect(tailnet.resource).toBe("https://lumea-dev.example.ts.net:3000/mcp");
  });

  it("the consent page takes the MCP key, and posts back under the mount path", async () => {
    const reg = await (await app.request("/oauth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
    })).json();
    const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
    const params = {
      response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: challenge, code_challenge_method: "S256", state: "s1", resource: `${PUBLIC}/mcp`,
    };
    const page = await (await app.request(`/oauth/authorize?${new URLSearchParams(params)}`, { headers: publicHeaders })).text();
    expect(page).toContain('action="authorize"');
    expect(page).toContain('name="api_key"');
    const csrf = page.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";
    const submit = (key: string) => app.request("/oauth/authorize", {
      method: "POST", headers: { ...publicHeaders, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, csrf, decision: "allow", api_key: key }).toString(),
    });
    expect((await submit("wrong")).status).toBe(401);
    const ok = await submit(MCP_KEY);
    expect(ok.status).toBe(302);
    const back = new URL(ok.headers.get("location")!);
    expect(back.searchParams.get("code")).toMatch(/^polpo_code_/);
    expect(back.searchParams.get("iss")).toBe(PUBLIC);
  });
});
