import { spawnSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createUnderstand, TEMP_PREFIX, type LogEvent } from "../../src/analysis/understand.js";
import type { RuntimeConfig } from "../../src/config/env.js";
import { Dependencies } from "../../src/media/dependencies.js";
import { makeFixtures } from "../fixtures/make-fixtures.js";
import {
  chatBody,
  startFakeEndpoint,
  type FakeEndpoint,
  type RecordedRequest,
  type ScriptedResponse,
} from "../helpers/fake-endpoint.js";
import { connectServer, resultText, testConfig, type ConnectedServer } from "../helpers/server.js";

const REPLY = {
  answer: "A moving test pattern with a steady tone.",
  summary: "Colour bars animate while a tone plays.",
  speech: { present: false, language: null, transcript: "" },
  on_screen_text: ["00:00:05"],
  timeline: [
    { start: 3, description: "counter visible" },
    { start: 42, description: "made-up moment" },
  ],
};

let endpoint: FakeEndpoint;
let connected: ConnectedServer | undefined;
let logs: LogEvent[];

function isMainRequest(request: RecordedRequest): boolean {
  const json = request.json as { messages?: Array<{ content?: unknown }> } | null;
  const content = json?.messages?.[1]?.content;
  return Array.isArray(content) && content.length === 2;
}

function respond(main: ScriptedResponse, baselineTokens = 1000): void {
  endpoint.responder = (request) =>
    isMainRequest(request)
      ? main
      : { body: chatBody("", { usage: { prompt_tokens: baselineTokens, completion_tokens: 1 } }) };
}

function mainReply(content: string, promptTokens = 3433, extra: Record<string, unknown> = {}) {
  return {
    body: `${JSON.stringify(chatBody(content, { model: "upstream-gemini", usage: { prompt_tokens: promptTokens, completion_tokens: 200 }, ...extra }))}data: [DONE]\n\n`,
  };
}

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return testConfig({
    baseUrl: endpoint.baseUrl,
    apiKey: "sk-e2e-secret",
    model: "configured-model",
    allowedDirs: [realpathSync(dirname(makeFixtures().withAudio))],
    ...overrides,
  });
}

async function connect(cfg: RuntimeConfig): Promise<ConnectedServer> {
  connected = await connectServer(
    cfg,
    createUnderstand(cfg, new Dependencies(cfg), { logger: (event) => logs.push(event) }),
  );
  return connected;
}

async function call(args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
  if (!connected) throw new Error("not connected");
  return await connected.client.callTool(
    { name: "understand_video", arguments: { source: makeFixtures().withAudio, ...args } },
    signal ? { signal } : undefined,
  );
}

function tempDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX));
}

