import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentMemoryScope, type AgentConfig, type MemoryStore, type SessionStore } from "@polpo-ai/core";
import { FileLearningStore, LearningManager, isLearningExcluded, type LearningSkillPort } from "../core/learning.js";
import { createLearningTools, describeLearning, type LearningToolContext } from "../tools/learning-tools.js";

type Msg = { id: string; role: "user" | "assistant"; content: string; ts: string };

function sessionStore() {
  const sessions = new Map<string, { id: string; agent?: string; scope?: string; title?: string; createdAt: string; updatedAt: string; messageCount: number }>();
  const messages = new Map<string, Msg[]>();
  let n = 0;
  const store = {
    create: vi.fn(async (title?: string, agent?: string, opts?: { scope?: string }) => {
      const id = `s${++n}`;
      sessions.set(id, { id, title, agent, scope: opts?.scope, createdAt: "", updatedAt: new Date(Date.now() + n).toISOString(), messageCount: 0 });
      messages.set(id, []);
      return id;
    }),
    say: (id: string, role: "user" | "assistant", content: string) => {
      const m = { id: `m${++n}`, role, content, ts: "" };
      messages.get(id)!.push(m);
      return m;
    },
    getSession: vi.fn(async (id: string) => sessions.get(id)),
    listSessions: vi.fn(async () => [...sessions.values()]),
    getMessages: vi.fn(async (id: string) => messages.get(id) ?? []),
  };
  return store;
}

function memoryStore(): MemoryStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    exists: async (scope) => data.has(scope ?? ""),
    get: async (scope) => data.get(scope ?? "") ?? "",
    save: async (content, scope) => { data.set(scope ?? "", content); },
    append: async (line, scope) => { data.set(scope ?? "", `${data.get(scope ?? "") ?? ""}\n${line}`); },
    update: async () => true,
  };
}

function skillPort(): LearningSkillPort & { files: Map<string, string>; assigned: Map<string, Set<string>> } {
  const files = new Map<string, string>();
  const assigned = new Map<string, Set<string>>();
  return {
    files, assigned,
    read: (name) => files.get(name),
    write: (name, content) => { files.set(name, content); },
    remove: (name) => { files.delete(name); },
    assign: async (agent, name, on) => {
      const set = assigned.get(agent) ?? new Set();
      if (on) set.add(name); else set.delete(name);
      assigned.set(agent, set);
    },
  };
}

let dir: string;
let agents: AgentConfig[];
let sessions: ReturnType<typeof sessionStore>;
let memory: ReturnType<typeof memoryStore>;
let skills: ReturnType<typeof skillPort>;
let emitted: any[];
let manager: LearningManager;
const runner = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polpo-learning-"));
  agents = [
    { name: "ops", learning: { enabled: true, everyMessages: 4, idleMinutes: 0 } },
    { name: "quiet" },
  ];
  sessions = sessionStore();
  memory = memoryStore();
  skills = skillPort();
  emitted = [];
  runner.mockReset();
  manager = new LearningManager({
    getAgents: async () => agents,
    sessions: sessions as unknown as SessionStore,
    memory,
    store: new FileLearningStore(dir),
    skills,
    createReviewSession: (agent) => sessions.create(`Learning: ${agent}`, agent, { scope: `learning:${agent}` }),
    emit: (_event, payload) => { emitted.push(payload); },
    log: () => {},
  });
  manager.setRunner(runner);
});
afterEach(() => {
  manager.dispose();
  rmSync(dir, { recursive: true, force: true });
});

async function say(sessionId: string, role: "user" | "assistant", content: string) {
  const m = sessions.say(sessionId, role, content);
  await manager.onMessageAdded(sessionId);
  return m;
}

