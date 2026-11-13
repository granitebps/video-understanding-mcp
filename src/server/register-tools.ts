import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { PART_FORMATS, type RuntimeConfig } from "../config/env.js";
import { UnderstandVideoResultSchema, type UnderstandVideoResult } from "../domain/schemas.js";
import type { Dependencies } from "../media/dependencies.js";
import { understandVideoInputSchema, type UnderstandVideoInput } from "./input.js";
import { errorResult, objectResult } from "./output.js";

export const SERVER_NAME = "video-understanding-mcp";
export const PUBLIC_TOOLS = ["understand_video", "get_server_info"] as const;

export type UnderstandFn = (
  input: UnderstandVideoInput,
  signal: AbortSignal,
) => Promise<UnderstandVideoResult>;

const dependencyStatusSchema = z.object({ available: z.boolean(), version: z.string().nullable() });

const serverInfoOutputSchema = z.object({
  name: z.string(),
  version: z.string(),
  tools: z.array(z.string()),
  endpoint: z.object({
    host: z.string().nullable(),
    model: z.string().nullable(),
    partFormat: z.enum(PART_FORMATS),
    apiKeyConfigured: z.boolean(),
  }),
  limits: z.object({
    maxDurationSeconds: z.number(),
    maxUploadBytes: z.number(),
    maxDownloadBytes: z.number(),
    requestTimeoutMs: z.number(),
    maxConcurrency: z.number(),
    maxOutputTokens: z.number(),
  }),
  verifyMedia: z.boolean(),
  localFiles: z.object({ enabled: z.boolean(), allowedDirs: z.array(z.string()) }),
  allowPrivateNetwork: z.boolean(),
  dependencies: z.object({
    ffmpeg: dependencyStatusSchema,
    ffprobe: dependencyStatusSchema,
    ytDlp: dependencyStatusSchema,
  }),
});

const UNDERSTAND_DESCRIPTION =
  "Watch a video and answer a question about it, using a video-capable model behind the configured OpenAI-compatible endpoint. " +
  "source accepts a page URL (TikTok, YouTube, X, Instagram, ... resolved with yt-dlp), a direct media URL with optional headers such as Referer from a scraper, or an absolute local path inside an allowed directory. " +
  "Returns answer, summary, speech (transcript in the original language), on_screen_text, a timeline in source-video seconds, and analysis metadata with warnings. " +
  `Videos longer than the duration limit need start_seconds/end_seconds; a short range also gives more detail for fast motion such as workouts. fps is a hint applied only when the request format supports it. ` +
  "Errors carry a code (e.g. ENDPOINT_UNREACHABLE, LIMIT_EXCEEDED, SOURCE_NOT_ALLOWED, MEDIA_NOT_PROCESSED) as a [CODE] text prefix and in _meta.";

function endpointHost(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  const url = new URL(baseUrl);
  return url.host;
}

export interface RegisterToolsOptions {
  config: RuntimeConfig;
  dependencies: Dependencies;
  understand: UnderstandFn;
  version: string;
}

export function registerTools(
  server: McpServer,
  { config, dependencies, understand, version }: RegisterToolsOptions,
): void {
  const secrets = [
    ...(config.apiKey ? [config.apiKey] : []),
    ...Object.values(config.extraHeaders),
  ];

  server.registerTool(
    "understand_video",
    {
      title: "Understand video",
      description: UNDERSTAND_DESCRIPTION,
      inputSchema: understandVideoInputSchema,
      outputSchema: UnderstandVideoResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, context: ServerContext): Promise<CallToolResult> => {
      try {
        return objectResult(await understand(input, context.mcpReq.signal));
      } catch (error) {
        return errorResult(error, secrets);
      }
    },
  );

  server.registerTool(
    "get_server_info",
    {
      title: "Get server info",
      description:
        "Show the server version, endpoint host and model, request format, limits, local-file policy, and whether ffmpeg and yt-dlp are available. Never shows the API key.",
      inputSchema: z.object({}),
      outputSchema: serverInfoOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (): Promise<CallToolResult> =>
      objectResult({
        name: SERVER_NAME,
        version,
        tools: [...PUBLIC_TOOLS],
        endpoint: {
          host: endpointHost(config.baseUrl),
          model: config.model ?? null,
          partFormat: config.partFormat,
          apiKeyConfigured: config.apiKey !== undefined,
        },
        limits: {
          maxDurationSeconds: config.maxDurationSeconds,
          maxUploadBytes: config.maxUploadBytes,
          maxDownloadBytes: config.maxDownloadBytes,
          requestTimeoutMs: config.requestTimeoutMs,
          maxConcurrency: config.maxConcurrency,
          maxOutputTokens: config.maxOutputTokens,
        },
        verifyMedia: config.verifyMedia,
        localFiles: { enabled: config.allowedDirs.length > 0, allowedDirs: config.allowedDirs },
        allowPrivateNetwork: config.allowPrivateNetwork,
        dependencies: await dependencies.report(),
      }),
  );
}
