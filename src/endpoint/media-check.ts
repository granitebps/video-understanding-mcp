import { PART_FORMATS, type PartFormat } from "../config/env.js";
import type { Warning } from "../domain/schemas.js";
import { VideoError } from "../errors/video-error.js";

/** Both providers probed charged about 90 prompt tokens per video second; 25/s leaves margin. */
const MIN_TOKENS_PER_SECOND = 25;
const MIN_VIDEO_TOKENS = 200;

export function minimumVideoTokens(clipSeconds: number): number {
  return Math.max(MIN_VIDEO_TOKENS, Math.round(MIN_TOKENS_PER_SECOND * clipSeconds));
}

export interface MediaCheckInput {
  mainPromptTokens: number | null;
  /** Prompt tokens of the identical request without the video, or null when it failed. */
  baselinePromptTokens: number | null;
  clipSeconds: number;
  partFormat: PartFormat;
}

/**
 * Compares the real request with a text-only baseline so fixed endpoint overhead cancels out.
 * Throws MEDIA_NOT_PROCESSED when the video evidently was not counted; returns a warning when
 * the comparison is impossible.
 */
export function verifyMediaProcessed(input: MediaCheckInput): Warning | null {
  if (input.mainPromptTokens === null || input.baselinePromptTokens === null) {
    return {
      code: "MEDIA_UNVERIFIED",
      message:
        "The endpoint did not report the token usage needed to confirm that the video was processed",
    };
  }

  const videoTokens = input.mainPromptTokens - input.baselinePromptTokens;
  const required = minimumVideoTokens(input.clipSeconds);
  if (videoTokens >= required) return null;

  const alternatives = PART_FORMATS.filter((format) => format !== input.partFormat).join(", ");
  throw new VideoError({
    code: "MEDIA_NOT_PROCESSED",
    safeMessage:
      `The endpoint probably ignored the video: the request with the video used ${videoTokens} more prompt tokens than the same request without it, ` +
      `but a ${input.clipSeconds.toFixed(1)} s clip needs at least ${required}. ` +
      `The request format "${input.partFormat}" may not be supported by this endpoint; set VIDEO_PART_FORMAT to one of: ${alternatives}. ` +
      "Set VIDEO_VERIFY_MEDIA=false only if this endpoint reports token usage unusually.",
  });
}
