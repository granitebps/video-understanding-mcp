import { redactSecrets, VideoError } from "../errors/video-error.js";
import { abortReason } from "../media/process.js";
import { parseChatResponse, type ParsedUsage } from "./response-parser.js";

export interface EndpointSettings {
  baseUrl: string;
  apiKey: string | undefined;
  extraHeaders: Record<string, string>;
  model: string;
  requestTimeoutMs: number;
}

export interface ChatReply {
  text: string;
  reportedModel: string | null;
  usage: ParsedUsage | null;
  finishReason: string | null;
}

export type ChatMessage = { role: "system" | "user"; content: unknown };

const REACHABILITY_TIMEOUT_MS = 5_000;
const ORIGIN_UNREACHABLE_STATUSES = new Set([502, 504, 521, 522, 523, 530]);
// Size phrases only: Google APIs say "Invalid JSON payload received" for unsupported fields.
const TOO_LARGE =
  /too large|size exceeds|exceeds the (?:maximum )?(?:request |payload )?(?:size|limit)|maximum (?:request|payload) size/i;
const MAX_ERROR_TEXT = 300;

function origin(baseUrl: string): string {
  const url = new URL(baseUrl);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.protocol}//${url.hostname}:${port}`;
}

function unreachable(baseUrl: string, cause?: unknown): VideoError {
  return new VideoError({
    code: "ENDPOINT_UNREACHABLE",
    safeMessage: `The configured base URL is not reachable: ${origin(baseUrl)}`,
    retryable: true,
    cause,
  });
}

function headers(settings: EndpointSettings): Record<string, string> {
  return {
    ...settings.extraHeaders,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
  };
}

function safeText(settings: EndpointSettings, text: string): string {
  const secrets = [
    ...(settings.apiKey ? [settings.apiKey] : []),
    ...Object.values(settings.extraHeaders),
  ];
  const redacted = redactSecrets(text, secrets);
  return redacted.length > MAX_ERROR_TEXT ? `${redacted.slice(0, MAX_ERROR_TEXT)}…` : redacted;
}

function errorText(body: string): string {
  const parsed = parseChatResponse(body);
  return parsed.error?.message ?? body.trim();
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** Confirms the base URL answers at all before any media work starts. */
export async function checkReachable(
  settings: EndpointSettings,
  signal: AbortSignal,
): Promise<void> {
  const timeout = AbortSignal.timeout(REACHABILITY_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}/models`, {
      method: "GET",
      headers: headers(settings),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    if (signal.aborted) throw abortReason(signal);
    throw unreachable(settings.baseUrl, error);
  }
  await response.body?.cancel();
  if (ORIGIN_UNREACHABLE_STATUSES.has(response.status)) throw unreachable(settings.baseUrl);
}

function classifyStatus(settings: EndpointSettings, response: Response, body: string): VideoError {
  const detail = safeText(settings, errorText(body));
  const message = `The endpoint returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`;
  if (response.status === 401 || response.status === 403) {
    return new VideoError({ code: "ENDPOINT_AUTH", safeMessage: message });
  }
  if (response.status === 429) {
    const retryAfter = retryAfterSeconds(response.headers.get("retry-after"));
    return new VideoError({
      code: "ENDPOINT_RATE_LIMITED",
      safeMessage: message,
      retryable: true,
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    });
  }
  if (response.status === 413 || TOO_LARGE.test(detail)) {
    return new VideoError({
      code: "LIMIT_EXCEEDED",
      safeMessage: `${message}. The endpoint rejected the request size; analyze a shorter range with start_seconds and end_seconds.`,
    });
  }
  return new VideoError({
    code: "ENDPOINT_ERROR",
    safeMessage: message,
    retryable: response.status >= 500,
  });
}

export async function sendChat(
  settings: EndpointSettings,
  messages: ChatMessage[],
  maxTokens: number,
  signal: AbortSignal,
  options: { allowEmpty?: boolean } = {},
): Promise<ChatReply> {
  const timeout = AbortSignal.timeout(settings.requestTimeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  let body: string;
  try {
    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify({
        model: settings.model,
        messages,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: combined,
    });
    body = await response.text();
  } catch (error) {
    if (signal.aborted) throw abortReason(signal);
    if (timeout.aborted) {
      throw new VideoError({
        code: "TIMEOUT",
        safeMessage: `The endpoint did not answer within ${settings.requestTimeoutMs} ms`,
        retryable: true,
        cause: error,
      });
    }
    throw unreachable(settings.baseUrl, error);
  }

  if (!response.ok) throw classifyStatus(settings, response, body);

  const parsed = parseChatResponse(body);
  if (parsed.error) {
    const detail = safeText(settings, parsed.error.message);
    if (TOO_LARGE.test(detail)) {
      throw new VideoError({
        code: "LIMIT_EXCEEDED",
        safeMessage: `The endpoint reported an error: ${detail}. Analyze a shorter range with start_seconds and end_seconds.`,
      });
    }
    throw new VideoError({
      code: "ENDPOINT_ERROR",
      safeMessage: `The endpoint reported an error: ${detail}`,
    });
  }
  if (!options.allowEmpty && !parsed.text.trim()) {
    throw new VideoError({
      code: "EMPTY_RESPONSE",
      safeMessage: "The endpoint returned an empty reply",
      retryable: true,
    });
  }

  return {
    text: parsed.text,
    reportedModel: parsed.model,
    usage: parsed.usage,
    finishReason: parsed.finishReason,
  };
}
