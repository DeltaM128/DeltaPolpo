/**
 * The tools of an agent with a drive: keeping its self-portrait (who it is, the people that matter,
 * its open threads), which it carries from one conversation to the next.
 */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { DriveManager } from "../core/drive.js";

export const UPDATE_SELF_DESCRIPTION = "Rewrite your self-portrait, the whole text: your personality (character, voice, what you care about, quirks), "
  + "the people who matter to you and how they like to be treated, and your open threads. It is part of every conversation you have, "
  + "so keep it current and concise; stay true to who you are while growing with experience.";

export const UpdateSelfSchema = Type.Object({
  portrait: Type.String({ description: "The whole self-portrait (Markdown), replacing the previous one" }),
});

type Result = { content: { type: "text"; text: string }[]; details: Record<string, unknown> };
const text = (t: string): Result => ({ content: [{ type: "text", text: t }], details: {} });

export function createDriveTools(agent: string, manager: DriveManager): AgentTool<any>[] {
  return [
    {
      name: "update_self",
      label: "Update self-portrait",
      description: UPDATE_SELF_DESCRIPTION,
      parameters: UpdateSelfSchema,
      execute: async (_id, params) => {
        const portrait = String((params as { portrait?: unknown }).portrait ?? "").trim();
        if (!portrait) return text("Error: the portrait is empty");
        const revision = manager.setSelf(agent, portrait, manager.isReflecting(agent) ? "reflection" : "chat");
        return text(`Self-portrait saved (${revision.after.length} characters).`);
      },
    },
  ];
}
