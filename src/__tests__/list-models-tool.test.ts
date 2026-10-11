import { describe, it, expect } from "vitest";
import { execListModels } from "../llm/orchestrator-tools.js";

const only = (...providers: string[]) => () => new Set(providers);
const ids = (out: string) => [...out.matchAll(/^- (\S+) —/gm)].map((m) => m[1]!);

describe("list_models", () => {
  it("lists only connected providers by default, with id, context, price and capabilities", () => {
    const out = execListModels({}, only("anthropic"));
    expect(out).toMatch(/^\d+ model\(s\) from connected providers:/);
    expect(ids(out).length).toBeGreaterThan(0);
    expect(ids(out).every((id) => id.startsWith("anthropic:"))).toBe(true);
    expect(out).toMatch(/\| context \d+(\.\d)?[kM] \| in \$[\d.]+ \/ out \$[\d.]+ per M tokens/);
  });

  it("filters by words, reasoning and vision; sorts by cost; respects the limit", () => {
    const sonnet = ids(execListModels({ search: "sonnet" }, only("anthropic", "openai")));
    expect(sonnet.length).toBeGreaterThan(0);
    expect(sonnet.every((id) => id.includes("sonnet"))).toBe(true);
    expect(execListModels({ reasoning: true }, only("anthropic"))).not.toMatch(/^- (?!.*reasoning).*$/m);

    const cheap = execListModels({ sort: "cost", limit: 3 }, only("openai"));
    expect(ids(cheap)).toHaveLength(3);
    expect(cheap).toMatch(/… and \d+ more/);
  });

  it("the whole catalog on request; a clear answer when nothing matches", () => {
    expect(execListModels({}, only())).toMatch(/connected_only=false/);
    expect(ids(execListModels({ connected_only: false, provider: "openai", limit: 5 }, only())).every((id) => id.startsWith("openai:"))).toBe(true);
    expect(execListModels({ search: "no-such-model-xyz", connected_only: false })).toBe("No models match.");
  });
});
