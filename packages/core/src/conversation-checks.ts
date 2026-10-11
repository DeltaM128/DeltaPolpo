/**
 * Conversation checks: recurring work an agent (or Polpo) runs inside a chat it was asked in
 * ("check every 2 minutes whether the site answers and tell us if it goes down").
 *
 * Each run is a turn of the check's own chat session (it remembers its earlier runs, and the "nothing
 * to report" answers stay there); the answer is delivered where the check was asked (a Telegram
 * group or topic, a direct chat) and added to that chat session, unless the agent answers
 * {@link CHECK_NOTHING_TO_REPORT}.
 */

/** The answer of a run with nothing worth telling: nothing is delivered. */
export const CHECK_NOTHING_TO_REPORT = "NO_UPDATE";

/** Shortest interval between two runs. */
export const MIN_CHECK_INTERVAL_MINUTES = 1;

/** Where the answers of a check go: a channel's conversation (bot key, chat, topic). */
export interface ConversationCheckTarget {
  /** Channel key of the bot that delivers (settings.notifications.channels). */
  channel: string;
  chatId: string;
  /** Forum topic inside a group. */
  threadId?: number;
  /** Conversation id of a group ("telegram:group:<chatId>[:topic:<n>]"): answers join its transcript. */
  conversation?: string;
}

export type ConversationCheckState = "active" | "ended" | "cancelled";

export interface ConversationCheck {
  id: string;
  /** The chat session the check was asked in: its reports are added there. */
  sessionId: string;
  /** The check's own session, where runs happen (created at the first run). */
  runSessionId?: string;
  /** The agent that runs it; absent for Polpo. */
  agent?: string;
  /** What to do at every run, in the words of the request. */
  prompt: string;
  everyMinutes: number;
  /** Where answers are delivered; absent = only the chat session (web chats). */
  target?: ConversationCheckTarget;
  state: ConversationCheckState;
  /** Who asked for it (person or peer id), for listing. */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  /** Stop after this many runs. */
  maxRuns?: number;
  /** Stop after this time (ISO). */
  endsAt?: string;
  runs: number;
  lastRunAt?: string;
  /** Last answer delivered (not the "nothing to report" ones). */
  lastReport?: string;
  lastError?: string;
}

export interface NewConversationCheck {
  sessionId: string;
  agent?: string;
  prompt: string;
  everyMinutes: number;
  target?: ConversationCheckTarget;
  createdBy?: string;
  maxRuns?: number;
  endsAt?: string;
  /** First run; default: one interval from now. */
  firstRunAt?: string;
}

export interface ConversationCheckStore {
  createCheck(input: NewConversationCheck): Promise<ConversationCheck>;
  getCheck(id: string): Promise<ConversationCheck | undefined>;
  /** Checks of a session, or all; newest first. */
  listChecks(filter?: { sessionId?: string; agent?: string; states?: readonly ConversationCheckState[] }): Promise<ConversationCheck[]>;
  /** Active checks due at `now`. */
  dueChecks(now: string): Promise<ConversationCheck[]>;
  updateCheck(id: string, patch: Partial<Omit<ConversationCheck, "id" | "createdAt">>): Promise<ConversationCheck | undefined>;
}

/**
 * The next state of a check after a run at `at`: next run one interval later, or ended when it ran
 * its last time (maxRuns) or its end time has passed.
 */
export function afterCheckRun(check: ConversationCheck, at: Date): Pick<ConversationCheck, "runs" | "lastRunAt" | "nextRunAt" | "state"> {
  const runs = check.runs + 1;
  const nextRunAt = new Date(at.getTime() + check.everyMinutes * 60_000).toISOString();
  const ended = (check.maxRuns !== undefined && runs >= check.maxRuns)
    || (check.endsAt !== undefined && nextRunAt > check.endsAt);
  return { runs, lastRunAt: at.toISOString(), nextRunAt, state: ended ? "ended" : check.state };
}
