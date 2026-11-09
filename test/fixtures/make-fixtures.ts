import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Fixtures {
  dir: string;
  /** 720p, 20 s, test pattern with a sine tone. */
  withAudio: string;
  /** Same clip without an audio stream. */
  noAudio: string;
  jpeg: string;
  html: string;
  /** 720x1280 portrait clip, 4 s, with audio. */
  portrait: string;
  /** Local HLS playlist whose only segment is a local file. */
  playlist: string;
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
    "testsrc2=size=1280x720:rate=24:duration=20",
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

  const portrait = join(dir, "portrait.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=720x1280:rate=24:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-shortest",
    portrait,
  ]);
  const segment = join(dir, "segment.ts");
  ffmpeg(["-i", noAudio, "-c", "copy", "-f", "mpegts", segment]);
  const playlist = join(dir, "clip.m3u8");
  writeFileSync(
    playlist,
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nsegment.ts\n#EXT-X-ENDLIST\n",
  );

  cached = { dir, withAudio, noAudio, jpeg, html, portrait, playlist };
  return cached;
}
