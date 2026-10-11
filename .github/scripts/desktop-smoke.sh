#!/usr/bin/env bash
# Open a packaged desktop app in smoke test mode and use it: the window must load the UI, a chat
# turn with Polpo must get the mock model's reply, and the main pages must render.
# Usage: desktop-smoke.sh <app executable> [command prefix, e.g. "xvfb-run -a"]
set -euo pipefail
APP="$1"
RUN="${2:-}"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
REPLY="Polpo smoke test reply"
WORK="$(mktemp -d)"
PROJECT="$WORK/project"
RESULT="$WORK/smoke.json"
mkdir -p "$PROJECT/.polpo"
# Polpo answers with the mock model (an OpenAI-compatible custom gateway on this machine)
cat > "$PROJECT/.polpo/polpo.json" <<JSON
{
  "project": "desktop-smoke",
  "team": { "name": "smoke", "agents": [] },
  "settings": { "orchestratorModel": "mockllm:mock-1" },
  "providers": {
    "mockllm": {
      "label": "CI mock model",
      "api": "openai-completions",
      "baseUrl": "http://127.0.0.1:9911/v1",
      "auth": { "type": "none" },
      "allowPrivateNetwork": true,
      "models": [{ "id": "mock-1", "name": "Mock 1", "contextWindow": 128000, "maxTokens": 4096 }]
    }
  }
}
JSON
MOCK_LLM_PORT=9911 MOCK_LLM_REPLY="$REPLY" node "$SCRIPTS/mock-llm.mjs" > "$WORK/mock-llm.log" 2>&1 &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT

PROJECT_ARG="$PROJECT"; RESULT_ARG="$RESULT"
if [[ "${RUNNER_OS:-}" == "Windows" ]]; then PROJECT_ARG="$(cygpath -w "$PROJECT")"; RESULT_ARG="$(cygpath -w "$RESULT")"; fi

echo "--- opening $APP (project $PROJECT_ARG)"
set +e
# from another folder, as a shortcut would start it
(cd "$WORK" && POLPO_SMOKE_TEST="$RESULT_ARG" POLPO_SMOKE_CHAT_REPLY="$REPLY" $RUN "$APP" --no-sandbox "$PROJECT_ARG" > "$WORK/app.log" 2>&1)
CODE=$?
set -e
tail -40 "$WORK/app.log"
echo "--- mock model"
cat "$WORK/mock-llm.log"
echo "--- smoke test result (exit $CODE)"
cat "$RESULT" 2>/dev/null || { echo "no result: the app did not finish the smoke test"; exit 1; }
node -e "
const r = require(process.argv[1]);
const u = r.usage || {};
console.log('loaded:', r.rendered > 0 && !r.fileErrors.length, '| chat:', u.chat && u.chat.ok, JSON.stringify(u.chat && u.chat.reply));
for (const p of u.pages || []) console.log('  page', p.page.padEnd(10), p.ok ? 'ok' : 'FAILED', p.crashed ? '(error boundary)' : '');
process.exit(r.ok && u.ok ? 0 : 1);
" "$RESULT"
