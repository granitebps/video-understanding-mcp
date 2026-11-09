import { describe, expect, it } from "vitest";

import { minimumVideoTokens, verifyMediaProcessed } from "../../src/endpoint/media-check.js";
import { buildMediaPart } from "../../src/endpoint/request-shapes.js";

const DATA = "data:video/mp4;base64,AAAA";

describe("buildMediaPart", () => {
  it("builds each request shape with fps only where supported", () => {
    expect(buildMediaPart("video_url", DATA, 4)).toEqual({
      type: "video_url",
      video_url: { url: DATA, fps: 4 },
    });
    expect(buildMediaPart("image_url", DATA, 4)).toEqual({
      type: "image_url",
      image_url: { url: DATA },
    });
    expect(buildMediaPart("file", DATA, 4)).toEqual({
      type: "file",
      file: { file_data: DATA, format: "video/mp4", video_metadata: { fps: 4 } },
    });
    expect(buildMediaPart("input_file", DATA, 4)).toEqual({
      type: "input_file",
      filename: "video.mp4",
      mime_type: "video/mp4",
      file_data: DATA,
    });
  });

  it("omits fps when none was requested", () => {
    expect(buildMediaPart("video_url", DATA, undefined)).toEqual({
      type: "video_url",
      video_url: { url: DATA },
    });
  });
});

describe("verifyMediaProcessed", () => {
  it("fails when an endpoint with fixed overhead dropped the video", () => {
    expect(() =>
      verifyMediaProcessed({
        mainPromptTokens: 2074,
        baselinePromptTokens: 2074,
        clipSeconds: 15,
        partFormat: "video_url",
      }),
    ).toThrow(/probably ignored the video/);
  });

  it("fails when an endpoint without overhead dropped the video", () => {
    expect(() =>
      verifyMediaProcessed({
        mainPromptTokens: 74,
        baselinePromptTokens: 74,
        clipSeconds: 15,
        partFormat: "video_url",
      }),
    ).toThrow(/image_url, file, input_file/);
  });

  it("passes when the video added the expected tokens", () => {
    expect(
      verifyMediaProcessed({
        mainPromptTokens: 3433,
        baselinePromptTokens: 2074,
        clipSeconds: 15,
        partFormat: "image_url",
      }),
    ).toBeNull();
  });

  it("lowers the minimum when a low fps was applied", () => {
    expect(minimumVideoTokens(15)).toBe(375);
    expect(minimumVideoTokens(15, 0.1)).toBe(38);
    expect(minimumVideoTokens(15, 2)).toBe(375);
    expect(
      verifyMediaProcessed({
        mainPromptTokens: 2150,
        baselinePromptTokens: 2074,
        clipSeconds: 15,
        partFormat: "video_url",
        appliedFps: 0.1,
      }),
    ).toBeNull();
  });

  it("warns instead of failing when usage is unavailable", () => {
    expect(
      verifyMediaProcessed({
        mainPromptTokens: 3433,
        baselinePromptTokens: null,
        clipSeconds: 15,
        partFormat: "video_url",
      }),
    ).toMatchObject({ code: "MEDIA_UNVERIFIED" });
  });
});
