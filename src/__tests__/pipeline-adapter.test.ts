import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:net";
import { spawnPipeline, agentForLoop, taskForLoop, splitOutcomes, hasPipeline } from "../adapters/pipeline.js";
import { createActivity } from "../adapters/engine.js";
import { createHumanRelay } from "../core/pipeline/human-relay.js";
import { startNotificationServer, getSocketPath, type PipelineHumanMessage, type PipelineHumanReply } from "../core/notification.js";
import type { AgentHandle } from "../core/adapter.js";
import type { AgentConfig, Task, TaskOutcome } from "../core/types.js";

const task = {
  id: "t1",
  title: "Handle ticket",
  description: "Customer says they were charged twice.",
  expectations: [],
} as unknown as Task;

const agent: AgentConfig = {
  name: "support-router",
  role: "Support",
  model: "anthropic:base",
  systemPrompt: "You are support.",
  allowedTools: ["read", "write"],
  loops: {
    triage: {
      systemPrompt: "Classify the ticket.",
      tools: ["read"],
      model: "openai:small",
      stopWhen: { expression: "context.ticket.category != null" },
      output: { schema: { type: "object", required: ["category"] } },
    },
    refund: { maxTurns: 5 },
    resolve: {},
  },
  pipeline: {
    steps: [
      { loop: "triage" },
      {
        switch: {
          cases: [{ when: "context.ticket.category == 'billing'", steps: [{ human: "refund_ok", notify: ["ops"] }, { loop: "refund" }] }],
          default: { steps: [{ loop: "resolve" }] },
        },
      },
    ],
  },
};

const outcome = (label: string, data: unknown, type: TaskOutcome["type"] = "json"): TaskOutcome =>
  ({ id: label, type, label, data, producedAt: "now" }) as TaskOutcome;

/** Fake engine: each spawn plays the next scripted session. */
function fakeEngine(script: Array<(agent: AgentConfig, task: Task) => { exitCode: number; outcomes?: TaskOutcome[] }>) {
  const spawned: Array<{ agent: AgentConfig; task: Task }> = [];
  const spawn = (a: AgentConfig, t: Task): AgentHandle => {
    const play = script[spawned.length];
    spawned.push({ agent: a, task: t });
    const result = play(a, t);
    const activity = createActivity();
    activity.toolCalls = 2;
    return {
      agentName: a.name, taskId: t.id, startedAt: "now", pid: 0, activity,
      done: Promise.resolve({ exitCode: result.exitCode, stdout: "", stderr: result.exitCode ? "boom" : "", duration: 1 }),
      outcomes: result.outcomes,
      isAlive: () => false,
      kill: () => {},
    };
  };
  return { spawn: spawn as never, spawned };
}

