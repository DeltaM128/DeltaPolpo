# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Task outputs are saved by run and by task, with readable names.** Each task now has its own folder under `output/` in the agents' working directory: `output/<mission run>/<NN> - <task title>/` for the tasks of a mission (the run name is already unique, e.g. `report (2)`, and the number follows the order of the tasks in the mission) and `output/tasks/<task title> - <id>/` for a task outside a mission. Before, each task got `.polpo/output/<task id>/`, a hidden folder named by an id that agents hardly used: a file the task named without a folder (`save it in report.md`) landed in the working directory, where every run overwrote the previous one and the files of all missions mixed. Now:
  - the agent is told that such a file goes in its output folder, and to create or edit files elsewhere only when the task is about them (e.g. a source file of the project), so coding tasks work as before;
  - the task message also gives the exact path of each new file its description names (`save it in report.md` → `output/report (2)/02 - Write report/report.md`): small local models follow a concrete path, not a rule. Names of files that already exist in the working directory, or that the tasks it depends on produced, are left out (they are files to edit or to read);
  - a task that depends on others is told where their folders are and which files they contain, so `read data.md` finds the file the previous task saved;
  - the mission page has an **Output** button (the run's folder) and the task page an **Output folder** card, both opening the Files page there (`/files?workspacePath=…`, relative to the agents' workspace).
- **New DeltaPolpo icon** (the orange triangle with tentacles) for the desktop app (installer, executable, window), the favicon and the installable web app; Windows now uses a multi-size `.ico` (16–256 px), and the maskable PWA icons are full-bleed with the drawing inside the safe zone.

### Added
- **Checks can find what the task saved:** `test` and `script` expectations run with `POLPO_OUTPUT_DIR` set to the task's output folder, and `file_exists` paths may start with `$POLPO_OUTPUT_DIR/`. The folder of a run (`output/<mission run>/<NN> - <task>/`) is not known when the expectation is written.
- **Edit an agent from its page:** an Edit button opens a panel with the agent's role, team, manager, model (with "Use project default"), reasoning, turn and parallel-task limits, additional instructions, built-in tools and tool categories, skills, identity (display name, title, company, email, timezone, tone, personality, bio, responsibilities) and advanced settings (allowed folders, email domains, browser profile, Telegram voice replies). Before, the agent page only showed the configuration; it could be changed only in the chat with Polpo, in `agents.json` or through the API.
- **Warning for a pipeline that never runs the agent:** a pipeline made only of human steps (e.g. a single approval) saves and runs, but its tasks end as done after the approvals, without the agent doing any work. The pipeline editor now shows a warning above the graph and on save, the agent's Pipeline tab is flagged, and the task result says so.
- `PATCH /agents/:name`: an empty value removes an optional text field (`model`, `role`, `systemPrompt`, `reasoning`, `browserProfile`, identity fields), e.g. `model: ""` makes the agent use the project default again.

