export interface ParsedUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface ParsedChatResponse {
  text: string;
  model: string | null;
  usage: ParsedUsage | null;
  finishReason: string | null;
  error: { message: string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Splits concatenated JSON values in one string, skipping anything between them. */
export function decodeJsonValues(line: string): unknown[] {
  const values: unknown[] = [];
  let index = 0;
  while (index < line.length) {
    const start = line.slice(index).search(/[{[]/);
    if (start === -1) break;
    const begin = index + start;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let cursor = begin; cursor < line.length; cursor += 1) {
      const char = line[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{" || char === "[") depth += 1;
      else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }
    if (end === -1) break;
    try {
      values.push(JSON.parse(line.slice(begin, end + 1)));
    } catch {
      // Not JSON after all; continue scanning after this candidate.
    }
    index = end + 1;
  }
  return values;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" && (part.type ?? "text") === "text"
        ? part.text
        : "",
    )
    .join("");
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readUsage(value: unknown): ParsedUsage | null {
  if (!isRecord(value)) return null;
  const promptTokens = numberOrNull(value.prompt_tokens ?? value.input_tokens);
  const completionTokens = numberOrNull(value.completion_tokens ?? value.output_tokens);
  if (promptTokens === null && completionTokens === null) return null;
  return { promptTokens, completionTokens };
}

function readError(value: unknown): { message: string } | null {
  if (typeof value === "string") return { message: value };
  if (!isRecord(value)) return null;
  const message = typeof value.message === "string" ? value.message : JSON.stringify(value);
  return { message };
}

/**
 * Reads a chat completion reply from a plain JSON body, a server-sent event stream,
 * or a JSON body followed by stream markers such as `data: [DONE]`.
 */
export function parseChatResponse(body: string): ParsedChatResponse {
  const result: ParsedChatResponse = {
    text: "",
    model: null,
    usage: null,
    finishReason: null,
    error: null,
  };

  const cleaned = body.replaceAll("data: [DONE]", "\n");
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^data:\s*/, "");
    if (!line || line === "[DONE]" || line.startsWith("event:") || line.startsWith(":")) continue;

    for (const chunk of decodeJsonValues(line)) {
      if (!isRecord(chunk)) continue;
      if (chunk.error !== undefined && chunk.error !== null) result.error = readError(chunk.error);
      if (typeof chunk.model === "string") result.model = chunk.model;
      result.usage = readUsage(chunk.usage) ?? result.usage;
      if (!Array.isArray(chunk.choices)) continue;
      for (const choice of chunk.choices) {
        if (!isRecord(choice)) continue;
        const message = isRecord(choice.message) ? choice.message : undefined;
        const delta = isRecord(choice.delta) ? choice.delta : undefined;
        result.text += contentText((message ?? delta)?.content);
        if (typeof choice.finish_reason === "string") result.finishReason = choice.finish_reason;
      }
    }
  }

  return result;
}
