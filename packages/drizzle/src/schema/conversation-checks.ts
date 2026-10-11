import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { pgTable, text as pgText, jsonb, index as pgIndex } from "drizzle-orm/pg-core";

// Recurring checks run inside a chat: the whole check is in `doc`, the columns used to find due
// checks and a session's checks are copied next to it.

export const conversationChecksSqlite = sqliteTable("conversation_checks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  state: text("state").notNull(),
  nextRunAt: text("next_run_at").notNull(),
  doc: text("doc").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_conversation_checks_due").on(table.state, table.nextRunAt),
  index("idx_conversation_checks_session").on(table.sessionId),
]);

export const conversationChecksPg = pgTable("conversation_checks", {
  id: pgText("id").primaryKey(),
  sessionId: pgText("session_id").notNull(),
  state: pgText("state").notNull(),
  nextRunAt: pgText("next_run_at").notNull(),
  doc: jsonb("doc").notNull(),
  createdAt: pgText("created_at").notNull(),
  updatedAt: pgText("updated_at").notNull(),
}, (table) => [
  pgIndex("idx_pg_conversation_checks_due").on(table.state, table.nextRunAt),
  pgIndex("idx_pg_conversation_checks_session").on(table.sessionId),
]);
