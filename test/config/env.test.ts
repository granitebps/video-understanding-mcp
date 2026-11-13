import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/env.js";

describe("loadConfig", () => {
  it("applies the documented defaults and starts without endpoint settings", () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      baseUrl: undefined,
      model: undefined,
      partFormat: "image_url",
      maxDurationSeconds: 300,
      maxUploadBytes: 15_000_000,
      maxDownloadBytes: 500_000_000,
      requestTimeoutMs: 180_000,
      maxConcurrency: 2,
      maxOutputTokens: 8192,
      verifyMedia: true,
      allowedDirs: [],
      allowPrivateNetwork: false,
    });
  });

  it("reads endpoint settings and trims the base URL", () => {
    const config = loadConfig({
      VIDEO_BASE_URL: "http://127.0.0.1:8000/v1/",
      VIDEO_API_KEY: "secret-key",
      VIDEO_MODEL: "gemini",
      VIDEO_PART_FORMAT: "image_url",
      VIDEO_VERIFY_MEDIA: "false",
    });

    expect(config.baseUrl).toBe("http://127.0.0.1:8000/v1");
    expect(config.partFormat).toBe("image_url");
    expect(config.verifyMedia).toBe(false);
  });

  it.each([
    ["VIDEO_MAX_DURATION_SECONDS", "ten"],
    ["VIDEO_MAX_DURATION_SECONDS", "1.5"],
    ["VIDEO_MAX_UPLOAD_MB", "0"],
    ["VIDEO_REQUEST_TIMEOUT_MS", "100"],
    ["VIDEO_PART_FORMAT", "video"],
    ["VIDEO_BASE_URL", "ftp://example.com"],
    ["VIDEO_VERIFY_MEDIA", "yes"],
    ["VIDEO_ALLOWED_DIRS", "relative/dir"],
  ])("rejects %s=%s with a message naming the setting", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(name);
  });

  it("resolves allowed directories to their real paths", () => {
    const first = mkdtempSync(join(tmpdir(), "vu-allowed-a-"));
    const second = mkdtempSync(join(tmpdir(), "vu-allowed-b-"));

    const config = loadConfig({ VIDEO_ALLOWED_DIRS: `${first}${delimiter}${second}` });

    expect(config.allowedDirs).toEqual([realpathSync(first), realpathSync(second)]);
  });

  it("reads extra headers from a JSON object", () => {
    const config = loadConfig({
      VIDEO_EXTRA_HEADERS: '{"CF-Access-Client-Id":"id","CF-Access-Client-Secret":"secret"}',
    });

    expect(config.extraHeaders).toEqual({
      "CF-Access-Client-Id": "id",
      "CF-Access-Client-Secret": "secret",
    });
    expect(loadConfig({}).extraHeaders).toEqual({});
  });

  it.each([
    ["not JSON", "{oops"],
    ["an array", '["a"]'],
    ["a bad name", '{"bad name":"x"}'],
    ["a reserved name", '{"Authorization":"x"}'],
    ["a non-string value", '{"X-Id":1}'],
    ["a multi-line value", '{"X-Id":"a\\nb"}'],
  ])("rejects VIDEO_EXTRA_HEADERS with %s", (_, value) => {
    expect(() => loadConfig({ VIDEO_EXTRA_HEADERS: value })).toThrow("VIDEO_EXTRA_HEADERS");
  });

  it("keeps header values out of VIDEO_EXTRA_HEADERS errors", () => {
    expect(() => loadConfig({ VIDEO_EXTRA_HEADERS: '{"X-Id":"top-secret\\n"}' })).toThrow(
      /^(?!.*top-secret)/s,
    );
  });

  it("rejects an allowed directory that does not exist", () => {
    expect(() => loadConfig({ VIDEO_ALLOWED_DIRS: join(tmpdir(), "vu-missing-dir-x") })).toThrow(
      "VIDEO_ALLOWED_DIRS",
    );
  });
});
