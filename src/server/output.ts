import type { CallToolResult } from "@modelcontextprotocol/server";

import { redactSecrets, toVideoError } from "../errors/video-error.js";

export const ERROR_META_KEY = "video-understanding-mcp/error";

function text(value: unknown): CallToolResult["content"] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

export function objectResult(value: Record<string, unknown>): CallToolResult {
  return { content: text(value), structuredContent: value };
}

export function errorResult(error: unknown, secrets: readonly string[] = []): CallToolResult {
  const mapped = toVideoError(error);
  const message = redactSecrets(mapped.safeMessage, secrets);
  const details = {
    code: mapped.code,
    message,
    retryable: mapped.retryable,
    ...(mapped.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: mapped.retryAfterSeconds }),
  };

  return {
    isError: true,
    content: [{ type: "text", text: `[${mapped.code}] ${message}` }],
    structuredContent: { error: details },
    _meta: { [ERROR_META_KEY]: details },
  };
}