async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${address.port}/v1`;
}

beforeEach(async () => {
  logs = [];
  endpoint = await startFakeEndpoint();
});

afterEach(async () => {
  await connected?.close();
  connected = undefined;
  await endpoint.close();
});

beforeAll(() => {
  makeFixtures();
}, 60_000);

describe("understand_video end to end", () => {
  it("returns the structured result with analysis metadata and source-time timeline", async () => {
    respond(mainReply("```json\n" + JSON.stringify(REPLY) + "\n```"));
    await connect(config());

    const result = await call({ question: "What is shown?", start_seconds: 5, end_seconds: 15 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      answer: REPLY.answer,
      summary: REPLY.summary,
      speech: REPLY.speech,
      on_screen_text: ["00:00:05"],
      timeline: [{ start: 8, description: "counter visible" }],
      analysis: {
        configuredModel: "configured-model",
        reportedModel: "upstream-gemini",
        usage: { promptTokens: 3433, completionTokens: 200 },
        analyzedRange: { start: 5, end: 15 },
        partFormat: "image_url",
        warnings: [expect.objectContaining({ code: "TIMELINE_ENTRIES_REMOVED" })],
      },
    });

    const main = endpoint.requests.find(isMainRequest);
    const body = main?.json as { model: string; messages: Array<{ content: unknown }> };
    expect(body.model).toBe("configured-model");
    expect(JSON.stringify(body.messages[1]?.content)).toContain('"type":"image_url"');
    expect(JSON.stringify(body.messages[1]?.content)).toContain("data:video/mp4;base64,");
    expect(tempDirs()).toEqual([]);
  });

  it("returns prose as the answer with a warning", async () => {
    respond(mainReply("It is a colourful test card."));
    await connect(config());

    const result = await call({});

    expect(result.structuredContent).toMatchObject({
      answer: "It is a colourful test card.",
      analysis: { warnings: [expect.objectContaining({ code: "STRUCTURED_FIELDS_UNAVAILABLE" })] },
    });
  });

  it("fails with MEDIA_NOT_PROCESSED when the video adds no prompt tokens", async () => {
    respond(mainReply(JSON.stringify(REPLY), 2074), 2074);
    await connect(config());

    const result = await call({});

    expect(resultText(result)).toMatch(/^\[MEDIA_NOT_PROCESSED\]/);
  });

  it("reports a truncated reply and unapplied fps", async () => {
    respond(
      mainReply(JSON.stringify(REPLY), 3433, {
        choices: [{ message: { content: JSON.stringify(REPLY) }, finish_reason: "length" }],
      }),
    );
    await connect(config({ partFormat: "image_url" }));

    const result = await call({ fps: 4 });
    const codes = (
      result.structuredContent as { analysis: { warnings: Array<{ code: string }> } }
    ).analysis.warnings.map((warning) => warning.code);

    expect(codes).toEqual(expect.arrayContaining(["TRUNCATED", "FPS_NOT_APPLIED"]));
  });

  it("stops before any media work when the base URL is unreachable", async () => {
    await connect(config({ baseUrl: await closedPortUrl() }));

    const result = await call({});

    expect(resultText(result)).toMatch(
      /^\[ENDPOINT_UNREACHABLE\] The configured base URL is not reachable/,
    );
    expect(tempDirs()).toEqual([]);
    expect(logs.at(-1)).toMatchObject({ code: "ENDPOINT_UNREACHABLE", sourceKind: null });
  });

  it("rejects an inverted range and clamps an end past the video", async () => {
    respond(mainReply(JSON.stringify(REPLY)));
    await connect(config());

    const inverted = await call({ start_seconds: 90, end_seconds: 60 });
    const clamped = await call({ start_seconds: 10, end_seconds: 100 });

    expect(resultText(inverted)).toMatch(/^\[INVALID_INPUT\]/);
    expect(clamped.structuredContent).toMatchObject({
      analysis: {
        analyzedRange: { start: 10, end: 20 },
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: "RANGE_CLAMPED" }),
        ]) as unknown[],
      },
    });
  });

  it("refuses a range longer than the duration limit", async () => {
    await connect(config({ maxDurationSeconds: 5 }));

    const result = await call({});

    expect(resultText(result)).toMatch(
      /^\[LIMIT_EXCEEDED\] The analyzed range is 20 s, over the 5 s limit/,
    );
  });

  it("cleans up after a cancelled call", async () => {
    respond({ ...mainReply(JSON.stringify(REPLY)), delayMs: 3000 });
    await connect(config());
    const controller = new AbortController();

    const pending = call({}, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(tempDirs()).toEqual([]);
    expect(spawnSync("pgrep", ["-f", TEMP_PREFIX], { encoding: "utf8" }).stdout.trim()).toBe("");
  });

  it("runs one analysis at a time when concurrency is 1", async () => {
    respond({ ...mainReply(JSON.stringify(REPLY)), delayMs: 300 });
    await connect(config({ maxConcurrency: 1 }));

    await Promise.all([call({}), call({})]);

    const paths = endpoint.requests.map((request) =>
      request.path.endsWith("/models") ? "models" : "chat",
    );
    expect(paths).toEqual(["models", "chat", "chat", "models", "chat", "chat"]);
  });

  it("keeps base64, transcripts, and answers out of logs", async () => {
    respond(
      mainReply(
        JSON.stringify({
          ...REPLY,
          speech: { present: true, language: "en", transcript: "secret words" },
        }),
      ),
    );
    await connect(config());

    await call({});
    const logged = JSON.stringify(logs);

    expect(logs).toHaveLength(1);
    expect(logged).not.toMatch(/base64|secret words|moving test pattern|sk-e2e-secret/);
    expect(logs[0]).toMatchObject({ code: "OK", sourceKind: "local", promptTokens: 3433 });
  });
});
