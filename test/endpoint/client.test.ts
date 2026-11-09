import { createServer } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkReachable, sendChat, type EndpointSettings } from "../../src/endpoint/client.js";
import { VideoError } from "../../src/errors/video-error.js";
import { chatBody, startFakeEndpoint, type FakeEndpoint } from "../helpers/fake-endpoint.js";

const KEY = "sk-test-secret-key-123";
let endpoint: FakeEndpoint;

function settings(overrides: Partial<EndpointSettings> = {}): EndpointSettings {
  return {
    baseUrl: endpoint.baseUrl,
    apiKey: KEY,
    model: "fake-model",
    requestTimeoutMs: 5_000,
    ...overrides,
  };
}

async function chatError(overrides: Partial<EndpointSettings> = {}): Promise<VideoError> {
  try {
    await sendChat(
      settings(overrides),
      [{ role: "user", content: "hi" }],
      16,
      new AbortController().signal,
    );
  } catch (error) {
    if (error instanceof VideoError) return error;
    throw error;
  }
  throw new Error("expected sendChat to fail");
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
  endpoint = await startFakeEndpoint();
});

afterEach(async () => {
  await endpoint.close();
});

describe("sendChat", () => {
  it("sends the model, messages, and bearer key and returns the reply", async () => {
    endpoint.chat = [{ body: chatBody("hello", { model: "upstream-model" }) }];

    const reply = await sendChat(
      settings(),
      [{ role: "user", content: "hi" }],
      64,
      new AbortController().signal,
    );

    expect(reply).toEqual({
      text: "hello",
      reportedModel: "upstream-model",
      usage: { promptTokens: 3433, completionTokens: 120 },
      finishReason: "stop",
    });
    const request = endpoint.requests.at(-1);
    expect(request?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request?.json).toMatchObject({ model: "fake-model", max_tokens: 64, stream: false });
  });

  it("surfaces a length finish reason", async () => {
    endpoint.chat = [
      { body: { choices: [{ message: { content: "partial" }, finish_reason: "length" }] } },
    ];

    const reply = await sendChat(settings(), [], 16, new AbortController().signal);

    expect(reply.finishReason).toBe("length");
  });

  it.each([
    [401, {}, "ENDPOINT_AUTH"],
    [403, {}, "ENDPOINT_AUTH"],
    [413, {}, "LIMIT_EXCEEDED"],
    [400, { error: { message: "Request payload size exceeds the limit" } }, "LIMIT_EXCEEDED"],
    [500, { error: { message: "boom" } }, "ENDPOINT_ERROR"],
  ])("maps HTTP %s to its code", async (status, body, code) => {
    endpoint.chat = [{ status, body }];

    expect((await chatError()).code).toBe(code);
  });

  it("reports rate limits with the retry delay", async () => {
    endpoint.chat = [{ status: 429, headers: { "retry-after": "7" }, body: {} }];

    const error = await chatError();

    expect(error.code).toBe("ENDPOINT_RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(7);
  });

  it("treats an error object inside a success response as an endpoint error", async () => {
    endpoint.chat = [{ status: 200, body: { error: { message: "upstream exploded" } } }];

    const error = await chatError();

    expect(error.code).toBe("ENDPOINT_ERROR");
    expect(error.safeMessage).toContain("upstream exploded");
  });

  it("rejects an empty reply", async () => {
    endpoint.chat = [{ body: chatBody("  ") }];

    expect((await chatError()).code).toBe("EMPTY_RESPONSE");
  });

  it("times out a stalled endpoint", async () => {
    endpoint.chat = [{ body: chatBody("late"), delayMs: 400 }];

    expect((await chatError({ requestTimeoutMs: 100 })).code).toBe("TIMEOUT");
  });

  it("redacts a key echoed back in an error body", async () => {
    endpoint.chat = [
      { status: 400, body: { error: { message: `bad header Authorization: Bearer ${KEY}` } } },
    ];

    const error = await chatError();

    expect(error.safeMessage).not.toContain(KEY);
  });

  it("reports a closed port as unreachable without the key", async () => {
    const error = await chatError({ baseUrl: await closedPortUrl() });

    expect(error.code).toBe("ENDPOINT_UNREACHABLE");
    expect(error.safeMessage).toMatch(/not reachable: http:\/\/127\.0\.0\.1:\d+$/);
    expect(error.safeMessage).not.toContain(KEY);
  });
});

describe("checkReachable", () => {
  it("accepts any HTTP answer, including 404", async () => {
    endpoint.models = { status: 404, body: {} };

    await expect(checkReachable(settings(), new AbortController().signal)).resolves.toBeUndefined();
  });

  it.each([502, 530])("treats gateway status %s as an unreachable origin", async (status) => {
    endpoint.models = { status, body: "origin down" };

    await expect(checkReachable(settings(), new AbortController().signal)).rejects.toMatchObject({
      code: "ENDPOINT_UNREACHABLE",
    });
  });

  it("reports a closed port as unreachable", async () => {
    await expect(
      checkReachable(settings({ baseUrl: await closedPortUrl() }), new AbortController().signal),
    ).rejects.toMatchObject({ code: "ENDPOINT_UNREACHABLE" });
  });
});

describe("sendChat for a baseline request", () => {
  it("accepts an empty reply and keeps its usage", async () => {
    endpoint.chat = [{ body: chatBody("", { usage: { prompt_tokens: 74 } }) }];

    const reply = await sendChat(settings(), [], 16, new AbortController().signal, {
      allowEmpty: true,
    });

    expect(reply.usage?.promptTokens).toBe(74);
  });
});
