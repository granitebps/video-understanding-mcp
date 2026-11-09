import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent } from "undici";

import type { RuntimeConfig } from "../config/env.js";
import type { UnderstandVideoResult, Warning } from "../domain/schemas.js";
import {
  checkReachable,
  sendChat,
  type ChatMessage,
  type EndpointSettings,
} from "../endpoint/client.js";
import { verifyMediaProcessed } from "../endpoint/media-check.js";
import { buildUserText, SYSTEM_PROMPT } from "../endpoint/prompt.js";
import { buildMediaPart, SUPPORTS_FPS } from "../endpoint/request-shapes.js";
import { toVideoError, VideoError } from "../errors/video-error.js";
import { acquireSource, type AcquiredSource } from "../media/acquire.js";
import type { Dependencies } from "../media/dependencies.js";
import { prepareVideo, probeMedia, type ClipRange } from "../media/ffmpeg.js";
import { createGuardedAgent, type Resolver } from "../media/network-guard.js";
import type { UnderstandVideoInput } from "../server/input.js";
import type { UnderstandFn } from "../server/register-tools.js";
import { parseReply, placeTimeline } from "./normalize.js";
import { Semaphore } from "./semaphore.js";

const BASELINE_MAX_TOKENS = 16;
export const TEMP_PREFIX = "video-understanding-mcp-work-";

export type LogEvent = Record<string, string | number | boolean | null>;
export type Logger = (event: LogEvent) => void;

const stderrLogger: Logger = (event) => {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
};

export interface ReadyEndpoint {
  baseUrl: string;
  model: string;
}

export function requireEndpoint(config: RuntimeConfig): ReadyEndpoint {
  const missing = [!config.baseUrl && "VIDEO_BASE_URL", !config.model && "VIDEO_MODEL"].filter(
    (name): name is string => typeof name === "string",
  );
  if (missing.length > 0 || !config.baseUrl || !config.model) {
    throw new VideoError({
      code: "CONFIG_MISSING",
      safeMessage: `${missing.join(" and ")} must be set to analyze videos`,
    });
  }
  return { baseUrl: config.baseUrl, model: config.model };
}

function invalidInput(message: string): VideoError {
  return new VideoError({ code: "INVALID_INPUT", safeMessage: message });
}

function validateRangeInput(input: UnderstandVideoInput): void {
  const { start_seconds: start, end_seconds: end } = input;
  if (start !== undefined && end !== undefined && start >= end) {
    throw invalidInput("start_seconds must be less than end_seconds");
  }
}

function overLimit(span: number, limit: number): VideoError {
  return new VideoError({
    code: "LIMIT_EXCEEDED",
    safeMessage:
      `The analyzed range is ${Math.round(span)} s, over the ${limit} s limit (VIDEO_MAX_DURATION_SECONDS). ` +
      `Pass start_seconds and end_seconds covering at most ${limit} s.`,
  });
}

/** Resolves the analyzed range against the source duration, clamping an end past the video. */
export function resolveRange(
  input: UnderstandVideoInput,
  durationSeconds: number,
  maxDurationSeconds: number,
): { range: ClipRange; warnings: Warning[] } {
  const start = input.start_seconds ?? 0;
  if (start >= durationSeconds) {
    throw invalidInput(
      `start_seconds (${start}) is not before the end of the ${durationSeconds.toFixed(1)} s video`,
    );
  }
  const warnings: Warning[] = [];
  let end = input.end_seconds ?? durationSeconds;
  if (end > durationSeconds) {
    if (input.end_seconds !== undefined) {
      warnings.push({
        code: "RANGE_CLAMPED",
        message: `end_seconds was past the end of the video and was clamped to ${durationSeconds.toFixed(1)} s`,
      });
    }
    end = durationSeconds;
  }
  if (end - start > maxDurationSeconds) throw overLimit(end - start, maxDurationSeconds);
  return { range: { start, end }, warnings };
}

export interface UnderstandOptions {
  logger?: Logger;
  /** DNS resolver for downloads; tests inject one. */
  resolver?: Resolver;
}

interface CallState {
  acquired?: AcquiredSource;
  sourceDuration?: number;
  bytes?: number;
  promptTokens?: number | null;
}

