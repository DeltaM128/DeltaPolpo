import { describe, it, expect, vi, afterEach } from "vitest";
import { ChannelGateway, speakableText } from "../notifications/channel-gateway.js";
import { TelegramCallbackPoller, type TelegramGatewayHandler, type TelegramMessage } from "../notifications/channels/telegram.js";
import { synthesizeSpeech } from "../tools/audio-tools.js";
import { createVoiceReplyTool, describeVoiceReplies } from "../tools/voice-reply-tools.js";
import { executeOrchestratorTool } from "../llm/orchestrator-tools.js";
import type { Orchestrator } from "../core/orchestrator.js";
import type { PeerStore } from "../core/peer-store.js";
import type { SessionStore } from "../core/session-store.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** OpenAI TTS answers with Ogg/Opus bytes; every other request succeeds. */
function stubSpeech() {
  const calls: { url: string; body: any }[] = [];
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: init?.body });
    if (String(url).includes("/audio/speech")) return new Response(new Uint8Array([79, 103, 103, 83]));
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }));
  return calls;
}

describe("speakableText", () => {
  it("drops markdown, code blocks and link targets", () => {
    expect(speakableText("## Done\n**All good**: see [the report](https://x.io/r) and `npm test`.\n```\nlog\n```\n- one\n- two"))
      .toBe("Done All good: see the report and npm test. one two");
  });
});

describe("synthesizeSpeech", () => {
  it("OpenAI speaks in Ogg/Opus, the format of Telegram voice messages", async () => {
    const calls = stubSpeech();
    const speech = await synthesizeSpeech("ciao");
    expect(speech).toMatchObject({ mimeType: "audio/ogg", filename: "voice.ogg", provider: "openai" });
    expect(JSON.parse(String(calls[0]!.body))).toMatchObject({ input: "ciao", response_format: "opus" });
  });
});

describe("ChannelGateway voice replies", () => {
  function gateway(agentMode: string | undefined, polpoMode?: string) {
    const orchestrator = {
      getAgents: vi.fn(async () => [{ name: "backend", voiceReplies: agentMode }]),
      getConfig: () => ({ settings: { voiceReplies: polpoMode } }),
      getVaultStore: () => undefined,
      emit: vi.fn(),
    };
    const gw = new ChannelGateway({
      orchestrator: orchestrator as unknown as Orchestrator, peerStore: {} as PeerStore, sessionStore: {} as SessionStore,
      channelConfig: { type: "telegram", gateway: { enableInbound: true } } as any,
    });
    return (agent: string | undefined, voice: boolean, reply: string) => {
      (gw as any).getActiveAgent = async () => agent;
      return (gw as any).withVoice({ channel: "telegram", externalId: "7", chatId: "7", text: "x", voice }, "telegram:7", reply);
    };
  }

  it("off (the default) keeps text; voice answers voice messages; always speaks every reply", async () => {
    stubSpeech();
    expect(await gateway(undefined)("backend", true, "hi")).toBe("hi");
    expect(await gateway("voice")("backend", false, "hi")).toBe("hi");
    expect(await gateway("voice")("backend", true, "hi")).toMatchObject({ text: "hi", voice: { mimeType: "audio/ogg" } });
    expect(await gateway("always")("backend", false, "hi")).toMatchObject({ voice: { filename: "voice.ogg" } });
    // a lone emoji is a reaction (the poller puts it on the message), never spoken
    expect(await gateway("always")("backend", true, "👍")).toBe("👍");
    // Polpo uses settings.voiceReplies
    expect(await gateway(undefined, "always")(undefined, false, "hi")).toMatchObject({ voice: expect.anything() });
  });

  it("without a text-to-speech provider the reply stays text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("PATH", "/nonexistent");
    vi.stubEnv("HOME", "/nonexistent");
    expect(await gateway("always")("backend", true, "hi")).toBe("hi");
  });
});

describe("TelegramCallbackPoller voice replies", () => {
  function poller(text: string) {
    const sent: { method: string; body: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: any }) => {
      const method = String(url).split("/").pop()!;
      const body = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"]))
        : typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      sent.push({ method, body });
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }));
    const handler = {
      handleInboundMessage: vi.fn(async () => ({ text, voice: { data: Buffer.from("OggS"), mimeType: "audio/ogg", filename: "voice.ogg" } })),
      handleApprovalCallback: vi.fn(async () => undefined),
    } satisfies TelegramGatewayHandler;
    const p = new TelegramCallbackPoller("token", "7");
    p.setGateway(handler);
    const dm: TelegramMessage = { message_id: 31, chat: { id: 7, type: "private" }, from: { id: 7, is_bot: false, first_name: "Ada" }, text: "ciao" };
    return { handle: () => (p as any).handleMessage(dm) as Promise<void>, sent, handler };
  }

  it("sends the voice message with the text as caption", async () => {
    const { handle, sent, handler } = poller("**Fatto**: tutto ok");
    await handle();
    expect(handler.handleInboundMessage).toHaveBeenCalledWith("7", "7", "ciao", "Ada", "31", [], undefined, false);
    const voice = sent.find((s) => s.method === "sendVoice")!;
    expect(voice.body).toMatchObject({ chat_id: "7", voice: "<file>", parse_mode: "HTML" });
    expect(voice.body.caption).toContain("Fatto");
    expect(sent.some((s) => s.method === "sendMessage")).toBe(false);
  });

  it("a text too long for a caption follows the voice message as a message", async () => {
    const { handle, sent } = poller("a".repeat(1500));
    await handle();
    expect(sent.find((s) => s.method === "sendVoice")!.body.caption).toBeUndefined();
    expect(sent.some((s) => s.method === "sendMessage")).toBe(true);
  });
});

describe("set_voice_replies", () => {
  it("the agent's tool tells the current mode and saves the new one", async () => {
    const update = vi.fn(async () => {});
    const tool = createVoiceReplyTool(undefined, update);
    expect(tool.description).toContain('Voice replies on Telegram are "off"');
    const result = await tool.execute("id", { mode: "voice" });
    expect(update).toHaveBeenCalledWith("voice");
    expect((result.content[0] as { text: string }).text).toContain('set to "voice"');
    expect(describeVoiceReplies("always")).toContain('"always" (every reply also as a voice message)');
  });

  it("Polpo changes an agent's mode", async () => {
    const polpo = { getAgents: vi.fn(async () => [{ name: "backend" }]), updateAgent: vi.fn(async () => {}) };
    expect(await executeOrchestratorTool("set_voice_replies", { mode: "always", agent: "backend" }, polpo as unknown as Orchestrator))
      .toBe('Voice replies of backend set to "always".');
    expect(polpo.updateAgent).toHaveBeenCalledWith("backend", { voiceReplies: "always" });
    expect(await executeOrchestratorTool("set_voice_replies", { mode: "loud" }, polpo as unknown as Orchestrator)).toMatch(/^Error: mode must be/);
  });
});
