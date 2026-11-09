import { open, rm } from "node:fs/promises";
import { join } from "node:path";

import { fetch, type Agent, type Response } from "undici";

import { VideoError } from "../errors/video-error.js";
import { abortReason } from "./process.js";
import { assertUrlAllowed, findBlocked, notAllowed } from "./network-guard.js";

const MAX_REDIRECTS = 5;
const TOTAL_TIMEOUT_MS = 600_000;
const STALL_TIMEOUT_MS = 60_000;
const MEDIA_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv)$/i;
const MEDIA_TYPES = /^(video\/|application\/octet-stream|binary\/octet-stream)/i;
const DEFAULT_HEADERS = { "user-agent": "video-understanding-mcp", accept: "*/*" };

export type FetchedSource =
  { kind: "media"; path: string; bytes: number; finalUrl: URL } | { kind: "page"; url: URL };

export interface FetchSourceOptions {
  agent: Agent;
  allowPrivateNetwork: boolean;
  headers: Record<string, string> | undefined;
  maxBytes: number;
  workDir: string;
  signal: AbortSignal;
  stallTimeoutMs?: number;
}

function unavailable(message: string, cause?: unknown): VideoError {
  return new VideoError({ code: "SOURCE_UNAVAILABLE", safeMessage: message, cause });
}

function tooLarge(maxBytes: number): VideoError {
  return new VideoError({
    code: "LIMIT_EXCEEDED",
    safeMessage: `The source is larger than the ${(maxBytes / 1_000_000).toFixed(0)} MB download limit (VIDEO_MAX_DOWNLOAD_MB)`,
  });
}

function isMedia(response: Response, url: URL): boolean {
  const type = response.headers.get("content-type") ?? "";
  return (
    MEDIA_TYPES.test(type) || (!type.startsWith("text/") && MEDIA_EXTENSIONS.test(url.pathname))
  );
}

async function request(
  url: URL,
  headers: Record<string, string>,
  options: FetchSourceOptions,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, { headers, redirect: "manual", dispatcher: options.agent, signal });
  } catch (error) {
    if (options.signal.aborted) throw abortReason(options.signal);
    if (findBlocked(error)) throw notAllowed(url.host);
    if (signal.aborted) throw unavailable(`Timed out downloading from ${url.host}`, error);
    throw unavailable(`Could not connect to ${url.host}`, error);
  }
}

/** Follows redirects manually so every hop is re-checked and caller headers stay on the original host. */
async function follow(
  source: URL,
  options: FetchSourceOptions,
  signal: AbortSignal,
): Promise<{ response: Response; url: URL }> {
  let url = source;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertUrlAllowed(url, options.allowPrivateNetwork);
    const sameHost = url.host === source.host;
    const headers = { ...DEFAULT_HEADERS, ...(sameHost ? options.headers : {}) };
    const response = await request(url, headers, options, signal);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return { response, url };
  }
  throw unavailable(`Too many redirects from ${source.host}`);
}

async function saveBody(
  response: Response,
  path: string,
  options: FetchSourceOptions,
  stall: { reset: () => void },
): Promise<number> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body?.cancel();
    throw tooLarge(options.maxBytes);
  }

  const file = await open(path, "w");
  let bytes = 0;
  try {
    if (response.body) {
      for await (const chunk of response.body) {
        const buffer = chunk as Uint8Array;
        bytes += buffer.byteLength;
        if (bytes > options.maxBytes) {
          await response.body.cancel().catch(() => undefined);
          throw tooLarge(options.maxBytes);
        }
        stall.reset();
        await file.write(buffer);
      }
    }
  } catch (error) {
    await file.close();
    await rm(path, { force: true });
    throw error;
  }
  await file.close();
  return bytes;
}

/**
 * Fetches an http(s) source: saves it when the response is media, or reports it as a page
 * for yt-dlp. Non-public targets are refused unless allowed by configuration.
 */
export async function fetchSource(
  rawUrl: string,
  options: FetchSourceOptions,
): Promise<FetchedSource> {
  const source = new URL(rawUrl);
  const timeout = new AbortController();
  const total = setTimeout(() => timeout.abort(new Error("download timeout")), TOTAL_TIMEOUT_MS);
  let stallTimer: NodeJS.Timeout | undefined;
  const stall = {
    reset: () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(
        () => timeout.abort(new Error("download stalled")),
        options.stallTimeoutMs ?? STALL_TIMEOUT_MS,
      );
    },
  };
  const signal = AbortSignal.any([options.signal, timeout.signal]);

  try {
    stall.reset();
    const { response, url } = await follow(source, options, signal);
    if (!response.ok) {
      await response.body?.cancel();
      throw unavailable(
        `The media host ${url.host} answered HTTP ${response.status}; the URL may have expired or need headers such as Referer`,
      );
    }
    if (!isMedia(response, url)) {
      await response.body?.cancel();
      return { kind: "page", url };
    }
    const path = join(options.workDir, "source-download");
    try {
      const bytes = await saveBody(response, path, options, stall);
      return { kind: "media", path, bytes, finalUrl: url };
    } catch (error) {
      if (error instanceof VideoError) throw error;
      if (options.signal.aborted) throw abortReason(options.signal);
      throw unavailable(`The download from ${url.host} was interrupted or stalled`, error);
    }
  } finally {
    clearTimeout(total);
    clearTimeout(stallTimer);
  }
}