describe("LearningManager", () => {
  it("reviews after N messages of an agent that learns, and only the new messages the next time", async () => {
    const chat = await sessions.create("Deploys", "ops");
    const other = await sessions.create("Other", "quiet");
    runner.mockImplementation(async ({ prompt }: { prompt: string }) => {
      await memory.save("- deploys are at 5pm", agentMemoryScope("ops"));
      return { text: `learned (${prompt.length})` };
    });

    await say(other, "user", "not learning");
    await say(chat, "user", "we deploy at 5pm");
    await say(chat, "assistant", "noted");
    await say(chat, "user", "on fridays too");
    expect(runner).not.toHaveBeenCalled();
    await say(chat, "assistant", "ok");
    await vi.waitFor(() => expect(emitted).toHaveLength(1));

    const prompt = runner.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("4 new message(s)");
    expect(prompt).toContain("Them: we deploy at 5pm");
    expect(prompt).toContain("You: noted");
    expect(prompt).not.toContain("not learning");
    expect(runner.mock.calls[0]![0].agent.name).toBe("ops");
    expect(emitted[0]).toMatchObject({ agentName: "ops", messages: 4, changes: [{ kind: "memory", target: "memory" }] });

    // the next review starts after what was reviewed
    runner.mockResolvedValue({ text: "nothing" });
    for (const text of ["a", "b", "c", "d"]) await say(chat, "user", text);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
    const second = runner.mock.calls[1]![0].prompt as string;
    expect(second).not.toContain("we deploy at 5pm");
    expect(second).toContain("Them: d");
  });

  it("does not learn from its own reviews or from recurring checks", async () => {
    expect(isLearningExcluded("learning:ops")).toBe(true);
    expect(isLearningExcluded("check:chk_1")).toBe(true);
    expect(isLearningExcluded("telegram:group:-100")).toBe(false);
    const review = await sessions.create("Learning: ops", "ops", { scope: "learning:ops" });
    for (let i = 0; i < 6; i++) await say(review, "assistant", "x");
    expect(runner).not.toHaveBeenCalled();
  });

  it("reviews what is pending when the conversation goes quiet", async () => {
    vi.useFakeTimers();
    try {
      agents[0]!.learning = { enabled: true, everyMessages: 100, idleMinutes: 30 };
      runner.mockResolvedValue({ text: "nothing" });
      const chat = await sessions.create("Chat", "ops");
      for (const text of ["a", "b", "c", "d"]) await say(chat, "user", text);
      expect(runner).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a memory change can be reverted, unless the memory changed again", async () => {
    await memory.save("old", agentMemoryScope("ops"));
    runner.mockImplementation(async () => { await memory.save("new", agentMemoryScope("ops")); return { text: "updated memory" }; });
    const chat = await sessions.create("Chat", "ops");
    for (const text of ["a", "b", "c", "d"]) sessions.say(chat, "user", text);
    const [change] = await manager.review("ops");
    expect(change).toMatchObject({ kind: "memory", before: "old", after: "new", source: "review" });

    await memory.save("newer", agentMemoryScope("ops"));
    await expect(manager.revert("ops", change!.id)).rejects.toThrow(/changed again/);
    await memory.save("new", agentMemoryScope("ops"));
    expect(await manager.revert("ops", change!.id)).toMatchObject({ revertedAt: expect.any(String) });
    expect(memory.data.get(agentMemoryScope("ops"))).toBe("old");
    await expect(manager.revert("ops", change!.id)).rejects.toThrow(/already reverted/);
  });
});

describe("learning tools", () => {
  function tools(agent: AgentConfig, owned: string[] = []) {
    const updates: unknown[] = [];
    const ctx: LearningToolContext = {
      agent, manager, skills,
      ownedSkills: () => owned,
      createOwnedSkill: async (name, description, content) => {
        const file = `---\nname: ${name}\ndescription: ${description}\n---\n${content}`;
        skills.write(name, file);
        owned.push(name);
        await skills.assign(agent.name, name, true);
        return file;
      },
      skillFile: (name, description, content) => `---\nname: ${name}\ndescription: ${description}\n---\n${content}`,
      updateLearning: async (learning) => { updates.push(learning); },
    };
    const list = createLearningTools(ctx);
    const run = (name: string, args: object) => list.find((t) => t.name === name)!.execute("id", args as any)
      .then((r: any) => r.content[0].text as string);
    return { names: list.map((t) => t.name), run, updates };
  }

  it("set_learning is always there and tells the current setting; skill tools only while learning with skills", async () => {
    const off = tools({ name: "quiet" });
    expect(off.names).toEqual(["set_learning"]);
    expect(describeLearning(undefined)).toContain("OFF");
    expect(await off.run("set_learning", { enabled: true, every_messages: 2 })).toContain("every 5 new messages");
    expect(off.updates[0]).toEqual({ enabled: true, everyMessages: 5 });
    expect(tools({ name: "ops", learning: { enabled: true, skills: false } }).names).toEqual(["set_learning"]);
    expect(tools(agents[0]!).names).toEqual(["set_learning", "list_my_skills", "create_my_skill", "update_my_skill"]);
  });

  it("a skill created during a review is recorded and can be reverted; others' skills cannot be updated", async () => {
    skills.write("shared", "---\nname: shared\n---\nteam procedure");
    const { run } = tools(agents[0]!);
    runner.mockImplementation(async () => {
      await run("create_my_skill", { name: "weekly-report", description: "How to write the weekly report", content: "1. Collect\n2. Send" });
      return { text: "created weekly-report" };
    });
    const chat = await sessions.create("Chat", "ops");
    for (const text of ["a", "b", "c", "d"]) sessions.say(chat, "user", text);
    const changes = await manager.review("ops");
    const created = changes.find((c) => c.kind === "skill-created")!;
    expect(created).toMatchObject({ target: "weekly-report", source: "review" });
    expect(skills.assigned.get("ops")?.has("weekly-report")).toBe(true);
    expect(emitted.at(-1).changes).toEqual([{ id: created.id, kind: "skill-created", target: "weekly-report" }]);

    expect(await run("update_my_skill", { name: "shared", description: "x", content: "y" })).toMatch(/not one of your own skills/);
    expect(await run("update_my_skill", { name: "weekly-report", description: "How to write the weekly report", content: "1. Collect\n2. Review\n3. Send" })).toBe('Skill "weekly-report" updated.');
    const updated = manager.listChanges("ops").find((c) => c.kind === "skill-updated")!;
    expect(updated.source).toBe("chat");

    await expect(manager.revert("ops", created.id)).rejects.toThrow(/changed again/);
    await manager.revert("ops", updated.id);
    await manager.revert("ops", created.id);
    expect(skills.files.has("weekly-report")).toBe(false);
    expect(skills.assigned.get("ops")?.has("weekly-report")).toBe(false);
  });
});
