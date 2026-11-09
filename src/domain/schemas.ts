import { z } from "zod";

import { PART_FORMATS } from "../config/env.js";

export const WarningSchema = z.object({ code: z.string(), message: z.string() });

export const TimelineEntrySchema = z.object({
  start: z.number().describe("Seconds from the start of the source video"),
  description: z.string(),
});

export const SpeechSchema = z.object({
  present: z.boolean(),
  language: z.string().nullable(),
  transcript: z.string().describe("Transcript in the original language; empty when no speech"),
});

export const AnalysisSchema = z.object({
  configuredModel: z.string(),
  reportedModel: z.string().nullable(),
  usage: z
    .object({
      promptTokens: z.number().nullable(),
      completionTokens: z.number().nullable(),
    })
    .nullable(),
  sourceDurationSeconds: z.number(),
  analyzedRange: z.object({ start: z.number(), end: z.number() }),
  partFormat: z.enum(PART_FORMATS),
  warnings: z.array(WarningSchema),
});

export const UnderstandVideoResultSchema = z.object({
  answer: z.string(),
  summary: z.string(),
  speech: SpeechSchema,
  on_screen_text: z.array(z.string()),
  timeline: z.array(TimelineEntrySchema),
  analysis: AnalysisSchema,
});

export type Warning = z.infer<typeof WarningSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type Speech = z.infer<typeof SpeechSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type UnderstandVideoResult = z.infer<typeof UnderstandVideoResultSchema>;
