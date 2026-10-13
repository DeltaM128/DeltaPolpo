# DeltaPolpo: a fork of Polpo 0.4.6, with fixes that also apply to Polpo

Hi! I built **DeltaPolpo**, a fork of Polpo `v0.4.6` focused on visual workflows, local (offline) models and a Windows desktop installer. While testing it I found and fixed several bugs that are also in Polpo itself. This is the complete list, with the cause, the fix, the files and the commit for each, so you can take what is useful.

- **Base:** tag `v0.4.6`, branch `feat/graph-editor`
- **Size:** 18 commits, 75 files, +7,064 / −581 lines
- **Repository:** _link to the public fork_
- **License:** MIT, unchanged; Polpo is credited in the README and in `DELTAPOLPO.md`. DeltaPolpo is an independent fork, not affiliated with the Polpo project.

Contents: [1. Bug fixes](#1-bug-fixes-that-apply-to-polpo) · [2. New features](#2-new-features) · [3. Behaviour changes to review](#3-behaviour-changes-to-review) · [4. Fork-only changes](#4-fork-only-changes-not-proposed) · [5. Found but not fixed](#5-found-but-not-fixed) · [6. Testing](#6-testing) · [7. Suggested pull requests](#7-suggested-pull-requests)

---

## 1. Bug fixes that apply to Polpo

### Desktop app (Bun-compiled server)

**1.1 No task ever runs in the packaged desktop app** (critical)
- **Symptom:** every task fails with "The agent process (pid …) exited unexpectedly"; the runner log says `too many arguments. Expected 0 arguments but got 3`.
- **Cause:** `NodeSpawner` starts runners as `process.execPath <path to runner.js> --config …`. Inside the Bun binary that script does not exist, so the binary reads the arguments as CLI commands.
- **Fix:** a hidden `__runner` command in the CLI entry point. When the runner script is missing, the spawner runs `[execPath, "__runner", "--config", path]`.
- **Files:** `src/core/runner-command.ts` (new), `src/adapters/node-spawner.ts`, `src/cli/index.ts`
- **Commit:** `9f3c351`

**1.2 "Login with subscription" fails for every provider in the desktop app**
- **Symptom:** `Cannot find module './anthropic.js'`.
- **Cause:** the OAuth flows of `@earendil-works/pi-ai` are loaded with dynamic imports that the Bun binary cannot resolve. In addition, the provider login page opened in a bare Electron window.
- **Fix:**
  - `registerBunOAuthFlows()` from `@earendil-works/pi-ai/bun-oauth` at CLI start.
  - Electron opens external links in the default browser (`setWindowOpenHandler` plus `will-navigate` → `shell.openExternal`).
- **Files:** `src/cli/index.ts`, `ui/electron/main.mjs`
- **Commit:** `0a5ea3a`

**1.3 After a setup completed from the dashboard, tasks stay pending until the server restarts**
- **Cause:** `autoStart: hasConfig` is evaluated before setup runs, so the supervisor loop never starts.
- **Fix:** `autoStart: true`. `ensureSupervisorRunning()` already waits for an initialized orchestrator.
- **Files:** `src/cli/index.ts`
- **Commit:** `83c8c55`

**1.4 After a setup completed from the dashboard, the dashboard receives no live events until restart**
- **Symptom:** tasks, missions and checkpoints change on the server, but pages, counters and badges stay frozen. `/events` sends only heartbeats.
- **Cause:** `initOrchestrator()` disposes the placeholder `SSEBridge` and creates a new one, but `createApp()` had already handed the placeholder to the `/events` route.
- **Fix:** reuse the existing bridge; `SSEBridge.start()` is now idempotent.
- **Files:** `src/server/index.ts`, `src/server/sse-bridge.ts`
- **Commit:** `ae26ef4`

### Task runner and providers

**1.5 Task runs ignore custom providers from `polpo.json`**
- **Symptom:** a model on a custom provider (Ollama, LM Studio, a gateway) works in chat, but its tasks fail with "Model not found for provider".
- **Cause:** only the orchestrator process loads the provider overrides; the runner process does not.
- **Fix:** the runner calls `setProviderOverrides(parseProviders(fileConfig.providers))` and `setProviderSecretsSource(...)` backed by the vault.
- **Files:** `src/core/runner.ts`
- **Commit:** `83c8c55`

### Playbooks and missions

**1.6 Playbooks cannot be run from the dashboard**
- **Symptom:** the run dialog exists, but no button opens it.
- **Fix:** a Run button on playbook cards and on the playbook page.
- **Files:** `ui/src/pages/playbooks.tsx`, `ui/src/pages/playbook-detail.tsx`
- **Commit:** `bc3aaa1`

**1.7 Playbooks with checkpoints or delays can be saved but not run**
- **Symptom:** the run answers a plain-text 500, and the UI shows `Unexpected token 'I', "Internal S"... is not valid JSON`.
- **Cause:** the mission schema requires every task in a gate's `blocksTasks` to `dependsOn` the gate's `afterTasks`. Playbooks did not include those dependencies, and `executeMission` threw after the mission had already been saved.
- **Fix:**
  - The required dependencies are added at run time (`withFlowControlDependencies`) and by the graph editor on save.
  - A run that cannot start returns a JSON 400 (`INVALID_MISSION`) and deletes the mission it had just created.
- **Files:** `packages/server/src/routes/playbooks.ts`, `packages/server/src/deps.ts`, `src/server/app.ts`, `ui/src/lib/playbook-graph-edit.ts`
- **Commit:** `7838783`

**1.8 `GET /missions/checkpoints` and `GET /missions/delays` return "Mission not found"**
- **Cause:** `GET /missions/{missionId}` was registered first and matches them.
- **Fix:** register the two routes before it.
- **Files:** `packages/server/src/routes/missions.ts`
- **Commit:** `22c70c0`

**1.9 A checkpoint pause is lost on restart, and the blocked task is force-failed as a deadlock (file storage)**
- **Cause:**
  - In file mode there was no checkpoint or delay store, so their state lived in memory only.
  - The deadlock detector did not know that a paused mission is waiting for a person.
  - Checkpoint definitions were not restored after a restart.
- **Fix:**
  - `FileCheckpointStore` / `FileDelayStore` are injected in file mode (`.polpo/checkpoints.json`, delays file).
  - A paused mission is never treated as a deadlock.
  - `restoreCheckpointDefinitions()` re-registers definitions from the mission JSON, so missions paused before the fix get their checkpoint back.
- **Files:** `src/core/orchestrator.ts`, `packages/core/src/orchestrator-engine.ts`, `packages/core/src/mission-executor.ts`
- **Commit:** `22c70c0`

**1.10 Running a playbook a second time: the new mission never completes**
- **Symptom:**
  - The second run reaches its checkpoint immediately.
  - It then stays "active" forever.
  - With SQLite storage the second run fails instead, because mission names are unique there.
- **Cause:** every run creates a mission with the playbook name, and the mission name is its task group. The runs share tasks, checkpoint keys and completion, and group-based completion always resolves to the first mission.
- **Fix:**
  - `saveMission` names later missions `name (2)`, `name (3)`…
  - Task titles must be unique within a group, not across all active tasks, so two runs can overlap.
- **Files:** `packages/core/src/mission-executor.ts`, `packages/core/src/task-manager.ts`
- **Commit:** `8c7cbe6`

**1.11 Checkpoints, delays and quality gates are skipped when another mission has tasks with the same titles**
- **Symptom:** two overlapping runs of one playbook; one pauses at its checkpoint and the other runs straight through it.
- **Cause:** the engine passes *all* tasks to `getBlockingCheckpoint`, `getBlockingDelay` and `getBlockingGate`, which find `afterTasks` by title. One run's checkpoint counts as "not reached" while the other run's task with the same title is still pending.
- **Fix:** the engine passes only the tasks of the task's own group.
- **Files:** `packages/core/src/orchestrator-engine.ts`
- **Commit:** `d49c111`

**1.12 Missions that share a group never complete, and Abort and Resume do nothing**
- **Symptom:** on missions created before 1.10, all tasks are done but the mission stays "active", and Abort has no effect.
- **Cause:**
  - Completion, `abortGroup` and the mission page work per group and resolve the mission from the group's first task, which belongs to the first mission.
  - At startup `rebuildCleanedGroups()` marks such groups as finished forever.
  - `deleteMission` removes every task of the group, including other missions' tasks.
- **Fix:**
  - Completion is tracked per run (group + mission id), and the startup rebuild leaves runs whose mission is still active, so they complete on the next tick.
  - `abortGroup(group, missionId?)` aborts only that mission. It also cancels a mission paused at a checkpoint and releases its checkpoint and delay state.
  - `deleteMission` removes only its own tasks.
- **Files:** `packages/core/src/mission-executor.ts`, `packages/core/src/task-manager.ts`, `packages/core/src/orchestrator-engine.ts`, `packages/server/src/routes/missions.ts`, `src/llm/orchestrator-tools.ts`, `ui/src/pages/mission-detail.tsx`
- **Commit:** `d49c111`

### Dashboard and SDK

**1.13 The mission page refreshes only on the first change of a run**
- **Cause:** `useMission` refetches when `missionsStale` turns true, but nothing clears the flag when the list hook is not mounted, so the effect never fires again. Separately, `checkpoint:reached` / `checkpoint:resumed` were no-ops in the reducer.
- **Fix:**
  - `store.clearMissionsStale()` runs before refetching, and the hook refetches again if events arrived meanwhile (same in `useMissions`).
  - Checkpoint events set the mission status to paused / active.
  - `mission:aborted` marks missions stale.
- **Files:** `packages/client-sdk/src/store/polpo-store.ts`, `packages/client-sdk/src/store/event-reducer.ts`, `packages/react-sdk/src/hooks/use-mission.ts`, `packages/react-sdk/src/hooks/use-missions.ts`
- **Commits:** `ae26ef4`, `d49c111`

**1.14 The Approvals page blanks on every refetch**
- **Symptom:** the counters drop to 0 and the list disappears.
- **Cause:** `useApprovals` sets `isLoading` on every refetch, and the page shows a full-page spinner while loading.
- **Fix:** `isLoading` covers the first load only; responses from unmounted effects are ignored.
- **Files:** `packages/react-sdk/src/hooks/use-approvals.ts`
- **Commit:** `d49c111`

**1.15 The agents list stays stale after an agent's configuration changes**
- **Cause:** the agents ETag did not depend on the content, so the server kept answering 304 with the old list.
- **Fix:** a content-based ETag (`contentFingerprint`).
- **Files:** `packages/server/src/etag.ts`, `packages/server/src/routes/agents.ts`
- **Commit:** `0008818`

---

## 2. New features

**2.1 Playbook graph editor** (Playbooks → a playbook → Editor)
- Add tasks, checkpoints and delays; connect them by dragging; edit them in a side panel; save.
- Cycles are refused, and renames and deletions update every reference.
- A **New playbook** button creates an empty playbook.
- Pure graph operations, with tests: `ui/src/lib/playbook-graph-edit.ts`, `ui/src/components/playbook-graph-editor.tsx`
- Commits: `b373b27`, `d1d3ca1`

**2.2 Agent pipelines are executed**
- The `loops` / `pipeline` contract in `docs/loops.md` was validated and stored but never run. Agents with a pipeline now run it for their tasks:
  - loops with their own instructions, tools, model, turn limit, `stopWhen` and `output.schema` (retried with feedback, at most 3 attempts);
  - `parallel` with join all / any / n;
  - `switch`, `when` guards, and `human` approvals.
- **Implementation:**
  - `src/core/pipeline/`: executor, a safe expression evaluator, a minimal JSON Schema validator, and the human-approval relay.
  - `src/adapters/pipeline.ts`.
- **Human steps:** the runner reaches the orchestrator over the notification socket, extended with line-delimited request/response. Line-delimited messages are needed because half-closing a Windows named pipe does not work.
- **Approvals:** human steps are regular approvals with a `pipeline:` gate id. Approvals left open by a stopped pipeline are closed automatically.
- `PATCH /agents/:name` accepts `pipeline: null` and rejects pipelines that reference unknown loops.
- Commits: `1d3ac19`, `7e93cbc`

**2.3 Pipeline editor** (Agents → an agent → Pipeline)
- A top-down flow with "+" insertion points.
- Validation (unknown loops, empty branches, duplicate approval names) blocks saving.
- Commit: `27b0144`

**2.4 Live pipeline view** (Tasks → a task → Pipeline)
- Each step is colored by its state, with attempts, retry feedback, errors and the shared context.
- It updates live while the task runs and is rebuilt from the run log afterwards; `agent:activity` carries the pipeline state.
- Commit: `0008818`

**2.5 Local (offline) models in setup**
- A "Local model (offline)" option: Ollama, LM Studio, vLLM or any OpenAI-compatible server on this machine or the local network.
- Models are discovered automatically. Ollama models without tool calling are flagged (via `/api/show`), since they cannot run agent tasks.
- Tested offline with gemma4:12b, gemma4:e4b, qwen3-vl:4b-instruct and qwen3:4b-instruct.
- Files: `src/setup/local-provider.ts`, `src/server/routes/config.ts`, `ui/src/components/setup/local-model-step.tsx`
- Commits: `83c8c55`, `816db0d`

**2.6 Checkpoints in the dashboard**
- A reached checkpoint opens a regular approval request (`checkpoint:` gate), which appears on the Approvals page, in the sidebar badge, in the history and through `/approve`.
- Approving it resumes the mission; rejecting it aborts the mission.
- The mission page shows the pause with an "Approve and continue" button.
- Resume, abort and delete close the request.
- Commits: `22c70c0`, `d49c111`

**2.7 Mission actions**
- A Delete button (with confirmation) on the mission page.
- Abort is available on paused missions.
- Commit: `d49c111`

---

## 3. Behaviour changes to review

These change existing behaviour. They seemed right to me, but they are your call:

1. **Mission names are unique:** a new mission with a taken name gets ` (2)`, ` (3)`… (1.10).
2. **Task titles are unique per mission,** not across all active tasks (1.10).
3. **A checkpoint is an approval request,** and rejecting it aborts the mission (2.6).
4. **Abort also cancels a paused mission** and releases its checkpoints and delays (1.12).
5. **The server always starts the supervisor** (`autoStart: true`); it runs once the orchestrator is initialized (1.3).

---

## 4. Fork-only changes (not proposed)

- **Name and app identity:** DeltaPolpo, app id `sh.polpo.deltapolpo`, port 3891, settings in `~/.deltapolpo-desktop`, data in `%APPDATA%\DeltaPolpo`. This lets it install next to an original Polpo.
- **Updates:** auto-update off, and the electron-builder `publish` target removed.
- **Installer build:** `scripts/build-deltapolpo-installer.ps1`. It uses Git Bash instead of the WSL launcher and extracts winCodeSign without the macOS symlinks that require Developer Mode. These two Windows workarounds may be useful upstream.
- **Docs:** README banner, `DELTAPOLPO.md`, `CHANGELOG.md` entry `0.4.6-delta.1`, Italian release notes.

---

## 5. Found but not fixed

- **Windows build:** the root `pnpm run build` calls `./node_modules/.bin/tsc` and fails on Windows; building package by package works.
- **Windows tests:** the full test suite has about 85 failures from symlinks, file permissions and bash (e.g. 30 in `orchestrator.test.ts`, the skills symlink test in `server-api.test.ts`). Two files hang: `migrate-vault-refs` and `sandbox-tools-fs`.
- **Local models and orchestrator chat:** chatting with the orchestrator on a local model needs about 64k tokens of context on the model server. Ollama's default 16k fails; agent tasks fit in 16k.
- **Playbook editor:** node positions are not saved, so the graph is laid out again when reopened (DeltaPolpo limitation).

---

## 6. Testing

- **New unit tests:**
  - `src/__tests__/pipeline-executor.test.ts`, `pipeline-adapter.test.ts`, `local-provider.test.ts`;
  - a mission-name test in `mission-resume.test.ts`;
  - `ui/tests/playbook-graph-edit.test.tsx`, `ui/tests/pipeline-edit.test.tsx`.
- **Existing suites:** no new failures. Mission, checkpoint, approval, playbook and React SDK tests pass, and the Windows baseline above is unchanged.
- **End to end, offline with Ollama, on the packaged installer and a dev server:**
  - all four models complete agent tasks;
  - a playbook with a checkpoint survives a restart while paused;
  - repeated and overlapping runs each pause at their own checkpoint and complete;
  - approve, reject, abort-while-paused and delete;
  - live updates after a setup done in the browser.

---

## 7. Suggested pull requests

If you want any of this upstream, I can split it into small PRs:

1. **Desktop app fixes:** 1.1, 1.2, 1.3, 1.4. Small and independent.
2. **Runner custom providers:** 1.5.
3. **Playbook run fixes:** 1.6, 1.7, 1.8.
4. **Mission correctness:** 1.9 to 1.12, with the behaviour changes in section 3.
5. **Dashboard refresh fixes:** 1.13, 1.14, 1.15.
6. **Features,** one per PR if you want them: 2.1 to 2.7.

Thanks for Polpo!
