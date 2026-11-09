import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { isLocalSource, resolveLocalFile } from "../../src/media/local-file.js";

let root: string;
let allowed: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "vu-local-")));
  allowed = join(root, "allowed");
  mkdirSync(allowed);
  mkdirSync(join(root, "allowed2"));
  mkdirSync(join(allowed, "nested"));
  writeFileSync(join(allowed, "clip.mp4"), "video");
  writeFileSync(join(root, "outside.mp4"), "secret");
  writeFileSync(join(root, "allowed2", "x.mp4"), "sibling");
  symlinkSync(join(root, "outside.mp4"), join(allowed, "escape.mp4"));
});

describe("resolveLocalFile", () => {
  it("accepts a file inside an allowed directory, as a path or file URL", async () => {
    await expect(resolveLocalFile(join(allowed, "clip.mp4"), [allowed])).resolves.toBe(
      join(allowed, "clip.mp4"),
    );
    await expect(
      resolveLocalFile(pathToFileURL(join(allowed, "clip.mp4")).href, [allowed]),
    ).resolves.toBe(join(allowed, "clip.mp4"));
  });

  it.each([
    ["a traversal out of the directory", () => join(allowed, "..", "outside.mp4")],
    ["a symlink pointing outside", () => join(allowed, "escape.mp4")],
    ["a sibling directory sharing the prefix", () => join(root, "allowed2", "x.mp4")],
    ["a directory", () => join(allowed, "nested")],
    ["a missing file", () => join(allowed, "missing.mp4")],
  ])("refuses %s", async (_label, path) => {
    await expect(resolveLocalFile(path(), [allowed])).rejects.toMatchObject({
      code: "SOURCE_NOT_ALLOWED",
    });
  });

  it("refuses every local path when no directory is configured", async () => {
    await expect(resolveLocalFile(join(allowed, "clip.mp4"), [])).rejects.toMatchObject({
      code: "SOURCE_NOT_ALLOWED",
      safeMessage: expect.stringContaining("VIDEO_ALLOWED_DIRS") as string,
    });
  });
});

describe("isLocalSource", () => {
  it("distinguishes paths from URLs", () => {
    expect(isLocalSource("/videos/a.mp4")).toBe(true);
    expect(isLocalSource("file:///videos/a.mp4")).toBe(true);
    expect(isLocalSource("https://example.com/a.mp4")).toBe(false);
    expect(isLocalSource("relative/a.mp4")).toBe(false);
  });
});
