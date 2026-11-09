import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { probeMedia, prepareVideo } from "../../src/media/ffmpeg.js";
import { makeFixtures } from "../fixtures/make-fixtures.js";
import { testConfig } from "../helpers/server.js";

const config = testConfig();
const signal = () => new AbortController().signal;

function workDir(): string {
  return mkdtempSync(join(tmpdir(), "vu-prepare-"));
}

function ffmpegRunning(): boolean {
  const result = spawnSync("pgrep", ["-f", "vu-prepare-"], { encoding: "utf8" });
  return result.stdout.trim().length > 0;
}

beforeAll(() => {
  makeFixtures();
}, 60_000);

describe("probeMedia", () => {
  it("reads duration and streams", async () => {
    const info = await probeMedia(config, makeFixtures().withAudio, signal());

    expect(info.durationSeconds).toBeCloseTo(20, 0);
    expect(info).toMatchObject({ hasVideo: true, hasAudio: true, height: 1080 });
  });

  it.each(["jpeg", "html"] as const)("rejects a %s as INVALID_MEDIA", async (kind) => {
    await expect(probeMedia(config, makeFixtures()[kind], signal())).rejects.toMatchObject({
      code: "INVALID_MEDIA",
    });
  });
});

describe("prepareVideo", () => {
  it("cuts the range, keeps audio, and scales to at most 480p", async () => {
    const prepared = await prepareVideo(
      config,
      makeFixtures().withAudio,
      workDir(),
      { start: 5, end: 15 },
      signal(),
    );
    const info = await probeMedia(config, prepared.path, signal());

    expect(prepared.bytes).toBeLessThanOrEqual(config.maxUploadBytes);
    expect(info.hasAudio).toBe(true);
    expect(info.height).toBeLessThanOrEqual(480);
    expect(Math.abs(info.durationSeconds - 10)).toBeLessThanOrEqual(0.5);
  });

  it("prepares a clip without audio", async () => {
    const prepared = await prepareVideo(
      config,
      makeFixtures().noAudio,
      workDir(),
      { start: 0, end: 6 },
      signal(),
    );

    expect((await probeMedia(config, prepared.path, signal())).hasAudio).toBe(false);
  });

  it("fails with LIMIT_EXCEEDED and the range hint when both attempts are too large", async () => {
    const tiny = { ...config, maxUploadBytes: 10_000 };

    await expect(
      prepareVideo(tiny, makeFixtures().withAudio, workDir(), { start: 0, end: 20 }, signal()),
    ).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
      safeMessage: expect.stringMatching(/over the 0\.01 MB upload limit.*start_seconds/) as string,
    });
  });

  it("kills ffmpeg when aborted", async () => {
    const controller = new AbortController();
    const dir = workDir();
    const pending = prepareVideo(
      config,
      makeFixtures().withAudio,
      dir,
      { start: 0, end: 20 },
      controller.signal,
    );
    setTimeout(() => controller.abort(new Error("cancelled")), 50);

    await expect(pending).rejects.toThrow("cancelled");
    expect(ffmpegRunning()).toBe(false);
    expect(readdirSync(dir).length).toBeLessThanOrEqual(1);
  });
});
