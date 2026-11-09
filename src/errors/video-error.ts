export type VideoErrorCode =
  | "INVALID_INPUT"
  | "CONFIG_MISSING"
  | "DEPENDENCY_MISSING"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_NOT_ALLOWED"
  | "INVALID_MEDIA"
  | "LIMIT_EXCEEDED"
  | "ENDPOINT_UNREACHABLE"
  | "ENDPOINT_AUTH"
  | "ENDPOINT_RATE_LIMITED"
  | "ENDPOINT_ERROR"
  | "TIMEOUT"
  | "EMPTY_RESPONSE"
  | "MEDIA_NOT_PROCESSED"
  | "INTERNAL_ERROR";

export interface VideoErrorOptions {
  code: VideoErrorCode;
  safeMessage: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class VideoError extends Error {
  readonly code: VideoErrorCode;
  readonly safeMessage: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;

  constructor(options: VideoErrorOptions) {
    super(options.safeMessage, { cause: options.cause });
    this.name = "VideoError";
    this.code = options.code;
    this.safeMessage = options.safeMessage;
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bAuthorization:\s*(?:Bearer\s+)?[^\s,;"']+/gi, "Authorization: [REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]"],
  [/\bCookie:\s*[^\r\n"]+/gi, "Cookie: [REDACTED]"],
  [/\b(VIDEO_API_KEY)=([^\s,;]+)/gi, "$1=[REDACTED]"],
];

/** Removes credentials from text; `extraSecrets` covers values such as the configured API key. */
export function redactSecrets(value: string, extraSecrets: readonly string[] = []): string {
  let redacted = SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
  for (const secret of extraSecrets) {
    if (secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function toVideoError(error: unknown): VideoError {
  if (error instanceof VideoError) return error;
  return new VideoError({
    code: "INTERNAL_ERROR",
    safeMessage: "The video could not be analyzed because of an unexpected error",
    cause: error,
  });
}
