/**
 * Learning REST API — what agents learned from their conversations, and undo.
 *
 *   GET  /learning/:agent                       the agent's learning settings and recent changes
 *   POST /learning/:agent/review                review its conversations now
 *   POST /learning/:agent/changes/:id/revert    put back what was there before a change
 *
 * Settings change with the agent (PATCH /agents/:name { learning }) or by the agent (set_learning).
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { AgentConfig } from "@polpo-ai/core";
import type { LearningManager } from "../../core/learning.js";

export interface LearningRoutesDeps {
  manager?: LearningManager;
  getAgents: () => Promise<AgentConfig[]>;
}

export function learningRoutes(getDeps: () => LearningRoutesDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  const fail = (c: any, status: number, error: string) => c.json({ ok: false, error }, status);
  const agentOf = async (name: string) => (await getDeps().getAgents()).find((a) => a.name === name);

  app.get("/:agent", async (c) => {
    const agent = await agentOf(c.req.param("agent"));
    if (!agent) return fail(c, 404, "Agent not found");
    const manager = getDeps().manager;
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
    return c.json({ ok: true, data: { learning: agent.learning ?? { enabled: false }, changes: manager?.listChanges(agent.name, limit) ?? [] } });
  });

  app.post("/:agent/review", async (c) => {
    const agent = await agentOf(c.req.param("agent"));
    if (!agent) return fail(c, 404, "Agent not found");
    const manager = getDeps().manager;
    if (!manager) return fail(c, 503, "Learning is not available on this instance");
    const changes = await manager.review(agent.name, "manual");
    return c.json({ ok: true, data: { changes } });
  });

  app.post("/:agent/changes/:id/revert", async (c) => {
    const agent = await agentOf(c.req.param("agent"));
    if (!agent) return fail(c, 404, "Agent not found");
    const manager = getDeps().manager;
    if (!manager) return fail(c, 503, "Learning is not available on this instance");
    try {
      return c.json({ ok: true, data: { change: await manager.revert(agent.name, c.req.param("id")) } });
    } catch (err) {
      return fail(c, 409, err instanceof Error ? err.message : String(err));
    }
  });

  return app;
}
