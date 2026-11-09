import { describe, expect, it } from "vitest";

import { parseReply, placeTimeline } from "../../src/analysis/normalize.js";
import { Semaphore } from "../../src/analysis/semaphore.js";

describe("parseReply", () => {
  it("reads a fenced JSON reply and validates each field independently", () => {
    const raw =
      'Here you go:\n```json\n{"answer":"Two products","summary":"A promo.","speech":{"present":false,"language":null,"transcript":""},"on_screen_text":["50% OFF","50% OFF",3],"timeline":[{"start":"0:05","description":"price card"},{"start":"bad","description":"x"}]}\n```';

    const { fields, warnings } = parseReply(raw);

    expect(warnings).toEqual([]);
    expect(fields).toEqual({
      answer: "Two products",
      summary: "A promo.",
      speech: { present: false, language: null, transcript: "" },
      on_screen_text: ["50% OFF"],
      timeline: [{ start: 5, description: "price card" }],
    });
  });

  it("keeps the other fields when one field has the wrong type", () => {
    const { fields } = parseReply(
      JSON.stringify({ answer: "ok", summary: "s", speech: "none", timeline: "n/a" }),
    );

    expect(fields.answer).toBe("ok");
    expect(fields.speech).toEqual({ present: false, language: null, transcript: "" });
    expect(fields.timeline).toEqual([]);
  });

  it("marks speech present when a transcript is given without the flag", () => {
    const { fields } = parseReply(
      JSON.stringify({ answer: "a", speech: { transcript: "halo semua", language: "id" } }),
    );

    expect(fields.speech).toEqual({ present: true, language: "id", transcript: "halo semua" });
  });

  it("falls back to the raw text when there is no structure", () => {
    const { fields, warnings } = parseReply("The video shows a cat jumping.");

    expect(fields.answer).toBe("The video shows a cat jumping.");
    expect(fields.summary).toBe("");
    expect(warnings).toEqual([expect.objectContaining({ code: "STRUCTURED_FIELDS_UNAVAILABLE" })]);
  });
});

describe("placeTimeline", () => {
  it("offsets clip times to source times, drops out-of-range entries, and sorts", () => {
    const { timeline, warnings } = placeTimeline(
      [
        { start: 9, description: "late" },
        { start: 3, description: "early" },
        { start: 42, description: "hallucinated" },
        { start: -1, description: "negative" },
      ],
      { start: 5, end: 15 },
    );

    expect(timeline).toEqual([
      { start: 8, description: "early" },
      { start: 14, description: "late" },
    ]);
    expect(warnings).toEqual([
      expect.objectContaining({
        code: "TIMELINE_ENTRIES_REMOVED",
        message: expect.stringContaining("2 timeline entries") as string,
      }),
    ]);
  });
});

describe("Semaphore", () => {
  it("queues beyond capacity in order and drops cancelled waiters", async () => {
    const semaphore = new Semaphore(1);
    const order: string[] = [];
    const releaseFirst = await semaphore.acquire(new AbortController().signal);

    const cancelled = new AbortController();
    const second = semaphore.acquire(cancelled.signal);
    const third = semaphore.acquire(new AbortController().signal).then((release) => {
      order.push("third");
      return release;
    });
    cancelled.abort(new Error("gone"));
    await expect(second).rejects.toThrow("gone");

    order.push("first-done");
    releaseFirst();
    (await third)();

    expect(order).toEqual(["first-done", "third"]);
  });
});
