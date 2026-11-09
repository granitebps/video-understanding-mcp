import { z } from "zod";

import type { Speech, TimelineEntry, Warning } from "../domain/schemas.js";
import { decodeJsonValues } from "../endpoint/response-parser.js";
import type { ClipRange } from "../media/ffmpeg.js";

export interface ReplyFields {
  answer: string;
  summary: string;
  speech: Speech;
  on_screen_text: string[];
  timeline: TimelineEntry[];
}

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

function seconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const clock = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (clock) {
    const [, hours, minutes, secs] = clock;
    return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs);
  }
  const numeric = Number(value.replace(/s$/i, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

const text = z.string().trim();
const textList = z
  .array(z.unknown())
  .transform((items) => [
    ...new Set(
      items
        .filter((item): item is string => typeof item === "string" && item.trim() !== "")
        .map((item) => item.trim()),
    ),
  ]);
const speechSchema = z.object({
  present: z.boolean().optional(),
  language: z.string().trim().nullable().optional(),
  transcript: z.string().optional(),
});
const timelineSchema = z.array(
  z.object({ start: z.unknown(), description: z.string().trim() }).passthrough(),
);

function field<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function findObject(raw: string): Record<string, unknown> | null {
  const fenced = FENCE.exec(raw)?.[1];
  for (const candidate of [fenced, raw]) {
    if (!candidate) continue;
    const value = decodeJsonValues(candidate).find(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    );
    if (value) return value;
  }
  return null;
}

function emptyFields(answer: string): ReplyFields {
  return {
    answer,
    summary: "",
    speech: { present: false, language: null, transcript: "" },
    on_screen_text: [],
    timeline: [],
  };
}

/**
 * Reads the model's reply leniently: each field is validated on its own, and a reply with no
 * usable JSON object becomes a plain-text answer with a warning.
 */
export function parseReply(raw: string): { fields: ReplyFields; warnings: Warning[] } {
  const object = findObject(raw);
  const answer = object ? field(text, object.answer, "") : "";
  const summary = object ? field(text, object.summary, "") : "";

  if (!object || (!answer && !summary)) {
    const plain = (FENCE.exec(raw)?.[1] ?? raw).trim();
    return {
      fields: emptyFields(plain),
      warnings: [
        {
          code: "STRUCTURED_FIELDS_UNAVAILABLE",
          message: "The model did not return the requested structure; answer holds its raw reply",
        },
      ],
    };
  }

  const speech = field(speechSchema, object.speech, {});
  const transcript = (speech.transcript ?? "").trim();
  const timeline = field(timelineSchema, object.timeline, [])
    .map((entry) => ({ start: seconds(entry.start), description: entry.description }))
    .filter((entry): entry is TimelineEntry => entry.start !== null && entry.description !== "");

  return {
    fields: {
      answer: answer || summary,
      summary,
      speech: {
        present: speech.present ?? transcript.length > 0,
        language: speech.language || null,
        transcript,
      },
      on_screen_text: field(textList, object.on_screen_text, []),
      timeline,
    },
    warnings: [],
  };
}

const TOLERANCE_SECONDS = 1;

/** Drops moments outside the analyzed clip and converts clip time to source-video time. */
export function placeTimeline(
  entries: TimelineEntry[],
  range: ClipRange,
): { timeline: TimelineEntry[]; warnings: Warning[] } {
  const clipSeconds = range.end - range.start;
  const kept = entries.filter(
    (entry) => entry.start >= 0 && entry.start <= clipSeconds + TOLERANCE_SECONDS,
  );
  const dropped = entries.length - kept.length;
  const timeline = kept
    .map((entry) => ({
      start: Math.round(Math.min(entry.start, clipSeconds) * 10 + range.start * 10) / 10,
      description: entry.description,
    }))
    .sort((a, b) => a.start - b.start);

  return {
    timeline,
    warnings:
      dropped > 0
        ? [
            {
              code: "TIMELINE_ENTRIES_REMOVED",
              message: `${dropped} timeline ${dropped === 1 ? "entry was" : "entries were"} outside the analyzed range and removed`,
            },
          ]
        : [],
  };
}
