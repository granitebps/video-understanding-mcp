import { describe, expect, it } from "vitest";

import { redactSecrets, toVideoError, VideoError } from "../../src/errors/video-error.js";

describe("redactSecrets", () => {
  it("removes authorization, cookie, and configured key values", () => {
    const text =
      'upstream said: Authorization: Bearer sk-live-123456 cookie echo "Cookie: sid=abc; t=1" key=my-configured-key VIDEO_API_KEY=xyz';

    const redacted = redactSecrets(text, ["my-configured-key"]);

    expect(redacted).not.toContain("sk-live-123456");
    expect(redacted).not.toContain("sid=abc");
    expect(redacted).not.toContain("my-configured-key");
    expect(redacted).not.toContain("VIDEO_API_KEY=xyz");
  });
});

describe("toVideoError", () => {
  it("keeps coded errors and hides unexpected ones", () => {
    const coded = new VideoError({ code: "TIMEOUT", safeMessage: "slow" });

    expect(toVideoError(coded)).toBe(coded);
    const hidden = toVideoError(new Error("stack details"));
    expect(hidden.code).toBe("INTERNAL_ERROR");
    expect(hidden.safeMessage).not.toContain("stack details");
  });
});
