import { afterEach, describe, expect, it } from "vitest";

import { createUnderstand } from "../../src/analysis/understand.js";
import { Dependencies } from "../../src/media/dependencies.js";
import { ERROR_META_KEY } from "../../src/server/output.js";
import { connectServer, resultText, testConfig, type ConnectedServer } from "../helpers/server.js";

let connected: ConnectedServer | undefined;

afterEach(async () => {
  await connected?.close();
  connected = undefined;
});

describe("server tools", () => {
  it("lists exactly the two public tools", async () => {
    const config = testConfig();
    connected = await connectServer(config, createUnderstand(config, new Dependencies(config)));

    const { tools } = await connected.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["get_server_info", "understand_video"]);
  });

  it("reports configuration and dependencies without exposing the key", async () => {
    const config = testConfig({
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: "very-secret-api-key",
      model: "gemini-test",
      ffmpegPath: "/nonexistent/ffmpeg",
      ytDlpPath: "/nonexistent/yt-dlp",
    });
    connected = await connectServer(config, createUnderstand(config, new Dependencies(config)));

    const result = await connected.client.callTool({
      name: "get_server_info",
      arguments: {},
    });

    expect(result.structuredContent).toMatchObject({
      name: "video-understanding-mcp",
      endpoint: {
        host: "127.0.0.1:8000",
        model: "gemini-test",
        partFormat: "image_url",
        apiKeyConfigured: true,
      },
      localFiles: { enabled: false, allowedDirs: [] },
      dependencies: { ffmpeg: { available: false, version: null } },
    });
    expect(JSON.stringify(result)).not.toContain("very-secret-api-key");
  });

  it("returns CONFIG_MISSING with the code in text and metadata", async () => {
    const config = testConfig({ model: "gemini-test" });
    connected = await connectServer(config, createUnderstand(config, new Dependencies(config)));

    const result = await connected.client.callTool({
      name: "understand_video",
      arguments: { source: "https://example.com/video.mp4" },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/^\[CONFIG_MISSING\] VIDEO_BASE_URL/);
    expect(result._meta?.[ERROR_META_KEY]).toMatchObject({ code: "CONFIG_MISSING" });
    expect(result.structuredContent).toMatchObject({ error: { code: "CONFIG_MISSING" } });
  });

  it("returns DEPENDENCY_MISSING when ffmpeg cannot be started", async () => {
    const config = testConfig({
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "gemini-test",
      ffmpegPath: "/nonexistent/ffmpeg",
    });
    connected = await connectServer(config, createUnderstand(config, new Dependencies(config)));

    const result = await connected.client.callTool({
      name: "understand_video",
      arguments: { source: "https://example.com/video.mp4" },
    });

    expect(resultText(result)).toMatch(/^\[DEPENDENCY_MISSING\] ffmpeg/);
  });
});