### Fixed
- **Line numbers copied from `read` into files.** The read tool shows each line as `<n><TAB><text>`, and agents of every size copied those numbers into what they wrote (with the tab, a space, the escape `\t`, a dot or nothing, sometimes with `\n` written instead of the line breaks), so a file ended up with numbers that were never in it. `write` and `edit` now refuse content whose every line starts with consecutive line numbers, with an error that says why; `keep_line_numbers: true` lets a file whose lines really are numbered through. An `edit` whose `old_text` carries the numbers says so instead of a bare "not found", and the read tool's description says the numbers are not part of the file.
- **The glob tool found nothing for patterns with a folder** (`docs/report.md`, `src/**/*.ts`), and nothing at all on Windows without bash: it ran `find -name`, which matches file names only, through a Unix shell. It now walks the files itself (`src/tools/glob-files.ts`, on the FileSystem port, so remote sandboxes too), with `*`, `**`, `?`, `{a,b}` and `[abc]`; `node_modules` and `.git` are walked only when the pattern names them.
- **A mission or playbook task's `maxRetries` was ignored:** every task got the project's `settings.maxRetries` (3 by default), so a task meant to fail at once (`maxRetries: 0`) was retried three times. The task now keeps its own value; `POST /tasks` accepts `maxRetries` too.
- **A playbook that cannot run says why, and which task to fix.** The reason was shown only in a toast that disappears in seconds, and it named fields by index (`tasks.0.description: task requires a description`). The Run dialog now keeps the reasons on screen until the next try, and they name the task, checkpoint or delay (`task "test" (tasks.0).description: task requires a description`).
- **The mission graph disappeared when a run paused at a checkpoint** (nodes and connections gone, only the background left). On every status update the graph was rebuilt with new node objects that had lost the size React Flow had measured; React Flow hides a node of unknown size and measures it again only when its size changes. Task cards change size with their status, so they came back, but at a checkpoint nothing changed size and the whole graph stayed hidden. The rebuilt nodes now keep their measured size (mission page and playbook editor).
- **Playbook editor connections can be removed and moved.** A connection between two nodes could only be removed by selecting it and pressing Delete, and nothing showed it was selected (its colour hid the selection), so it looked impossible to change. A selected connection is now highlighted and shows a × button that removes it; a connection under the pointer lights up and is easier to hit; and its ends can be dragged to another node to move it (refused, keeping the old one, if the new one would create a cycle).
- A task whose model call failed (e.g. Ollama answering HTTP 500 because the model crashed while loading, or a connection error) ended as **done** with no output and no work: the agent ends such a run with an error reply instead of throwing, and the engine counted it as a success. It now fails with the reason (`Model error: …`), so it is retried and then shown as failed.
- On every start the server logged `[checkpoint] approval sync failed`, and a mission paused at a checkpoint before a restart got no approval on the Approvals page: the sync ran before the orchestration engine it reads from was created. It now runs right after.
- Tool calls whose arguments did not match the tool's schema were run or previewed anyway: e.g. a local model putting the mission name inside `data` produced a mission preview without a name. The chat now checks every call against its schema (pi-ai's validator) before running or previewing it; a call that does not match is returned to the model with the reason, so it can call the tool again in the same turn. An object or array parameter passed as a JSON string is still accepted, as before.
- A delay with a duration the parser could not read (e.g. `PT1s`, lowercase) made every supervisor tick fail, so no task of any mission started anymore. Durations are now read case-insensitively, a mission or playbook with an invalid duration is refused with a clear message, the playbook editor flags it, and a stored delay that still cannot be read is reported once and ignored instead of stopping the supervisor.
- The model list of the Add agent dialog was empty in the desktop app: the model picker called the API with a relative path, which does not reach the server from a page loaded from `file://`.
- `ui/server.mjs` did not work on Windows: every file, including the JavaScript and CSS in `/assets`, was served as `index.html`, because the path check expected `/` separators, and the default static root was built from a URL path (`/D:/...`). The server now uses the platform's paths and still refuses paths outside the static root.

### Security
- **Task agents could read and write the project's `.polpo` folder.** The file tools keep agents out of `.polpo` (configuration, `.env`, vault, sessions, storage mounts), but the guard was only switched on in the server process. Tasks run in a separate runner process, where it was off: an agent with the default access (its working directory) could read `.polpo/.env` or the vault file and write anywhere in `.polpo`. The runner now sets the same guard before building the agent's tools, with the same exceptions (offloaded tool outputs, skills, playbooks). A task output folder that lies inside `.polpo` stays writable: it is now granted explicitly.

## [0.4.6-delta.1] — 2026-10-13 — DeltaPolpo

First release of **DeltaPolpo**, a fork of Polpo 0.4.6 focused on visual workflows, local models and a Windows desktop installer. See [DELTAPOLPO.md](DELTAPOLPO.md).