export function createUnderstand(
  config: RuntimeConfig,
  dependencies: Dependencies,
  options: UnderstandOptions = {},
): UnderstandFn {
  const log = options.logger ?? stderrLogger;
  const semaphore = new Semaphore(config.maxConcurrency);
  const agent: Agent = createGuardedAgent({
    allowPrivateNetwork: config.allowPrivateNetwork,
    ...(options.resolver ? { resolver: options.resolver } : {}),
  });

  return async (input, signal) => {
    const started = Date.now();
    const state: CallState = {};
    let code = "OK";
    try {
      return await run(input, signal, state);
    } catch (error) {
      code = signal.aborted ? "CANCELLED" : toVideoError(error).code;
      throw error;
    } finally {
      log({
        event: "understand_video",
        code,
        sourceKind: state.acquired?.kind ?? null,
        sourceHost: state.acquired?.host ?? null,
        durationS: state.sourceDuration ?? null,
        bytes: state.bytes ?? null,
        promptTokens: state.promptTokens ?? null,
        ms: Date.now() - started,
      });
    }
  };

  async function run(
    input: UnderstandVideoInput,
    signal: AbortSignal,
    state: CallState,
  ): Promise<UnderstandVideoResult> {
    validateRangeInput(input);
    const endpoint = requireEndpoint(config);
    await dependencies.requireFfmpeg();
    const settings: EndpointSettings = {
      baseUrl: endpoint.baseUrl,
      apiKey: config.apiKey,
      model: endpoint.model,
      requestTimeoutMs: config.requestTimeoutMs,
    };

    const release = await semaphore.acquire(signal);
    let workDir: string | undefined;
    try {
      await checkReachable(settings, signal);
      workDir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));

      state.acquired = await acquireSource({
        source: input.source,
        headers: input.headers,
        config,
        dependencies,
        agent,
        workDir,
        signal,
        checkDuration: (seconds) => {
          resolveRange(input, seconds, config.maxDurationSeconds);
        },
      });

      const info = await probeMedia(config, state.acquired.path, signal);
      state.sourceDuration = Math.round(info.durationSeconds * 10) / 10;
      const { range, warnings } = resolveRange(
        input,
        info.durationSeconds,
        config.maxDurationSeconds,
      );
      const prepared = await prepareVideo(config, state.acquired.path, workDir, range, signal);
      state.bytes = prepared.bytes;
      const clipSeconds = range.end - range.start;

      if (input.fps !== undefined && !SUPPORTS_FPS[config.partFormat]) {
        warnings.push({
          code: "FPS_NOT_APPLIED",
          message: `The "${config.partFormat}" request format has no frame-rate field, so fps was not applied`,
        });
      }

      const dataUrl = `data:video/mp4;base64,${(await readFile(prepared.path)).toString("base64")}`;
      const userText = {
        type: "text",
        text: buildUserText({ question: input.question, clipSeconds }),
      };
      const system: ChatMessage = { role: "system", content: SYSTEM_PROMPT };
      const mainMessages: ChatMessage[] = [
        system,
        {
          role: "user",
          content: [userText, buildMediaPart(config.partFormat, dataUrl, input.fps)],
        },
      ];

      const baselineAbort = new AbortController();
      const baseline = config.verifyMedia
        ? sendChat(
            settings,
            [system, { role: "user", content: [userText] }],
            BASELINE_MAX_TOKENS,
            AbortSignal.any([signal, baselineAbort.signal]),
            { allowEmpty: true },
          ).then(
            (reply) => reply.usage?.promptTokens ?? null,
            () => null,
          )
        : Promise.resolve(null);

      let reply;
      try {
        reply = await sendChat(settings, mainMessages, config.maxOutputTokens, signal);
      } catch (error) {
        baselineAbort.abort();
        throw error;
      }
      state.promptTokens = reply.usage?.promptTokens ?? null;

      if (config.verifyMedia) {
        const warning = verifyMediaProcessed({
          mainPromptTokens: state.promptTokens,
          baselinePromptTokens: await baseline,
          clipSeconds,
          partFormat: config.partFormat,
          ...(input.fps !== undefined && SUPPORTS_FPS[config.partFormat]
            ? { appliedFps: input.fps }
            : {}),
        });
        if (warning) warnings.push(warning);
      } else {
        warnings.push({
          code: "MEDIA_UNVERIFIED",
          message: "Video processing was not verified because VIDEO_VERIFY_MEDIA is false",
        });
      }

      if (reply.finishReason === "length") {
        warnings.push({
          code: "TRUNCATED",
          message:
            "The reply hit the output-token limit and may be incomplete; raise VIDEO_MAX_OUTPUT_TOKENS or analyze a shorter range",
        });
      }

      const parsed = parseReply(reply.text);
      const placed = placeTimeline(parsed.fields.timeline, range);
      return {
        ...parsed.fields,
        timeline: placed.timeline,
        analysis: {
          configuredModel: endpoint.model,
          reportedModel: reply.reportedModel,
          usage: reply.usage,
          sourceDurationSeconds: state.sourceDuration,
          analyzedRange: {
            start: Math.round(range.start * 10) / 10,
            end: Math.round(range.end * 10) / 10,
          },
          partFormat: config.partFormat,
          warnings: [...warnings, ...parsed.warnings, ...placed.warnings],
        },
      };
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true });
      release();
    }
  }
}
