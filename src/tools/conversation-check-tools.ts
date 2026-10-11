/**
 * Conversation checks as tools: "check every 2 minutes whether the site answers and tell us if it goes
 * down". The same three tools serve agents (agent chat) and Polpo (orchestrator tools).
 */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CHECK_NOTHING_TO_REPORT, MIN_CHECK_INTERVAL_MINUTES, type ConversationCheck, type ConversationCheckTarget } from "@polpo-ai/core";
import type { ConversationCheckManager } from "../core/conversation-check-manager.js";

export const ScheduleCheckSchema = Type.Object({
  every_minutes: Type.Number({ minimum: MIN_CHECK_INTERVAL_MINUTES, description: `Minutes between two runs (at least ${MIN_CHECK_INTERVAL_MINUTES})` }),
  instructions: Type.String({ description: "What to do at every run, self-contained: what to check, how (tools, URLs, commands), and what is worth reporting. Later runs see only this and their own earlier runs." }),
  max_runs: Type.Optional(Type.Number({ minimum: 1, description: "Stop after this many runs" })),
  until: Type.Optional(Type.String({ description: "Stop after this time (ISO 8601)" })),
  run_now: Type.Optional(Type.Boolean({ description: "Run the first time now instead of after one interval (default false)" })),
});
export const ListChecksSchema = Type.Object({});
export const CancelCheckSchema = Type.Object({
  id: Type.String({ description: "Check id (chk_…), from schedule_check or list_checks" }),
});

export const SCHEDULE_CHECK_DESCRIPTION = "Repeat a check in this chat every N minutes, e.g. \"check every 2 minutes whether the site answers and tell us if it goes down\". "
  + "Each run gets your instructions in a session of its own that remembers the earlier runs. The run answers with the message for the chat, "
  + `or exactly ${CHECK_NOTHING_TO_REPORT} when there is nothing worth telling (then nothing is posted, so the chat is not flooded). `
  + "Reports go to the chat this request came from (the Telegram group, topic or direct chat) and into this conversation. "
  + "Use this instead of promising to notify later: without a check nothing happens after this turn.";
export const LIST_CHECKS_DESCRIPTION = "List the recurring checks of this chat: id, interval, instructions, runs, next run, last report or error.";
export const CANCEL_CHECK_DESCRIPTION = "Stop a recurring check of this chat (by id).";

export interface CheckToolContext {
  manager?: ConversationCheckManager;
  /** The chat session of this turn. */
  sessionId?: string;
  /** The agent asking; absent for Polpo. */
  agent?: string;
  /** Where this turn came from (Telegram chat or topic); absent for web chats. */
  origin?: ConversationCheckTarget;
}

function where(target: ConversationCheckTarget | undefined): string {
  if (!target) return "this chat session";
  if (target.conversation) return target.threadId !== undefined ? "this Telegram group topic" : "this Telegram group";
  return "this Telegram chat";
}

function describe(check: ConversationCheck): string {
  const limits = [check.maxRuns ? `up to ${check.maxRuns} runs` : "", check.endsAt ? `until ${check.endsAt}` : ""].filter(Boolean).join(", ");
  const lines = [
    `${check.id} [${check.state}] every ${check.everyMinutes} min${limits ? ` (${limits})` : ""}, ${check.runs} runs, reports to ${where(check.target)}`,
    `  instructions: ${check.prompt.length > 200 ? `${check.prompt.slice(0, 200)}…` : check.prompt}`,
  ];
  if (check.state === "active") lines.push(`  next run: ${check.nextRunAt}`);
  if (check.lastReport) lines.push(`  last report: ${check.lastReport.slice(0, 200)}`);
  if (check.lastError) lines.push(`  last error: ${check.lastError}`);
  return lines.join("\n");
}

export async function execScheduleCheck(args: Record<string, unknown>, ctx: CheckToolContext): Promise<string> {
  if (!ctx.manager) return "Error: recurring checks are not available on this instance";
  if (!ctx.sessionId) return "Error: recurring checks need a persisted chat session";
  const everyMinutes = Number(args.every_minutes);
  const until = typeof args.until === "string" && args.until ? new Date(args.until) : undefined;
  if (until && Number.isNaN(until.getTime())) return "Error: until must be an ISO date";
  try {
    const check = await ctx.manager.create({
      sessionId: ctx.sessionId,
      ...(ctx.agent ? { agent: ctx.agent } : {}),
      prompt: String(args.instructions ?? ""),
      everyMinutes,
      ...(ctx.origin ? { target: ctx.origin } : {}),
      ...(args.max_runs !== undefined ? { maxRuns: Number(args.max_runs) } : {}),
      ...(until ? { endsAt: until.toISOString() } : {}),
      ...(args.run_now ? { firstRunAt: new Date().toISOString() } : {}),
    });
    return `Check ${check.id} scheduled every ${check.everyMinutes} min, first run at ${check.nextRunAt}. `
      + `Reports go to ${where(check.target)}; runs with nothing to report stay silent. Cancel it with cancel_check.`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function execListChecks(ctx: CheckToolContext): Promise<string> {
  if (!ctx.manager) return "Error: recurring checks are not available on this instance";
  if (!ctx.sessionId) return "No checks: this chat has no persisted session.";
  const checks = await ctx.manager.list({ sessionId: ctx.sessionId });
  return checks.length ? checks.slice(0, 20).map(describe).join("\n\n") : "No recurring checks in this chat.";
}

export async function execCancelCheck(args: Record<string, unknown>, ctx: CheckToolContext): Promise<string> {
  if (!ctx.manager) return "Error: recurring checks are not available on this instance";
  const id = String(args.id ?? "");
  const [check] = (await ctx.manager.list()).filter((c) => c.id === id);
  // a chat stops its own checks (or the agent's own)
  if (!check || (check.sessionId !== ctx.sessionId && (!ctx.agent || check.agent !== ctx.agent))) return `Error: no check ${id} in this chat`;
  const cancelled = await ctx.manager.cancel(id);
  return cancelled?.state === "cancelled" ? `Check ${id} cancelled.` : `Check ${id} is already ${cancelled?.state ?? "gone"}.`;
}

type Result = { content: { type: "text"; text: string }[]; details: Record<string, unknown> };
const text = (t: string): Result => ({ content: [{ type: "text", text: t }], details: {} });

/** The tools for an agent chat; `context` is read when a tool runs (the session is known late). */
export function createConversationCheckTools(context: () => CheckToolContext): AgentTool<any>[] {
  return [
    {
      name: "schedule_check",
      label: "Schedule check",
      description: SCHEDULE_CHECK_DESCRIPTION,
      parameters: ScheduleCheckSchema,
      execute: async (_id, params) => text(await execScheduleCheck(params as Record<string, unknown>, context())),
    },
    {
      name: "list_checks",
      label: "List checks",
      description: LIST_CHECKS_DESCRIPTION,
      parameters: ListChecksSchema,
      execute: async () => text(await execListChecks(context())),
    },
    {
      name: "cancel_check",
      label: "Cancel check",
      description: CANCEL_CHECK_DESCRIPTION,
      parameters: CancelCheckSchema,
      execute: async (_id, params) => text(await execCancelCheck(params as Record<string, unknown>, context())),
    },
  ];
}
