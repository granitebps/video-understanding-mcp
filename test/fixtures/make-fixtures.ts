import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Fixtures {
  dir: string;
  /** 1080p, 20 s, test pattern with a sine tone. */
  withAudio: string;
  /** Same clip without an audio stream. */
  noAudio: string;
  jpeg: string;
  html: string;
}

let cached: Fixtures | undefined;

function ffmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg fixture generation failed: ${result.stderr}`);
}

/** Generates media fixtures with ffmpeg once per test process; no video is committed. */
export function makeFixtures(): Fixtures {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "video-understanding-fixtures-"));
  const withAudio = join(dir, "with-audio.mp4");
  const noAudio = join(dir, "no-audio.mp4");
  const jpeg = join(dir, "still.jpg");
  const html = join(dir, "page.mp4");

  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1920x1080:rate=24:duration=20",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=20",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-shortest",
    withAudio,
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24:duration=6",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    noAudio,
  ]);
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x240", "-frames:v", "1", jpeg]);
  writeFileSync(html, "<!doctype html><html><body>not a video</body></html>");

  cached = { dir, withAudio, noAudio, jpeg, html };
  return cached;
}
