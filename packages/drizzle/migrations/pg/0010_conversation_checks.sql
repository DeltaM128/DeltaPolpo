CREATE TABLE "conversation_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"state" text NOT NULL,
	"next_run_at" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_pg_conversation_checks_due" ON "conversation_checks" USING btree ("state","next_run_at");--> statement-breakpoint
CREATE INDEX "idx_pg_conversation_checks_session" ON "conversation_checks" USING btree ("session_id");