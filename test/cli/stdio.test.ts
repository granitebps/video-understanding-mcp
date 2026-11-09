import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

describe("stdio CLI", () => {
  it("starts without ffmpeg and serves MCP without exposing the key", async () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (typeof manifest.version !== "string") throw new Error("Package version is missing");

    const transportErrors: Error[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js"],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        VIDEO_BASE_URL: "http://127.0.0.1:9/v1",
        VIDEO_MODEL: "cli-test-model",
        VIDEO_API_KEY: "cli-secret-key-value",
        VIDEO_FFMPEG_PATH: "/nonexistent/ffmpeg",
        VIDEO_YTDLP_PATH: "/nonexistent/yt-dlp",
      },
      stderr: "pipe",
    });
    transport.onerror = (error) => transportErrors.push(error);
    const client = new Client({ name: "video-understanding-mcp-cli-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const info = await client.callTool({
        name: "get_server_info",
        arguments: {},
      });

      expect(client.getServerVersion()).toMatchObject({
        name: "video-understanding-mcp",
        version: manifest.version,
      });
      expect(listed.tools).toHaveLength(2);
      expect(info.structuredContent).toMatchObject({
        endpoint: { apiKeyConfigured: true },
        dependencies: { ffmpeg: { available: false } },
      });
      expect(JSON.stringify(info)).not.toContain("cli-secret-key-value");
      expect(transportErrors).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("exits with a message naming an invalid setting", () => {
    const result = spawnSync(process.execPath, ["dist/cli.js"], {
      cwd: process.cwd(),
      env: { ...getDefaultEnvironment(), VIDEO_MAX_DURATION_SECONDS: "ten" },
      encoding: "utf8",
      input: "",
      timeout: 20_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("VIDEO_MAX_DURATION_SECONDS");
    expect(result.stderr).toContain('"ten"');
  });
});
