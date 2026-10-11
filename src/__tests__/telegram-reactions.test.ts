import { describe, it, expect, vi, afterEach } from "vitest";
import { reactionOf } from "../notifications/telegram-reactions.js";
import { TelegramCallbackPoller, type TelegramGatewayHandler, type TelegramMessage } from "../notifications/channels/telegram.js";

afterEach(() => vi.unstubAllGlobals());

describe("reactionOf", () => {
  it("a reply that is one supported emoji is a reaction", () => {
    expect(reactionOf("👍")).toBe("👍");
    expect(reactionOf(" 🎉 ")).toBe("🎉");
    expect(reactionOf("❤️")).toBe("❤");           // variation selector dropped
    expect(reactionOf("🤷‍♂️")).toBe("🤷‍♂");        // inside a ZWJ sequence too
  });

  it("text, several emoji or unsupported emoji are replies", () => {
    expect(reactionOf("👍 grazie")).toBeUndefined();
    expect(reactionOf("👍👍")).toBeUndefined();
    expect(reactionOf("🚀")).toBeUndefined();
    expect(reactionOf("")).toBeUndefined();
  });
});

describe("TelegramCallbackPoller — reactions", () => {
  function poller(reply: string, reactionOk = true) {
    const sent: { method: string; body: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: unknown }) => {
      const method = String(url).split("/").pop()!;
      sent.push({ method, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
      if (method === "setMessageReaction") return new Response(JSON.stringify(reactionOk ? { ok: true, result: true } : { ok: false, description: "REACTION_INVALID" }));
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }));
    const handler = {
      handleInboundMessage: vi.fn(async () => ({ text: reply })),
      handleApprovalCallback: vi.fn(async () => undefined),
    } satisfies TelegramGatewayHandler;
    const p = new TelegramCallbackPoller("token", "7");
    p.setGateway(handler);
    const dm: TelegramMessage = { message_id: 31, chat: { id: 7, type: "private" }, from: { id: 7, is_bot: false, first_name: "Ada" }, text: "ok grazie" };
    return { handle: () => (p as any).handleMessage(dm) as Promise<void>, sent };
  }

  it("reacts to the message instead of sending the emoji", async () => {
    const { handle, sent } = poller("👍");
    await handle();
    expect(sent.find(s => s.method === "setMessageReaction")!.body).toEqual({ chat_id: "7", message_id: 31, reaction: [{ type: "emoji", emoji: "👍" }] });
    expect(sent.some(s => s.method === "sendMessage")).toBe(false);
  });

  it("sends the emoji as a message when Telegram refuses the reaction; text replies are sent as usual", async () => {
    const refused = poller("👍", false);
    await refused.handle();
    expect(refused.sent.find(s => s.method === "sendMessage")!.body.text).toContain("👍");

    const text = poller("Sure, done.");
    await text.handle();
    expect(text.sent.some(s => s.method === "setMessageReaction")).toBe(false);
    expect(text.sent.find(s => s.method === "sendMessage")!.body.text).toContain("Sure, done.");
  });
});
