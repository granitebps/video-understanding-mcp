import { readdir } from "node:fs/promises";
import { join, sep } from "node:path";

import type { RuntimeConfig } from "../config/env.js";
import { VideoError } from "../errors/video-error.js";
import { runProcess } from "./process.js";

const METADATA_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const FORMAT = "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b";

function extractionError(stderr: string): VideoError {
  const lines = stderr.split(/\r?\n/).filter((line) => line.startsWith("ERROR:"));
  const reason = (lines.at(-1) ?? "yt-dlp could not extract a video").replace(/^ERROR:\s*/, "");
  return new VideoError({
    code: "SOURCE_UNAVAILABLE",
    safeMessage: `Could not get a video from this page: ${reason.slice(0, 300)}`,
  });
}

function timedOut(step: string): VideoError {
  return new VideoError({ code: "TIMEOUT", safeMessage: `yt-dlp timed out while ${step}` });
}

/** Reads the video duration before downloading so over-long videos fail fast. */
export async function ytDlpDuration(
  config: RuntimeConfig,
  url: string,
  signal: AbortSignal,
): Promise<number | null> {
  const result = await runProcess(config.ytDlpPath, ["-J", "--no-playlist", "--no-warnings", url], {
    signal,
    timeoutMs: METADATA_TIMEOUT_MS,
    maxStdoutBytes: 16 * 1024 * 1024,
  });
  if (result.timedOut) throw timedOut("reading video details");
  if (result.exitCode !== 0) throw extractionError(result.stderr);
  try {
    const info = JSON.parse(result.stdout) as { duration?: unknown };
    return typeof info.duration === "number" && info.duration > 0 ? info.duration : null;
  } catch {
    return null;
  }
}

export async function ytDlpDownload(
  config: RuntimeConfig,
  url: string,
  workDir: string,
  signal: AbortSignal,
): Promise<string> {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "-f",
    FORMAT,
    "--merge-output-format",
    "mp4",
    "--max-filesize",
    String(Math.floor(config.maxDownloadBytes)),
    "-o",
    join(workDir, "source.%(ext)s"),
  ];
  if (config.ffmpegPath.includes(sep) || config.ffmpegPath.includes("/")) {
    args.push("--ffmpeg-location", config.ffmpegPath);
  }
  args.push(url);

  const result = await runProcess(config.ytDlpPath, args, {
    signal,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  });
  if (result.timedOut) throw timedOut("downloading the video");
  if (result.exitCode !== 0) throw extractionError(result.stderr);

  const file = (await readdir(workDir)).find(
    (name) => name.startsWith("source.") && !name.endsWith(".part") && !name.endsWith(".ytdl"),
  );
  if (!file) {
    throw new VideoError({
      code: "LIMIT_EXCEEDED",
      safeMessage: `yt-dlp did not download the video; it is probably larger than the ${(config.maxDownloadBytes / 1_000_000).toFixed(0)} MB download limit (VIDEO_MAX_DOWNLOAD_MB)`,
    });
  }
  return join(workDir, file);
}
