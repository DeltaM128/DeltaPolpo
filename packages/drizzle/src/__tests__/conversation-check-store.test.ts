/** Recurring chat checks on SQLite (migrations included), and PostgreSQL when POLPO_TEST_DATABASE_URL is set. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as pgDrizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createPgStores, createSqliteStores, migratePg, migrateSqlite, type DrizzleStores } from "../index.js";

const PG_URL = process.env.POLPO_TEST_DATABASE_URL;
const DIALECTS = ["sqlite", ...(PG_URL ? ["postgres"] : [])] as const;

describe.each(DIALECTS)("conversation checks on %s", (dialect) => {
  let stores: DrizzleStores;
  let pg: ReturnType<typeof postgres> | undefined;
  let pgDb: ReturnType<typeof pgDrizzle> | undefined;

  beforeAll(async () => {
    if (dialect !== "postgres") return;
    pg = postgres(PG_URL!, { max: 4, onnotice: () => {} });
    pgDb = pgDrizzle(pg);
    await migratePg(pgDb);
  });
  afterAll(async () => { await pg?.end({ timeout: 5 }); });

  beforeEach(async () => {
    if (dialect === "sqlite") {
      const db = drizzle(new Database(":memory:"));
      migrateSqlite(db);
      stores = createSqliteStores(db);
      return;
    }
    await pg!.unsafe(`TRUNCATE "conversation_checks"`);
    stores = createPgStores(pgDb!);
  });

  it("creates, lists, finds due checks and updates them", async () => {
    const store = stores.conversationCheckStore;
    const target = { channel: "team-bot", chatId: "-100123", threadId: 4, conversation: "telegram:group:-100123:topic:4" };
    const a = await store.createCheck({ sessionId: "s1", agent: "ops", prompt: "is the site up?", everyMinutes: 2, target, firstRunAt: "2026-01-01T00:00:00.000Z" });
    const b = await store.createCheck({ sessionId: "s2", prompt: "digest", everyMinutes: 60 });
    expect(a).toMatchObject({ id: expect.stringMatching(/^chk_/), state: "active", runs: 0, target });
    expect(await store.getCheck(a.id)).toEqual(a);
    expect((await store.listChecks({ sessionId: "s1" })).map((c) => c.id)).toEqual([a.id]);
    expect((await store.listChecks()).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect((await store.dueChecks("2026-01-01T00:01:00.000Z")).map((c) => c.id)).toEqual([a.id]);

    const updated = await store.updateCheck(a.id, { runs: 1, nextRunAt: "2026-01-01T00:02:00.000Z", runSessionId: "run-1", lastReport: "down" });
    expect(updated).toMatchObject({ runs: 1, runSessionId: "run-1", lastReport: "down", createdAt: a.createdAt });
    expect(await store.dueChecks("2026-01-01T00:01:00.000Z")).toEqual([]);
    await store.updateCheck(a.id, { state: "cancelled", nextRunAt: "2026-01-01T00:00:00.000Z" });
    expect(await store.dueChecks("2026-01-01T00:05:00.000Z")).toEqual([]);
    expect(await store.listChecks({ states: ["active"] })).toEqual([expect.objectContaining({ id: b.id })]);
    expect(await store.updateCheck("chk_missing", { runs: 3 })).toBeUndefined();
  });
});
