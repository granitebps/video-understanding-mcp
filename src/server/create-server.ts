import { McpServer } from "@modelcontextprotocol/server";

import { registerTools, SERVER_NAME, type RegisterToolsOptions } from "./register-tools.js";

export type CreateServerOptions = RegisterToolsOptions;

export function createVideoServer(options: CreateServerOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: options.version },
    {
      instructions:
        "Use understand_video to watch a video and answer questions about it. Pass a page URL, a direct media URL (with headers such as Referer when a scraper returned them), or an allowed local path. For long videos or fast motion, pass start_seconds and end_seconds. Call get_server_info to see limits and whether ffmpeg and yt-dlp are installed.",
    },
  );
  registerTools(server, options);
  return server;
}
