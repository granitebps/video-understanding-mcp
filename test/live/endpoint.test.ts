import { realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import { describe, expect, it } from "vitest";

import { createUnderstand } from "../../src/analysis/understand.js";
import { loadConfig, PART_FORMATS, type PartFormat } from "../../src/config/env.js";
import { toVideoError } from "../../src/errors/video-error.js";
import { Dependencies } from "../../src/media/dependencies.js";

const env = process.env;
const baseUrl = env.VIDEO_LIVE_BASE_URL?.trim();
const model = env.VIDEO_LIVE_MODEL?.trim();
const source = env.VIDEO_LIVE_SOURCE?.trim();
const format = (env.VIDEO_LIVE_PART_FORMAT?.trim() ?? "image_url") as PartFormat;
/** "ok" (default) or the error code the run must produce, such as MEDIA_NOT_PROCESSED. */
const expected = env.VIDEO_LIVE_EXPECT?.trim() ?? "ok";
const configured = Boolean(baseUrl && model && source);

describe.skipIf(!configured)("live endpoint", () => {
  it(`analyzes VIDEO_LIVE_SOURCE with ${format} (expect ${expected})`, async () => {
    if (!PART_FORMATS.includes(format)) throw new Error(`Unknown VIDEO_LIVE_PART_FORMAT ${format}`);
    const local = source !== undefined && isAbsolute(source);
    const config = loadConfig({
      VIDEO_BASE_URL: baseUrl,
      VIDEO_MODEL: model,
      VIDEO_API_KEY: env.VIDEO_LIVE_API_KEY,
      VIDEO_PART_FORMAT: format,
      VIDEO_VERIFY_MEDIA: env.VIDEO_LIVE_VERIFY_MEDIA,
      ...(local && source ? { VIDEO_ALLOWED_DIRS: realpathSync(dirname(source)) } : {}),
    });
    const understand = createUnderstand(config, new Dependencies(config), {
      logger: () => undefined,
    });

    let outcome: string;
    let answer = "";
    try {
      const result = await understand(
        {
          source: source ?? "",
          question:
            env.VIDEO_LIVE_QUESTION ?? "What happens in this video, and what text is shown?",
        },
        new AbortController().signal,
      );
      outcome = "ok";
      answer = result.answer;
      console.log(
        JSON.stringify(
          {
            format,
            reportedModel: result.analysis.reportedModel,
            usage: result.analysis.usage,
            warnings: result.analysis.warnings,
            summary: result.summary,
            onScreenText: result.on_screen_text,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      const mapped = toVideoError(error);
      outcome = mapped.code;
      console.log(`[${mapped.code}] ${mapped.safeMessage}`);
    }

    expect(outcome).toBe(expected);
    if (expected === "ok") expect(answer.length).toBeGreaterThan(20);
  });
});
