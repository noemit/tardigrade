import { z } from "zod";

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click_text"),
    text: z.string(),
    role: z.enum(["button", "link", "textbox", "combobox", "checkbox", "generic"]).optional(),
    exact: z.boolean().optional(),
    context: z.string().optional(),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("click_at"),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("type"),
    selector: z.string(),
    value: z.string(),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("commentary"),
    text: z.string(),
    x: z.number().int().min(0).optional(),
    y: z.number().int().min(0).optional(),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("wait"),
    milliseconds: z.number().int().min(0).max(30000),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("scroll"),
    deltaX: z.number().int(),
    deltaY: z.number().int(),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("navigate"),
    url: z.string().url(),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("terminate"),
    status: z.enum(["success", "failure", "stuck"]),
    summary: z.string(),
  }),
]);

export type AgentAction = z.infer<typeof ActionSchema>;