describe("pipeline adapter", () => {
  it("detects agents with a pipeline", () => {
    expect(hasPipeline(agent)).toBe(true);
    expect(hasPipeline({ name: "plain" })).toBe(false);
  });

  it("applies loop overrides and never nests pipelines", () => {
    const a = agentForLoop(agent, "triage", agent.loops!.triage);
    expect(a).toMatchObject({ model: "openai:small", allowedTools: ["read"], systemPrompt: "You are support.\n\nClassify the ticket." });
    expect(a.pipeline).toBeUndefined();
    expect(a.loops).toBeUndefined();
    expect(agentForLoop(agent, "resolve", {}).model).toBe("anthropic:base");
  });

  it("tells the loop about the context, schema, stop condition and feedback", () => {
    const t = taskForLoop(task, { loopName: "triage", loop: agent.loops!.triage, context: { a: 1 }, attempt: 2, feedback: "missing category" });
    expect(t.description).toContain("charged twice");
    expect(t.description).toContain('"a": 1');
    expect(t.description).toContain("label: 'output'");
    expect(t.description).toContain("context.ticket.category != null");
    expect(t.description).toContain("missing category");
  });

  it("separates pipeline outcomes from task outcomes", () => {
    const split = splitOutcomes([outcome("context", { a: { b: 1 } }), outcome("context", { a: { c: 2 } }), outcome("output", 42), outcome("Report", null, "file")]);
    expect(split.contextPatch).toEqual({ a: { b: 1, c: 2 } });
    expect(split.output).toBe(42);
    expect(split.taskOutcomes.map((o) => o.label)).toEqual(["Report"]);
  });

  it("runs the pipeline through engine sessions and a human decision", async () => {
    const { spawn, spawned } = fakeEngine([
      () => ({ exitCode: 0, outcomes: [outcome("context", { ticket: { category: "billing" } }), outcome("output", { category: "billing" })] }),
      () => ({ exitCode: 0, outcomes: [outcome("Refund receipt", null, "file")] }),
    ]);
    const humans: string[] = [];
    const handle = spawnPipeline(agent, task, "/work", { polpoDir: "/p" }, {
      spawn,
      requestHuman: async (req) => { humans.push(`${req.name}:${req.step.notify?.join(",")}`); return { approved: true }; },
    });
    const transcript: Record<string, unknown>[] = [];
    handle.onTranscript = (e) => transcript.push(e);

    const result = await handle.done;
    expect(result.exitCode).toBe(0);
    expect(spawned.map((s) => s.agent.model)).toEqual(["openai:small", "anthropic:base"]);
    expect(spawned[1].agent.maxTurns).toBe(5);
    expect(humans).toEqual(["refund_ok:ops"]);
    expect(handle.outcomes!.map((o) => o.label)).toEqual(["Refund receipt", "Pipeline context"]);
    expect(handle.activity.toolCalls).toBe(4);
    expect(result.stdout).toContain('"category": "billing"');
    expect(transcript.some((e) => e.type === "pipeline" && String(e.text).includes("Pipeline completed"))).toBe(true);
  });

  it("fails the task when a loop session fails", async () => {
    const { spawn } = fakeEngine([() => ({ exitCode: 1 })]);
    const handle = spawnPipeline(agent, task, "/work", undefined, { spawn, requestHuman: async () => ({ approved: true }) });
    const result = await handle.done;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Loop "triage" failed');
  });
});

describe("human relay over the notification socket", () => {
  let server: Server | undefined;
  let dir: string | undefined;

  afterEach(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("creates an approval and returns the decision once resolved", async () => {
    dir = mkdtempSync(join(tmpdir(), "polpo-pipeline-"));
    const requests = new Map<string, { status: "pending" | "approved" | "rejected"; note?: string; msg: PipelineHumanMessage }>();
    server = startNotificationServer(dir, () => {}, undefined, undefined, async (msg): Promise<PipelineHumanReply> => {
      if (msg.type === "pipeline_human_request") {
        requests.set(msg.requestId, { status: "pending", msg });
        // Someone approves shortly after.
        setTimeout(() => { const r = requests.get(msg.requestId)!; r.status = "rejected"; r.note = "not now"; }, 30);
        return { ok: true, status: "pending" };
      }
      const r = requests.get(msg.requestId);
      return r ? { ok: true, status: r.status, note: r.note } : { ok: false, error: "unknown" };
    });
    await new Promise((r) => server!.once("listening", r));

    const relay = createHumanRelay({ socketPath: getSocketPath(dir), runId: "r1", taskId: "t1", agentName: "support-router", pollMs: 10 });
    const decision = await relay({
      name: "refund_ok",
      step: { human: "refund_ok", notify: ["ops"] },
      context: { ticket: { category: "billing" } },
      signal: new AbortController().signal,
    });

    expect(decision).toEqual({ approved: false, note: "not now" });
    const [created] = [...requests.values()];
    expect(created.msg).toMatchObject({ type: "pipeline_human_request", taskId: "t1", step: "refund_ok", notify: ["ops"] });
  });

  it("fails clearly when the orchestrator is unreachable", async () => {
    dir = mkdtempSync(join(tmpdir(), "polpo-pipeline-"));
    const relay = createHumanRelay({ socketPath: getSocketPath(dir), runId: "r1", taskId: "t1", agentName: "a", pollMs: 5, requestAttempts: 2 });
    await expect(relay({ name: "x", step: { human: "x" }, context: {}, signal: new AbortController().signal }))
      .rejects.toThrow('Could not request approval for "x"');
  });
});
