import { z } from "zod";

const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection"]);

const headersSchema = z
  .record(z.string().min(1).max(256), z.string().max(8192))
  .refine((headers) => Object.keys(headers).length <= 20, "headers allows at most 20 entries")
  .refine(
    (headers) => Object.keys(headers).every((name) => !FORBIDDEN_HEADERS.has(name.toLowerCase())),
    "headers must not set Host, Content-Length, Transfer-Encoding, or Connection",
  );

export const understandVideoInputSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .describe(
      "Video to analyze: a page URL (TikTok, YouTube, X, ...), a direct media URL, or an absolute local path inside an allowed directory",
    ),
  headers: headersSchema
    .optional()
    .describe(
      "Request headers for a direct media URL, such as Referer or Cookie returned by a scraper. Sent only to that URL's host",
    ),
  question: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe("What to find out about the video. Omit for a general description"),
  start_seconds: z
    .number()
    .min(0)
    .optional()
    .describe("Analyze from this second of the source video"),
  end_seconds: z
    .number()
    .min(0)
    .optional()
    .describe("Analyze up to this second of the source video"),
  fps: z
    .number()
    .min(0.1)
    .max(24)
    .optional()
    .describe(
      "Frame sampling rate hint. Applied only when the endpoint's request format supports it; a short range gives more detail for fast motion",
    ),
});

export type UnderstandVideoInput = z.infer<typeof understandVideoInputSchema>;
