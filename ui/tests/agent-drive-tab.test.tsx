import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@polpo-ai/react", () => ({ useEvents: () => ({ events: [] }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../src/components/agents/agent-detail-context", () => ({
  useAgentDetail: () => ({ actions: { refetch: vi.fn(async () => {}) }, meta: { agentName: "coach" } }),
}));

import { AgentDriveTab } from "../src/components/agents/agent-drive-tab";

const data = {
  drive: { enabled: true, purpose: "Be Alessio's health coach", goals: ["Three workouts a week"], autonomy: "balanced" },
  self: "I am Coach: warm, direct, a bit ironic.",
  selfHistory: [],
  intentions: [
    { id: "chk_1", state: "proposed", prompt: "", message: "Happy birthday Grazia! 🎉", why: "Grazia's birthday", everyMinutes: 0, nextRunAt: "2026-10-14T07:00:00Z", runs: 0, target: { chatId: "-100", name: "Family" } },
    { id: "chk_2", state: "active", prompt: "Ask Alessio how the workout went", everyMinutes: 0, cron: "0 20 * * 1,3,5", timezone: "Europe/Rome", nextRunAt: "2026-10-14T18:00:00Z", runs: 2, target: { chatId: "42", name: "Alessio" } },
  ],
  journal: [{ id: "ref_1", at: "2026-10-13T08:00:00Z", trigger: "daily", messages: 3, summary: "Planned wishes for Grazia.", actions: ["proposed chk_1 → Family"] }],
  lastReflectionAt: "2026-10-13T08:00:00Z",
};

let root: Root;
let container: HTMLDivElement;
let calls: Array<[string, string]>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([init?.method ?? "GET", String(url)]);
    return new Response(JSON.stringify({ ok: true, data: init?.method ? {} : data }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

test("shows purpose, self-portrait, intentions to approve and reflections; approving calls the API", async () => {
  await act(async () => root.render(<AgentDriveTab />));
  await settle();
  const text = container.textContent ?? "";
  expect(text).toContain("Purpose and goals");
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Be Alessio's health coach");
  expect(text).toContain("I am Coach: warm, direct, a bit ironic.");
  expect(text).toContain("Waiting for your yes");
  expect(text).toContain("Happy birthday Grazia! 🎉");
  expect(text).toContain("Why: Grazia's birthday");
  expect(text).toContain("cron 0 20 * * 1,3,5 (Europe/Rome) → Alessio");
  expect(text).toContain("Planned wishes for Grazia.");

  const approve = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Approve"))!;
  await act(async () => approve.click());
  await settle();
  expect(calls).toContainEqual(["POST", expect.stringContaining("/api/v1/drive/coach/intentions/chk_1/confirm")]);
});
