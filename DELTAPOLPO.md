# DeltaPolpo

DeltaPolpo is a fork of [Polpo](https://github.com/alemicali/polpo-zhc) 0.4.6 (MIT). It keeps everything Polpo does — AI agent teams that plan, execute, review and retry their work — and adds:

- **Visual workflows**: a graph editor for playbooks and a flow editor for agent pipelines, with a live view of running pipelines.
- **Executable agent pipelines**: the `loops` / `pipeline` contract that Polpo only stored now runs (loops, parallel branches, switches, human approvals).
- **Local, offline models**: connect Ollama, LM Studio, vLLM or any OpenAI-compatible server during setup — no account, no API key, nothing leaves your machine.
- **A Windows installer** that installs next to an original Polpo without interfering with it.
- **Fixes** to the desktop app and the task runner found along the way (see [CHANGELOG.md](CHANGELOG.md), 0.4.6-delta.1).

Everything is built on Polpo's own code and API: no new framework or service.

---

## Install (Windows)

1. Download `DeltaPolpo-Setup-<version>.exe` from the release.
2. Run it. The installer is not code-signed: Windows SmartScreen shows "Windows protected your PC" — choose **More info → Run anyway**.
3. Choose the installation folder (per-user install, no admin rights needed).
4. On first start, pick a project folder. A new folder opens the setup wizard: choose how to connect a model (subscription login, API key, or **Local model (offline)**), the model, and your first agent.

The installer bundles the server (`polpo-server.exe`): Node.js is not required.

### Next to an original Polpo

| | Polpo desktop | DeltaPolpo |
|---|---|---|
| App id | `ai.polpo.desktop` | `sh.polpo.deltapolpo` |
| Server port | 3890 | **3891** |
| Settings | `~/.polpo-desktop` | `~/.deltapolpo-desktop` |
| App data and logs | `%APPDATA%\ui` | `%APPDATA%\DeltaPolpo` (server log: `logs\server.log`) |
| Auto-update | Polpo releases | **off** (upstream releases would replace DeltaPolpo) |

---

## Features

### Playbook graph editor
**Playbooks → New playbook** (or open one) → **Editor** tab.

- **+ Task / + Checkpoint / + Delay** add nodes; drag from a node's bottom handle to another node's top handle to connect them (task → task is a dependency; task → checkpoint → task pauses for your approval).
- Click a node to edit it in the side panel (title, agent, description with `{{parameters}}`, retries, expectations as JSON). Select and press Delete to remove.
- Cycles are refused. Renaming or deleting a task updates every reference. Saving adds the `dependsOn` that checkpoints and delays require.
- **Run** (on the playbook page or its card) asks for the parameters and starts a mission.

### Agent pipelines
**Agents → an agent → Pipeline** tab.

A pipeline replaces the agent's single session with deterministic steps for every task assigned to it:

- **Loop** — an LLM session of the agent with its own instructions, tools, model, turn limit, *done when* condition and output schema; it is retried with feedback (3 attempts) until the output and condition hold.
- **Human approval** — waits for an approval on the Approvals page (or `/approve`, or the API); rejecting fails the pipeline with the note.
- **Switch** — the first case whose condition is true runs, else the default.
- **Parallel** — branches run at once; join on all, any, or *n* successes.

Insert steps with the **+** on the arrows. Problems (unknown loops, empty branches, duplicate approval names…) are shown on the nodes and block saving. Conditions read the shared context: `context.ticket.category == 'billing'`. Runtime details: [docs/loops.md](docs/loops.md).

### Live pipeline view
**Tasks → a task → Pipeline** tab (for agents with a pipeline). Each step is colored by its state — running (blue), waiting for approval (amber), done (green), failed (red), stopped or skipped (grey) — with attempts, retry feedback, errors and the shared context. It updates live and stays available after the task ends.

### Local models (offline)
In the setup wizard's provider step: **Local model (offline)** → Ollama, LM Studio, vLLM or Other. DeltaPolpo detects the server and its models; Ollama models without tool calling are marked "no tools" (they can chat but cannot run agent tasks). In an existing project, add the server in **Config → Providers** (preset Ollama, LM Studio…), then use `<provider>:<model>` (e.g. `ollama:qwen3:4b-instruct`) as a model.

Requirements of the model server, whatever the model:

- **Tool calling** — agents act through tools (files, commands).
- **Context** — agent tasks fit in 16k tokens; a chat with the orchestrator sends about 64k. Raise the server's context to chat with the orchestrator: Ollama → Settings → Context length (or `OLLAMA_CONTEXT_LENGTH=65536`), LM Studio → load the model with a larger context, vLLM `--max-model-len 65536`, llama.cpp `-c 65536`.

Tested end to end, offline, with gemma4:12b, gemma4:e4b, qwen3-vl:4b-instruct and qwen3:4b-instruct on Ollama 0.40.

---

## Build from source (Windows)

Requirements: Node.js ≥ 22.19 (20.x works with warnings), pnpm 10, Git for Windows.

```powershell
git clone <this repository> DeltaPolpo
cd DeltaPolpo
pnpm install
powershell -ExecutionPolicy Bypass -File scripts\build-deltapolpo-installer.ps1
```

The script builds the packages, the server, the UI (pointed at port 3891), compiles the server into `ui\binaries\polpo-server.exe` with Bun (installed locally into `.deltapolpo-tools\` if missing) and packages `ui\release\DeltaPolpo-Setup-<version>.exe` with electron-builder.

On Windows, the root `pnpm run build` script does not work (it calls `./node_modules/.bin/tsc`); build step by step instead:

```powershell
pnpm --filter @polpo-ai/core build; pnpm --filter @polpo-ai/vault-crypto build; pnpm --filter @polpo-ai/drizzle build; pnpm --filter @polpo-ai/server build; pnpm --filter @polpo-ai/sdk build; pnpm --filter @polpo-ai/react build; pnpm exec tsc
```

Development (server and UI with hot reload):

```powershell
node dist/cli/index.js serve -p 3899 -d <project folder> --cors-origins http://localhost:5199
$env:VITE_POLPO_API_URL="http://localhost:3899"; pnpm --dir ui exec vite --port 5199
```

### Tests

```powershell
pnpm exec vitest run src/__tests__/pipeline-executor.test.ts src/__tests__/pipeline-adapter.test.ts src/__tests__/loop-contract.test.ts src/__tests__/local-provider.test.ts
pnpm exec vitest run --config ui/vitest.config.ts
```

On Windows the full suite (`pnpm exec vitest run`) has about 85 failures that come from upstream and the platform (symlinks, file permissions, bash), and two files hang (`migrate-vault-refs`, `sandbox-tools-fs`).

---

## Known limitations

- The installer is not code-signed (SmartScreen warning) and is built for Windows x64 only.
- Chatting with the orchestrator on a local model needs about 64k tokens of context on the model server (agent tasks need much less).
- Small local models run tasks, but complex tasks may fail or give poor results.
- Pipeline `human` steps need the local server (the task runner reaches it over the notification socket).
- Pipelines run for tasks, not for chats with the agent.
- Node positions in the playbook editor are not saved; the graph is laid out again when reopened.

---

## Releasing

1. Build the installer (above) and run the tests.
2. Push the code to your repository (e.g. a GitHub fork of `alemicali/polpo-zhc`).
3. Tag and create the release with the installer attached, using the notes in [docs/releases/v0.4.6-delta.1.md](docs/releases/v0.4.6-delta.1.md):

```powershell
git tag v0.4.6-delta.1
git push origin v0.4.6-delta.1
gh release create v0.4.6-delta.1 "ui\release\DeltaPolpo-Setup-0.4.6.exe" --title "DeltaPolpo 0.4.6-delta.1" --notes-file docs\releases\v0.4.6-delta.1.md
```

---

## Credits and license

DeltaPolpo is based on [Polpo](https://github.com/alemicali/polpo-zhc) by its authors and contributors, released under the MIT license; DeltaPolpo keeps the same license ([LICENSE](LICENSE)). It is an independent fork, not affiliated with or endorsed by the Polpo project. Several fixes here also apply to upstream Polpo (desktop task runner, subscription login, custom providers in task runs, supervisor after setup, missing Run button, agents list ETag) and could be proposed there.
