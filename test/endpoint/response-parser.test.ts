import { describe, expect, it } from "vitest";

import { parseChatResponse } from "../../src/endpoint/response-parser.js";

const completion = {
  model: "gemini-3.8-flash-n",
  choices: [
    {
      message: { role: "assistant", content: '```json\n{"answer":"hi"}\n```' },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 3433, completion_tokens: 308 },
};

describe("parseChatResponse", () => {
  it("reads a plain JSON completion", () => {
    expect(parseChatResponse(JSON.stringify(completion))).toEqual({
      text: '```json\n{"answer":"hi"}\n```',
      model: "gemini-3.8-flash-n",
      usage: { promptTokens: 3433, completionTokens: 308 },
      finishReason: "stop",
      error: null,
    });
  });

  it("reads a JSON body followed directly by a done marker", () => {
    const parsed = parseChatResponse(`${JSON.stringify(completion)}data: [DONE]\n\n`);

    expect(parsed.text).toContain('"answer":"hi"');
    expect(parsed.usage?.promptTokens).toBe(3433);
  });

  it("joins server-sent event deltas split mid-content", () => {
    const events = [
      { model: "m", choices: [{ delta: { content: '{"ans' } }] },
      { choices: [{ delta: { content: 'wer":"split"}' } }] },
      { choices: [{ delta: {}, finish_reason: "length" }], usage: { prompt_tokens: 10 } },
    ];
    const body =
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n";

    const parsed = parseChatResponse(body);

    expect(parsed.text).toBe('{"answer":"split"}');
    expect(parsed.finishReason).toBe("length");
    expect(parsed.usage).toEqual({ promptTokens: 10, completionTokens: null });
  });

  it("reads content given as an array of text parts", () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "one " },
              { type: "text", text: "two" },
            ],
          },
        },
      ],
    });

    expect(parseChatResponse(body).text).toBe("one two");
  });

  it("captures an error object sent with a success status", () => {
    const parsed = parseChatResponse(JSON.stringify({ error: { message: "model overloaded" } }));

    expect(parsed.error).toEqual({ message: "model overloaded" });
    expect(parsed.text).toBe("");
  });

  it("ignores non-JSON noise around values", () => {
    const parsed = parseChatResponse(
      `event: message\n: keepalive\ndata: not json\n${JSON.stringify(completion)}`,
    );

    expect(parsed.model).toBe("gemini-3.8-flash-n");
  });
});
