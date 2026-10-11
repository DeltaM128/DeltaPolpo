import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileConversationCheckStore } from "../stores/file-conversation-check-store.js";
import { ConversationCheckManager, isNothingToReport, MAX_ACTIVE_CHECKS_PER_SESSION } from "../core/conversation-check-manager.js";
import { execCancelCheck, execListChecks, execScheduleCheck } from "../tools/conversation-check-tools.js";

const GROUP = { channel: "team-bot", chatId: "-100123", conversation: "telegram:group:-100123" };

let dir: string;
let store: FileConversationCheckStore;
let manager: ConversationCheckManager;
const runner = vi.fn();
const delivery = vi.fn(async () => {});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polpo-checks-"));
  store = new FileConversationCheckStore(dir);
  manager = new ConversationCheckManager(store);
  runner.mockReset();
  delivery.mockClear();
  manager.setRunner(runner);
  manager.setDelivery(delivery);
});
afterEach(() => {
  manager.dispose();
  rmSync(dir, { recursive: true, force: true });
});

/** Run what is due and wait for the runs it started. */
async function tick(at: Date): Promise<void> {
  await manager.tick(at);
  await vi.waitFor(() => expect((manager as any).running.size).toBe(0));
}
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("ConversationCheckManager", () => {
  it("delivers a report, stays silent on NO_UPDATE, schedules the next run", async () => {
    const check = await manager.create({ sessionId: "s1", agent: "ops", prompt: "is the site up?", everyMinutes: 2, target: GROUP });
    await tick(new Date()); // not due yet
    expect(runner).not.toHaveBeenCalled();

    runner.mockResolvedValueOnce({ text: "NO_UPDATE" });
    await tick(later(3));
    expect(runner).toHaveBeenCalledTimes(1);
    expect(delivery).not.toHaveBeenCalled();
    let current = await store.getCheck(check.id);
    expect(current).toMatchObject({ runs: 1, state: "active" });
    expect(current!.nextRunAt > check.nextRunAt).toBe(true);

    runner.mockResolvedValueOnce({ text: "  The site is down (502).  " });
    await tick(later(10));
    expect(delivery).toHaveBeenCalledWith(expect.objectContaining({ id: check.id }), "The site is down (502).");
    current = await store.getCheck(check.id);
    expect(current).toMatchObject({ runs: 2, lastReport: "The site is down (502)." });
  });

  it("ends after max runs; a deferred run is retried; errors keep the schedule", async () => {
    const check = await manager.create({ sessionId: "s1", prompt: "ping", everyMinutes: 1, maxRuns: 2 });
    runner.mockResolvedValueOnce("deferred");
    await tick(later(2));
    expect((await store.getCheck(check.id))!.runs).toBe(0);

    runner.mockRejectedValueOnce(new Error("model unavailable"));
    await tick(later(2));
    expect(await store.getCheck(check.id)).toMatchObject({ runs: 1, state: "active", lastError: "model unavailable" });

    runner.mockResolvedValueOnce({ text: "ok" });
    await tick(later(10));
    const ended = await store.getCheck(check.id);
    expect(ended).toMatchObject({ runs: 2, state: "ended" });
    expect(ended!.lastError).toBeUndefined();
    await tick(later(30));
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("cancelled checks stop; checks past their end time end", async () => {
    const a = await manager.create({ sessionId: "s1", prompt: "a", everyMinutes: 1 });
    const b = await manager.create({ sessionId: "s1", prompt: "b", everyMinutes: 1, endsAt: later(1).toISOString() });
    await manager.cancel(a.id);
    runner.mockResolvedValue({ text: "x" });
    await tick(later(5));
    expect(runner).not.toHaveBeenCalled();
    expect((await store.getCheck(a.id))!.state).toBe("cancelled");
    expect((await store.getCheck(b.id))!.state).toBe("ended");
  });

  it("validates new checks and refuses checks started from a check run", async () => {
    await expect(manager.create({ sessionId: "s1", prompt: " ", everyMinutes: 2 })).rejects.toThrow(/what to check/);
    await expect(manager.create({ sessionId: "s1", prompt: "x", everyMinutes: 0.5 })).rejects.toThrow(/at least 1 minute/);
    const check = await manager.create({ sessionId: "s1", prompt: "x", everyMinutes: 2 });
    await manager.setRunSession(check.id, "run-session");
    await expect(manager.create({ sessionId: "run-session", prompt: "y", everyMinutes: 2 })).rejects.toThrow(/cannot schedule/);
    for (let i = 1; i < MAX_ACTIVE_CHECKS_PER_SESSION; i++) await manager.create({ sessionId: "s1", prompt: `x${i}`, everyMinutes: 2 });
    await expect(manager.create({ sessionId: "s1", prompt: "one more", everyMinutes: 2 })).rejects.toThrow(/already has/);
  });

  it("isNothingToReport", () => {
    expect(isNothingToReport("NO_UPDATE")).toBe(true);
    expect(isNothingToReport(" `NO_UPDATE`. ")).toBe(true);
    expect(isNothingToReport("")).toBe(true);
    expect(isNothingToReport("No update: all fine")).toBe(false);
  });
});

describe("check tools", () => {
  it("schedule_check targets the chat the turn came from; list and cancel stay in that chat", async () => {
    const ctx = { manager, sessionId: "s1", agent: "ops", origin: { ...GROUP, threadId: 4, conversation: "telegram:group:-100123:topic:4" } };
    const created = await execScheduleCheck({ every_minutes: 2, instructions: "check https://example.com", max_runs: 30 }, ctx);
    expect(created).toMatch(/^Check chk_[\w-]+ scheduled every 2 min, .*Reports go to this Telegram group topic/);
    const id = /chk_[\w-]+/.exec(created)![0];
    expect(await store.getCheck(id)).toMatchObject({ agent: "ops", maxRuns: 30, target: ctx.origin });

    expect(await execListChecks(ctx)).toContain(`${id} [active] every 2 min (up to 30 runs)`);
    expect(await execListChecks({ manager, sessionId: "other" })).toBe("No recurring checks in this chat.");
    expect(await execCancelCheck({ id }, { manager, sessionId: "other" })).toBe(`Error: no check ${id} in this chat`);
    expect(await execCancelCheck({ id }, ctx)).toBe(`Check ${id} cancelled.`);

    expect(await execScheduleCheck({ every_minutes: 5, instructions: "x" }, { manager })).toMatch(/persisted chat session/);
    expect(await execScheduleCheck({ every_minutes: 5, instructions: "web" }, { manager, sessionId: "web" })).toMatch(/Reports go to this chat session/);
  });
});
