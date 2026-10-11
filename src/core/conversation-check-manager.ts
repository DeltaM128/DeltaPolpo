import {
  CHECK_NOTHING_TO_REPORT,
  MIN_CHECK_INTERVAL_MINUTES,
  afterCheckRun,
  type ConversationCheck,
  type ConversationCheckStore,
  type NewConversationCheck,
} from "@polpo-ai/core";

/**
 * One run of a check: the agent works in the check's own session and answers. "deferred" = the
 * session is busy, try again at the next tick.
 */
export type ConversationCheckRunner = (check: ConversationCheck, signal: AbortSignal) => Promise<{ text: string } | "deferred">;
/** Deliver a report where the check was asked (chat, topic, the chat session). */
export type ConversationCheckDelivery = (check: ConversationCheck, text: string) => Promise<void>;

/** Active checks one chat session may have at once. */
export const MAX_ACTIVE_CHECKS_PER_SESSION = 10;
const RUN_TIMEOUT_MS = 10 * 60_000;

/** True when an answer means "nothing worth telling" (NO_UPDATE, alone, maybe with punctuation). */
export function isNothingToReport(text: string): boolean {
  const t = text.trim().replace(/^[\s`*"']+|[\s`*"'.!]+$/g, "");
  return t === "" || t.toUpperCase() === CHECK_NOTHING_TO_REPORT;
}

/**
 * Runs the conversation checks that are due (every 30 s), one run at a time per check: the answer
 * is delivered unless there is nothing to report, then the next run is scheduled (or the check ends).
 */
export class ConversationCheckManager {
  private runner?: ConversationCheckRunner;
  private delivery?: ConversationCheckDelivery;
  private timer?: ReturnType<typeof setInterval>;
  private readonly running = new Map<string, AbortController>();
  private ticking = false;

  constructor(
    private readonly store: ConversationCheckStore,
    private readonly log: (level: "info" | "warn", message: string) => void = () => {},
    private readonly pollIntervalMs = 30_000,
  ) {}

  setRunner(runner: ConversationCheckRunner): void { this.runner = runner; }
  setDelivery(delivery: ConversationCheckDelivery): void { this.delivery = delivery; }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
  }

  async create(input: NewConversationCheck): Promise<ConversationCheck> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Say what to check at every run");
    if (!(input.everyMinutes >= MIN_CHECK_INTERVAL_MINUTES)) throw new Error(`The interval must be at least ${MIN_CHECK_INTERVAL_MINUTES} minute`);
    if (input.maxRuns !== undefined && !(input.maxRuns >= 1)) throw new Error("maxRuns must be at least 1");
    if (input.endsAt !== undefined && Number.isNaN(Date.parse(input.endsAt))) throw new Error("endsAt must be an ISO date");
    // a run (the check's own session) does not start more checks
    if ((await this.store.listChecks()).some((c) => c.runSessionId === input.sessionId)) {
      throw new Error("A check run cannot schedule other checks");
    }
    const active = await this.store.listChecks({ sessionId: input.sessionId, states: ["active"] });
    if (active.length >= MAX_ACTIVE_CHECKS_PER_SESSION) {
      throw new Error(`This chat already has ${active.length} active checks: cancel one first`);
    }
    return this.store.createCheck({ ...input, prompt });
  }

  list(filter?: Parameters<ConversationCheckStore["listChecks"]>[0]): Promise<ConversationCheck[]> {
    return this.store.listChecks(filter);
  }

  /** The session the check's runs happen in (created by the runner at the first run). */
  async setRunSession(id: string, runSessionId: string): Promise<void> {
    await this.store.updateCheck(id, { runSessionId });
  }

  async cancel(id: string): Promise<ConversationCheck | undefined> {
    this.running.get(id)?.abort();
    const check = await this.store.getCheck(id);
    if (!check || check.state !== "active") return check;
    return this.store.updateCheck(id, { state: "cancelled" });
  }

  /** Run what is due now. */
  async tick(now = new Date()): Promise<void> {
    if (this.ticking || !this.runner) return;
    this.ticking = true;
    try {
      const due = await this.store.dueChecks(now.toISOString());
      for (const check of due) {
        if (this.running.has(check.id)) continue;
        if (check.endsAt && check.endsAt < now.toISOString()) {
          await this.store.updateCheck(check.id, { state: "ended" });
          continue;
        }
        void this.run(check);
      }
    } catch (err) {
      this.log("warn", `[checks] could not read the due checks: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  private async run(check: ConversationCheck): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
    this.running.set(check.id, controller);
    try {
      const result = await this.runner!(check, controller.signal);
      if (result === "deferred") return;
      const report = result.text.trim();
      const deliver = !isNothingToReport(report);
      if (deliver) await this.delivery?.(check, report);
      // a check cancelled while it ran stays cancelled
      const current = await this.store.getCheck(check.id);
      if (!current || current.state !== "active") return;
      await this.store.updateCheck(check.id, {
        ...afterCheckRun(current, new Date()),
        ...(deliver ? { lastReport: report.slice(0, 2000) } : {}),
        lastError: undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("warn", `[checks] ${check.id} failed: ${message}`);
      const current = await this.store.getCheck(check.id).catch(() => undefined);
      // keep the schedule: a failing run does not turn into a tight loop
      if (current?.state === "active") {
        await this.store.updateCheck(check.id, { ...afterCheckRun(current, new Date()), lastError: message.slice(0, 500) }).catch(() => {});
      }
    } finally {
      clearTimeout(timeout);
      this.running.delete(check.id);
    }
  }
}