### Added
- **Playbook graph editor** (Playbooks → a playbook → Editor): add tasks, checkpoints and delays, connect them by dragging, edit them in a side panel, save. Cycles are refused; renames and deletions update every reference.
- **Approve checkpoints from the dashboard**: a mission paused at a playbook checkpoint opens a regular approval request (Approvals page, sidebar badge, history, `/approve`): approving it resumes the mission, rejecting it aborts the mission. The mission page shows the pause with an "Approve and continue" button. (The resume API existed but nothing in the dashboard called it.)
- **Delete a mission** from its page (with confirmation); **Abort** also works on a mission paused at a checkpoint.
- **New playbook** button: creates an empty playbook and opens it in the editor. **Run** button on playbook cards and on the playbook page (the run dialog existed but nothing opened it).
- **Agent pipelines are executed**: agents with `loops` and a `pipeline` run it for their tasks (loops, `parallel` with join all/any/n, `switch`, `human` approvals, `when` guards, `stopWhen`, `output.schema`). Previously the pipeline contract was only validated and stored. See [docs/loops.md](docs/loops.md).
- **Pipeline editor** (Agents → an agent → Pipeline): a top-down flow with "+" insertion points, loop definitions, validation that blocks saving.
- **Live pipeline view** (Tasks → a task → Pipeline): each step colored by its state, retry feedback, errors, the shared context; live while running, from the run log afterwards.
- **Local (offline) models in setup**: "Local model (offline)" provider option — Ollama, LM Studio, vLLM or any OpenAI-compatible server on this machine or the local network; models are discovered, models without tool calling are flagged.
- **DeltaPolpo Windows installer** (`scripts/build-deltapolpo-installer.ps1`): its own app id, port (3891), settings and data folders, so it installs next to an original Polpo; auto-update off.
- `PATCH /agents/:name` accepts `pipeline: null` and rejects pipelines that reference unknown loops.

### Fixed
- Desktop app: **no task ever ran** — the Bun-compiled server started task runners with a script path that does not exist in the binary ("too many arguments"). Runners now start through a hidden `__runner` command.
- Desktop app: **"Login with subscription" failed for every provider** ("Cannot find module './anthropic.js'"); provider login pages now open in the default browser instead of a bare Electron window.
- Task runs ignored custom providers from polpo.json ("Model not found for provider") — local servers and gateways only worked in chat.
- After a setup completed from the dashboard, tasks stayed pending until the server restarted.
- Playbooks with checkpoints or delays could be saved but not run (missing `dependsOn`), and the run answered a plain-text 500; the required dependencies are now added, and run errors are readable.
- Approval requests of pipeline steps that stopped waiting (task killed, parallel join decided) no longer stay pending.
- A mission paused at a checkpoint lost its pause on restart (closing the desktop app): with file storage, checkpoint and delay state was kept in memory only; the blocked task was then force-failed as a "deadlock". The state is now saved to `.polpo/checkpoints.json` / delays file, a paused mission is never treated as a deadlock, and missions paused before the fix get their checkpoint back.
- Running a playbook a second time created a mission with the same name, i.e. the same task group: the new run saw the first run's finished tasks (its checkpoint was reached at once) and was never marked completed, staying "running" forever. A new mission with a taken name is now named "name (2)", "name (3)"… (with SQLite storage the second run failed instead). Task titles must be unique within a mission, no longer across all active tasks, so two runs of one playbook can run at the same time.
- After the first setup from the dashboard, the dashboard received no live events (tasks, missions, checkpoints) until the server was restarted: setup replaced the event bridge, but the `/events` route kept the old, idle one. Mission pages, counters and badges now update live during the whole run.
- The mission page refreshed the mission only on the first change of a run (the "stale" flag was never cleared); checkpoint events now update the mission status (paused / active) too.
- With two runs of the same playbook (or two missions with the same task titles) in progress, a checkpoint could be skipped: checkpoints, delays and quality gates looked for their tasks by title across all missions, so one run's checkpoint counted as "not reached" while the other run's task was still pending. They now look only at their own mission's tasks.
- Missions sharing a name (created before names were unique) never completed and could not be aborted or resumed: completion, abort and the mission page went by the shared group and always found the first mission. They now work per mission; missions left "active" with all tasks finished are completed on the next start. Deleting one of them no longer deletes the other missions' tasks.
- The Approvals page blanked (counters back to 0) on every refresh; it now keeps the list on screen while updating.
- `GET /missions/checkpoints` and `GET /missions/delays` answered "Mission not found" (shadowed by `GET /missions/:id`).
- The agents list kept a stale ETag after an agent's configuration changed, so browsers showed outdated agents.
- Windows build of the installer: Git Bash instead of the WSL launcher, and electron-builder's winCodeSign tools extracted without the macOS symlinks that need Developer Mode.

## [0.4.6] — 2026-10-12 — Polpo Knows

