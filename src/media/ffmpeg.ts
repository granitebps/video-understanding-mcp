import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { RuntimeConfig } from "../config/env.js";
import { VideoError } from "../errors/video-error.js";
import { runProcess } from "./process.js";

const PROBE_TIMEOUT_MS = 60_000;
const ENCODE_TIMEOUT_MS = 300_000;

export interface MediaInfo {
  durationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
}

export interface ClipRange {
  start: number;
  end: number;
}

export interface PreparedVideo {
  path: string;
  bytes: number;
  attempt: number;
}

interface EncodeAttempt {
  /** Upper bound for the shorter side, so portrait clips keep the same detail as landscape. */
  shortSide: number;
  crf: number;
  audioBitrate: string;
}

/** Inputs are read as local files only, so containers cannot pull in network or other resources. */
const INPUT_PROTOCOLS = ["-protocol_whitelist", "file"];
/** Playlist and concatenation formats reference other files; images are not video. */
const REJECTED_FORMATS = /(^|,)(hls|applehttp|concat|ffconcat|image2|[a-z0-9]+_pipe)(,|$)/;

const LADDER: readonly EncodeAttempt[] = [
  { shortSide: 480, crf: 30, audioBitrate: "64k" },
  { shortSide: 360, crf: 34, audioBitrate: "48k" },
];

function invalidMedia(reason: string): VideoError {
  return new VideoError({
    code: "INVALID_MEDIA",
    safeMessage: `The source is not a usable video: ${reason}`,
  });
}

interface ProbeOutput {
  format?: { duration?: string; format_name?: string };
  streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
}

export async function probeMedia(
  config: RuntimeConfig,
  path: string,
  signal: AbortSignal,
): Promise<MediaInfo> {
  const result = await runProcess(
    config.ffprobePath,
    [
      ...INPUT_PROTOCOLS,
      "-v",
      "error",
      "-show_entries",
      "format=duration,format_name:stream=codec_type,width,height,duration",
      "-of",
      "json",
      path,
    ],
    { signal, timeoutMs: PROBE_TIMEOUT_MS, maxStdoutBytes: 1024 * 1024 },
  );
  if (result.exitCode !== 0) throw invalidMedia("ffprobe could not read it");

  let parsed: ProbeOutput;
  try {
    parsed = JSON.parse(result.stdout) as ProbeOutput;
  } catch {
    throw invalidMedia("ffprobe returned unreadable output");
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const hasAudio = streams.some((stream) => stream.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? video?.duration);
  const rejectedFormat = REJECTED_FORMATS.test(parsed.format?.format_name ?? "");
  if (!video || rejectedFormat || !Number.isFinite(duration) || duration <= 0) {
    throw invalidMedia("no video stream");
  }

  return {
    durationSeconds: duration,
    hasVideo: true,
    hasAudio,
    width: video.width ?? null,
    height: video.height ?? null,
  };
}

function scaleFilter(shortSide: number): string {
  const even = (expr: string) => `trunc(${expr}/2)*2`;
  const width = `if(gte(iw,ih),-2,${even(`min(${shortSide},iw)`)})`;
  const height = `if(gte(iw,ih),${even(`min(${shortSide},ih)`)},-2)`;
  return `scale='${width}':'${height}'`;
}

function encodeArgs(
  source: string,
  output: string,
  range: ClipRange,
  attempt: EncodeAttempt,
): string[] {
  return [
    "-y",
    "-v",
    "error",
    "-ss",
    range.start.toFixed(3),
    "-t",
    (range.end - range.start).toFixed(3),
    ...INPUT_PROTOCOLS,
    "-i",
    source,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    scaleFilter(attempt.shortSide),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(attempt.crf),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    attempt.audioBitrate,
    "-ac",
    "1",
    "-movflags",
    "+faststart",
    output,
  ];
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

/** Re-encodes the requested range small enough to send inline, keeping the audio track. */
export async function prepareVideo(
  config: RuntimeConfig,
  source: string,
  workDir: string,
  range: ClipRange,
  signal: AbortSignal,
): Promise<PreparedVideo> {
  let lastBytes = 0;
  for (const [index, attempt] of LADDER.entries()) {
    const output = join(workDir, `prepared-${index + 1}.mp4`);
    const result = await runProcess(config.ffmpegPath, encodeArgs(source, output, range, attempt), {
      signal,
      timeoutMs: ENCODE_TIMEOUT_MS,
    });
    if (result.timedOut) {
      throw new VideoError({
        code: "TIMEOUT",
        safeMessage: "Preparing the video took longer than 5 minutes; analyze a shorter range",
      });
    }
    if (result.exitCode !== 0) throw invalidMedia("ffmpeg could not re-encode it");

    lastBytes = (await stat(output)).size;
    if (lastBytes <= config.maxUploadBytes) {
      return { path: output, bytes: lastBytes, attempt: index + 1 };
    }
  }

  throw new VideoError({
    code: "LIMIT_EXCEEDED",
    safeMessage:
      `The prepared video is ${megabytes(lastBytes)}, over the ${megabytes(config.maxUploadBytes)} upload limit. ` +
      "Pass a shorter start_seconds/end_seconds range.",
  });
}
