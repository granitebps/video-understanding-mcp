import { existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute } from "node:path";

export const PART_FORMATS = ["video_url", "image_url", "file", "input_file"] as const;
export type PartFormat = (typeof PART_FORMATS)[number];

export interface RuntimeConfig {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  extraHeaders: Record<string, string>;
  model: string | undefined;
  partFormat: PartFormat;
  maxDurationSeconds: number;
  maxUploadBytes: number;
  maxDownloadBytes: number;
  requestTimeoutMs: number;
  maxConcurrency: number;
  maxOutputTokens: number;
  verifyMedia: boolean;
  allowedDirs: string[];
  allowPrivateNetwork: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  ytDlpPath: string;
}

const MB = 1_000_000;

function readNonEmpty(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function invalid(name: string, raw: string, rule: string): Error {
  return new Error(`${name} must be ${rule}, got ${JSON.stringify(raw)}`);
}

function readNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
  integer: boolean,
): number {
  const raw = readNonEmpty(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  const rule = `${integer ? "an integer" : "a number"} from ${min} to ${max}`;
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw invalid(name, raw, rule);
  }
  if (value < min || value > max) throw invalid(name, raw, rule);
  return value;
}

function readBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = readNonEmpty(env, name);
  if (raw === undefined) return fallback;
  const lowered = raw.toLowerCase();
  if (lowered === "true") return true;
  if (lowered === "false") return false;
  throw invalid(name, raw, '"true" or "false"');
}

function readBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const raw = readNonEmpty(env, "VIDEO_BASE_URL");
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid("VIDEO_BASE_URL", raw, "an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalid("VIDEO_BASE_URL", raw, "an http(s) URL");
  }
  return raw.replace(/\/+$/, "");
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_HEADERS = new Set(["accept", "authorization", "content-type"]);

// Error messages name keys only: header values are usually credentials.
function readExtraHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const name = "VIDEO_EXTRA_HEADERS";
  const raw = readNonEmpty(env, name);
  if (raw === undefined) return {};
  const rule = "a JSON object of header names to string values";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be ${rule}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be ${rule}`);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!HEADER_NAME.test(key)) {
      throw new Error(`${name} has an invalid header name ${JSON.stringify(key)}`);
    }
    if (RESERVED_HEADERS.has(key.toLowerCase())) {
      throw new Error(`${name} cannot set ${JSON.stringify(key)}; it is set by the server`);
    }
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
      throw new Error(`${name} needs a single-line string value for ${JSON.stringify(key)}`);
    }
    headers[key] = value;
  }
  return headers;
}

function readPartFormat(env: NodeJS.ProcessEnv): PartFormat {
  const raw = readNonEmpty(env, "VIDEO_PART_FORMAT");
  if (raw === undefined) return "image_url";
  const match = PART_FORMATS.find((format) => format === raw);
  if (!match) throw invalid("VIDEO_PART_FORMAT", raw, `one of ${PART_FORMATS.join(", ")}`);
  return match;
}

function readAllowedDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = readNonEmpty(env, "VIDEO_ALLOWED_DIRS");
  if (raw === undefined) return [];
  return raw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (!isAbsolute(entry)) throw invalid("VIDEO_ALLOWED_DIRS", entry, "an absolute directory");
      if (!existsSync(entry) || !statSync(entry).isDirectory()) {
        throw invalid("VIDEO_ALLOWED_DIRS", entry, "an existing directory");
      }
      return realpathSync(entry);
    });
}

export function loadConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  return {
    baseUrl: readBaseUrl(env),
    apiKey: readNonEmpty(env, "VIDEO_API_KEY"),
    extraHeaders: readExtraHeaders(env),
    model: readNonEmpty(env, "VIDEO_MODEL"),
    partFormat: readPartFormat(env),
    maxDurationSeconds: readNumber(env, "VIDEO_MAX_DURATION_SECONDS", 300, 1, 7200, true),
    maxUploadBytes: readNumber(env, "VIDEO_MAX_UPLOAD_MB", 15, 1, 100, false) * MB,
    maxDownloadBytes: readNumber(env, "VIDEO_MAX_DOWNLOAD_MB", 500, 1, 10_000, false) * MB,
    requestTimeoutMs: readNumber(env, "VIDEO_REQUEST_TIMEOUT_MS", 180_000, 5_000, 900_000, true),
    maxConcurrency: readNumber(env, "VIDEO_MAX_CONCURRENCY", 2, 1, 16, true),
    maxOutputTokens: readNumber(env, "VIDEO_MAX_OUTPUT_TOKENS", 8192, 256, 65_536, true),
    verifyMedia: readBoolean(env, "VIDEO_VERIFY_MEDIA", true),
    allowedDirs: readAllowedDirs(env),
    allowPrivateNetwork: readBoolean(env, "VIDEO_ALLOW_PRIVATE_NETWORK", false),
    ffmpegPath: readNonEmpty(env, "VIDEO_FFMPEG_PATH") ?? "ffmpeg",
    ffprobePath: readNonEmpty(env, "VIDEO_FFPROBE_PATH") ?? "ffprobe",
    ytDlpPath: readNonEmpty(env, "VIDEO_YTDLP_PATH") ?? "yt-dlp",
  };
}