### Added
- Polpo knows what agents can do in chats and can manage it:
  - **Prompt:** a "What agents can do in chats" section covering learning, recurring checks, voice replies and reactions.
  - **`add_agent` / `update_agent`:** take `learning` and `voiceReplies`.
  - **New tools:** `get_agent_learning` (setting and recent changes), `review_agent_learning` (review now) and `revert_agent_learning` (undo a change by id).
- Agents' chat instructions say to use `schedule_check` to follow up instead of promising, and to change their own learning and voice settings when asked.

## [0.4.5] — 2026-10-12 — Learning Agents

### Added
- **Agents learn from their conversations** (opt-in per agent, `learning`): every N new messages (default 30) or after a quiet period (default 30 min), the agent reviews its chats with its own model, keeps its memory current, and writes repeated procedures down as skills of its own (`create_my_skill` / `update_my_skill`, only skills it created).
  - Every change is recorded with before and after, reported as an `agent:learned` event, and can be undone (agent page → Learning, or `POST /learning/:agent/changes/:id/revert`).
  - The agent turns it on or off itself (`set_learning`) (#119)
- In-app changelog (What's new) entries for everything since 2026-10-06

### Fixed
- The agent API (`POST`/`PATCH /agents`) dropped `learning` and `voiceReplies` (#119)
- Telegram: "…processed your request but has nothing to say".
  - A turn that ended without a word (usually right after tool calls) is now asked once for its reply.
  - At the step limit the agent writes one last answer without tools instead of stopping silently. Polpo's Telegram loop goes from 15 to 40 steps.
  - What is left says what happened and where to look, and logs a warning

### Changed
- CI: Desktop Check closes the app and waits for the Windows installer to finish before using the installed app; the real-jail network tests have 30 s; the CLI layer tests retry (known flaky, now logging why) (#115, #120)

## [0.4.4] — 2026-10-11 — Checks, Voice, Reactions

### Added
- **Recurring checks in a chat** (`schedule_check`, `list_checks`, `cancel_check`, for agents and Polpo): "check every 2 minutes whether the site answers and tell us if it goes down".
  - Each run is a turn of the check's own session, and a run with nothing to report (`NO_UPDATE`) stays silent.
  - Reports go to the Telegram group, topic or chat where the check was asked, into the group's transcript, and into that chat session.
  - Stored in a new `conversation_checks` table (SQLite/PostgreSQL migrations) or in `.polpo/conversation-checks/`.
  - Before, agents promised to notify with no way to do it, and Polpo's schedules only reached the owner's chat (#112)
- **Voice replies on Telegram**: `voiceReplies` per agent (and `settings.voiceReplies` for Polpo), `off` by default, `voice` (answer a voice message with one) or `always`.
  - Sent as a real voice message (OpenAI TTS in Ogg/Opus, else ElevenLabs, else edge-tts), with the text as the caption.
  - Agents know their setting and change it themselves with `set_voice_replies`; Polpo can change its own or an agent's (#114)
- **Emoji reactions**: an answer that is a single emoji Telegram accepts (👍 ❤ 🔥 🎉 👀…) is put on the message as a reaction instead of being sent; agents are told so on Telegram turns (#116)
- **`list_models`** for Polpo: searches the model catalog (built-in providers and custom gateways), by default only providers with credentials. Custom gateways now appear among the connected providers in its prompt (#113)

### Changed
- CI: Desktop Check uses the packaged app on Linux, macOS and Windows: a chat with Polpo answered by a mock model, and the main pages rendered without errors. On Windows it also builds the installer, installs it silently and uses the installed app (#115)

## [0.4.3] — 2026-10-11 — Desktop Window, Group Media

### Fixed
- Desktop app: blank window in 0.4.2. The release built the UI for the web (absolute `/assets/…` paths, service worker), while Electron loads it from `file://`. It is now built with `POLPO_ELECTRON=1` (relative paths, no service worker) (#109)
- Telegram groups: agents understand photos and voice notes. Every group message's media is downloaded and described once, whichever bot gets it first. Voice notes and audio are transcribed (Whisper or Deepgram, with the bot's agent's vault key or the env), and photos and files are saved in the workspace. The description goes into the transcript every agent reads, counts for intent, and goes into the addressed agent's turn (images still attached). Before, agents only saw `[photo]` / `[voice message]` (#108)

### Changed
- CI: Desktop Check also opens the packaged app on Linux, macOS and Windows. The window must load the UI and reach the server (#109)

## [0.4.2] — 2026-10-10 — Docker Images

### Fixed
- Docker images build again, and are published for the first time in the 0.4 series (`ghcr.io/alemicali/polpo-zhc`, `/server` and `/ui`):
  - `sharp` is now a declared dependency, instead of coming in through an optional peer of Baileys
  - the UI image builds `@polpo-ai/core`, which the UI imports
  - the icon subset script resolves the icon packs as the UI's own dependencies (#105)
- The release notes job runs again: it was skipped whenever the Docker job failed (#105)

### Changed
- CI: Docker Check builds the server and UI images like the release for dependency and Dockerfile changes, and starts both (#105)

## [0.4.1] — 2026-10-10 — Desktop Server Fix

### Fixed
- Desktop app: "Server Start Failed" on every platform. The bundled server could not find `playwright-core` and `sharp`. They now ship next to it with this platform's sharp binaries, the sidecar is built with `--compile-autoload-package-json`, and the app starts the server with `NODE_PATH` on them whatever folder Polpo is started from. The server also starts without them: they are loaded only when used (#101)
- `/api/v1/health` reports the running version instead of `0.1.0`, and the desktop server's `--version` no longer reports `0.0.0` (#101)
- Desktop auto-update looked for releases in `lumea-labs/polpo`. It now uses `alemicali/polpo-zhc` (#101)

### Changed
- "Server Start Failed" shows the server's exit code, its last lines of output and the path of `server.log`, and appears as soon as the server exits (#101)
- Links, install scripts and pages, README and the Docker image (`ghcr.io/alemicali/polpo-zhc`) point at this project. `docs/openapi.json` is up to date (#102)
- CI: Desktop Check packages the app on Linux, macOS and Windows for desktop changes and starts the bundled server (on Linux also in a clean container without Node) (#101)

## [0.4.0] — 2026-10-09 — Sandbox, Rooms, Events

Covers everything since 0.3.4 (#44–#97).

### Added
- **Sandbox**: commands can run in bubblewrap, Docker or a remote VM (Daytona, E2B). Includes network allowlists through a proxy, CPU and memory limits, lease, pool and warm VMs, and tool placement (sandbox or host). Opt-in: without configuration commands run on this machine (#83, #84, #87, #90–#94)
- **Volumes in Files**: a volume is a folder of this server or an S3/R2 bucket (FUSE mounts, temporary bucket keys). The Storage page is gone (#83, #95, #96)
- **Rooms**: group conversations as rooms, with one transcript for people and agents. Group chats on the web, and agents answering each other (#64, #65)
- **Telegram**: agents, pairing, sessions, inbound webhook. Agents in groups answer by intent, know who is in the room and answer each other (#48, #53, #61–#63, #66)
- **Events**: Activity and Logs become Events (Live / History) with filters by type, agent, outcome and period. A typed event bus with a complete catalog and the origin of every event (#70–#72, #74, #77)
- **Chat**: steering, a server-side queue and conversation branches. Groups inside the chat (#57, #68)
- **Context compaction**: one two-stage compactor for chats and task runs, `/compact`, a cheaper summary model by default (#81, #82)
- **Custom AI gateways**: OpenAI- and Anthropic-compatible providers, with a UI wizard, vault keys and a network guard (#58)
- **Vault**: multi-mailbox email tools, shared credentials across agents, and vault references (features point to vault entries instead of keeping keys) (#45, #46, #89)
- **API**: counts, slim lists, segments, incremental sync, active turns (#44)
- **Loops**: deterministic loop contract (#47)
- **Ink**: self-hosted hub on Node, configurable hub and registry (#67)
- **What's new**: a top bar that opens a drawer with the changelog (#68, #69, #73)
- **Tools**: large outputs are offloaded to files instead of being lost (#80)
- **Log retention** for orchestrator event logs (#52)
- New channel cards in Settings → Channels (#86)

### Changed
- Complete, optimized PostgreSQL support (#51)
- pi-ai and pi-agent-core 0.85.1 → 1.0.4 (#49)
- Data layer: relative paths, read-only SQL enforced by the database, query timeout (#78)
- Fewer full reads in the supervisor and background waits; Postgres task search (#75)
- CI runs on Linux only and builds in parallel. Bubblewrap tests now run on the runners (#60, #97)

### Fixed
- Security: command injection in Ink/skills, provider key redirect, config secret leak, .env injection, reserved vault owners (#59)
- Shutdown no longer hangs with PostgreSQL (#54)
- A crashing agent runner no longer leaves its task stuck (#88)
- Task runners actually use Daytona/E2B (#91); `update_agent` exposes the sandbox parameter (#85)
- The sandbox network bridge runs on the server's own node, so it works with nvm, `/usr/local` or `/opt` installs (#97)
- Mission notification rules and rule actions after reload (#76)
- UI: data-page refresh loop and chat list update loop (React #185); error boundaries (#79)
- UI lint passes with 0 errors (#56, #97)

### Removed
- The unused `@polpo-ai/tools` fork and dead server code (#50)

## [0.3.4] — 2026-03-19 — Desktop Sidecar Fix

### Fixed
- Release workflow now builds and uploads all workspace packages (vault-crypto, tools, server were missing)
- Desktop sidecar build resolves all @polpo-ai/* dependencies correctly

## [0.3.3] — 2026-03-19 — CI Fix

### Fixed
- React SDK references updated from `@polpo-ai/client` to `@polpo-ai/sdk` (package rename missed in react-sdk)
- Release workflow updated to build `@polpo-ai/sdk` instead of `@polpo-ai/client`
- Lockfile synced with workspace dependencies

## [0.3.2] — 2026-03-19 — Ports & Adapters, SDK, Skills

### Added
- **@polpo-ai/core** — pure business logic package, zero Node.js dependencies (types, schemas, state machine, hooks, store interfaces, EventBus, managers)
- **@polpo-ai/drizzle** — Drizzle ORM stores with dual-dialect support (PostgreSQL + SQLite), 11 store implementations, `ensurePgSchema()`
- **@polpo-ai/server** — edge-compatible Hono route factories (agents, missions, tasks, completions, events, config, files, skills)
- **@polpo-ai/tools** — all agent tools in one lightweight package with FileSystem/Shell abstractions
- **@polpo-ai/sdk** — TypeScript SDK for the Polpo API (agents, tasks, missions, teams, vault, memory, SSE events)
- **FileSystem + Shell abstractions** in core — ports & adapters pattern for runtime-agnostic I/O
- **Skills system** — SKILL.md files with YAML frontmatter, per-agent assignment, GitHub install (`polpo skills add`), injected into agent system prompts
- **Agent-direct completions** — OpenAI-compatible `POST /v1/chat/completions` for user-to-agent chat with SSE streaming
- **Session management** — agent-scoped sessions, bulk import (`POST /sessions/import`), rename, delete
- **Per-agent memory** — agent-scoped memory tools for direct chat context
- **TeamStore / AgentStore abstractions** — agents persisted independently from polpo.json (FileAgentStore, DrizzleAgentStore)
- **VaultStore / PlaybookStore** — AES-256-GCM encrypted credential storage with Drizzle backend
- **OrchestratorEngine + Spawner abstraction** — decoupled orchestration from Node.js process spawning
- **MissionExecutor in core** — pure logic, zero Node.js dependencies, async store loading via `.ready`
- **Route factory pattern** — all routes accept dependency injection, reusable across runtimes
- **Electron auto-updater** — desktop app self-updates via GitHub Releases (multi-platform CI)
- **SDK E2E tests** — 22 tests covering tasks, missions, vault, teams, SSE events

### Fixed
- **Agent changes now persist across restarts** — `syncConfigCache()` called on startup, reads from agents.json (authoritative source) instead of stale polpo.json (#35)
- **Desktop update warning** — `polpo update` detects Electron context and warns to restart the app (#33)
- PostgreSQL compatibility — split `ensurePgSchema` into individual statements for Neon HTTP driver
- SDK remote API compatibility — `apiPrefix` auto-detection, Authorization header, health endpoint
- JSON serialization for text columns — `deserializeJson` handles both string and parsed object inputs
- Transcript persistence in postgres/sqlite mode
- VaultStore wiring when `storage=postgres/sqlite`
- Replace `workspace:*` with versioned deps in published packages

### Changed
- Renamed `coding-tools` → `system-tools`
- Renamed `client-sdk` → `@polpo-ai/sdk`
- Decoupled completions route from Orchestrator class (dependency injection)
- Tools use FileSystem/Shell abstractions exclusively (no more platform if/else)
- `buildAgentSystemPrompt` extracted to core, accepts optional skills
- `parseModelSpec` + `PROVIDER_ENV_MAP` extracted to core

### Removed
- Raw SQLite stores — all SQL now goes through Drizzle
- TUI (Ink-based terminal UI) — replaced by web dashboard + CLI

## [0.3.0] — 2026-02-20 — Quality Layer & Scheduling

### Added
- **Quality controller** with plan-level quality gates — block plan progression until score thresholds are met
- **SLA deadline monitor** — emits `sla:warning` and `sla:violated` events for tasks and plans approaching or exceeding deadlines
- **Cron-based plan scheduler** — recurring plan execution via cron expressions with `schedule:triggered`, `schedule:created`, and `schedule:completed` events
- Notification integration for quality and scheduling events
- `quality:gate` and `quality:sla` lifecycle hooks for before/after interception
- `schedule:trigger` lifecycle hook

## [0.2.0] — 2026-02-10 — Lifecycle Hooks & Operations

### Added
- **Lifecycle hook system** — 15 hook points across task, plan, assessment, quality, scheduling, and orchestrator events; before-hooks can cancel/modify, after-hooks are observe-only
- **Approval gates** — hybrid automatic (condition-based) and human (blocking) approval with configurable timeouts; `awaiting_approval` task state
- **Notification system** — channel-based routing (Slack, Telegram, Email, Webhook) with Markdown templates and event-driven dispatch
- **4-level escalation chain** — retry → reassign → notify → human intervention with `escalation:triggered`, `escalation:resolved`, and `escalation:human` events
- **Approval events** — `approval:requested`, `approval:resolved`, `approval:timeout`
- **SLA events** — `sla:warning`, `sla:violated`, `sla:met`
- File-based approval store (`FileApprovalStore`)
- Notification template engine with per-channel formatting

## [0.1.0] — 2026-01-30 — Initial Release

### Added
- Core orchestrator with 5-second supervisor loop, graceful shutdown, and orphan recovery
- Built-in engine (Pi Agent) with 7 coding tools, 18+ LLM providers, and MCP support
- SQLite-backed state persistence with WAL mode and crash resilience
- File and JSON store backends for tasks, runs, sessions, logs, and config
- Detached runner with RunStore for process management
- G-Eval assessment system with multi-evaluator consensus (median + outlier filtering)
- Plan executor with JSON-defined task groups and dependency resolution
- Deadlock detection and LLM-assisted resolution
- Question detection (heuristic + LLM classifier)
- 7-state task state machine (`pending`, `awaiting_approval`, `assigned`, `in_progress`, `review`, `done`, `failed`)
- 55+ typed events across 19 categories
- Hono HTTP API server with SSE and WebSocket streaming
- API key authentication with timing-safe comparison
- Zod runtime validation on all API endpoints
- Retry utility with exponential backoff and jitter for LLM calls
- CLI with `run`, `init`, `status`, and `serve` commands
- Ink-based TUI with Zustand state management
- React SDK with SSE-based hooks (`useTasks`, `usePlans`, `useAgents`, etc.)
- Vite + React web dashboard with shadcn/ui
- Mintlify documentation site
- MCP client manager with automatic tool bridging and server-name prefixing
- Filesystem sandbox (`allowedPaths`) and `safeEnv` secret stripping
- Skills system with project-level pool and per-agent symlinks
- Volatile teams for temporary specialist agents scoped to a single plan

### Security
- Timing-safe API key comparison (`crypto.timingSafeEqual`)
- Restrictive default CORS (localhost only)
- `safeEnv` strips API keys and secrets from subprocess environments
- No-eval condition DSL for approval gate expressions
- Internal error messages sanitized in HTTP responses
- Default server binding to `127.0.0.1` (localhost only)
- Claude SDK moved to optional dependencies
