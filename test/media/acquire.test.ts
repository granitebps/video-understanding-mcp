import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RuntimeConfig } from "../../src/config/env.js";
import { VideoError } from "../../src/errors/video-error.js";
import { acquireSource } from "../../src/media/acquire.js";
import { Dependencies } from "../../src/media/dependencies.js";
import { createGuardedAgent } from "../../src/media/network-guard.js";
import { makeFixtures } from "../fixtures/make-fixtures.js";
import { testConfig } from "../helpers/server.js";

const fakeYtDlp = fileURLToPath(new URL("../helpers/fake-yt-dlp.mjs", import.meta.url));
let server: Server;
let base: string;
let log: string;

beforeAll(() => {
  makeFixtures();
}, 60_000);

beforeAll(async () => {
  chmodSync(fakeYtDlp, 0o755);
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html>a video page</html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  log = join(mkdtempSync(join(tmpdir(), "vu-ytdlp-log-")), "calls.log");
  process.env.FAKE_YTDLP_LOG = log;
  process.env.FAKE_YTDLP_FIXTURE = makeFixtures().noAudio;
});

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return testConfig({ allowPrivateNetwork: true, ytDlpPath: fakeYtDlp, ...overrides });
}

function acquire(path: string, cfg = config(), limit = 300) {
  return acquireSource({
    source: `${base}${path}`,
    headers: { cookie: "sid=1" },
    config: cfg,
    dependencies: new Dependencies(cfg),
    agent: createGuardedAgent({ allowPrivateNetwork: true }),
    workDir: mkdtempSync(join(tmpdir(), "vu-acquire-")),
    signal: new AbortController().signal,
    checkDuration: (seconds) => {
      if (seconds > limit) {
        throw new VideoError({
          code: "LIMIT_EXCEEDED",
          safeMessage: `${seconds} s over ${limit} s`,
        });
      }
    },
  });
}

function calls(): string[][] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

describe("acquireSource with page URLs", () => {
  it("downloads a page video through yt-dlp without passing caller headers", async () => {
    const acquired = await acquire("/watch/ok");

    expect(acquired.kind).toBe("page");
    expect(statSync(acquired.path).size).toBe(statSync(makeFixtures().noAudio).size);
    const download = calls().find((args) => !args.includes("-J") && !args.includes("--version"));
    expect(download).toEqual(expect.arrayContaining(["--max-filesize", "--merge-output-format"]));
    expect(JSON.stringify(calls())).not.toContain("sid=1");
  });

  it("refuses an over-long video before downloading it", async () => {
    await expect(acquire("/watch/long")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(calls().filter((args) => !args.includes("-J") && !args.includes("--version"))).toEqual(
      [],
    );
  });

  it("reports an unsupported page with yt-dlp's reason", async () => {
    await expect(acquire("/watch/unsupported")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      safeMessage: expect.stringContaining("Unsupported URL") as string,
    });
  });

  it("reports an over-size page video as over the download limit", async () => {
    await expect(acquire("/watch/toolarge")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("reports a run that produced no file for another reason as unavailable", async () => {
    await expect(acquire("/watch/nofile")).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });

  it("tells yt-dlp to ignore user and system config files", async () => {
    await acquire("/watch/ok");

    const runs = calls().filter((args) => !args.includes("--version"));
    expect(runs).toHaveLength(2);
    for (const args of runs) expect(args).toContain("--ignore-config");
  });

  it("asks for yt-dlp or a direct media URL when yt-dlp is missing", async () => {
    await expect(
      acquire("/watch/ok", config({ ytDlpPath: "/nonexistent/yt-dlp" })),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_MISSING",
      safeMessage: expect.stringMatching(/yt-dlp.*direct media URL/) as string,
    });
  });

  it("rejects a source that is neither a URL nor an absolute path", async () => {
    const cfg = config();
    await expect(
      acquireSource({
        source: "videos/clip.mp4",
        headers: undefined,
        config: cfg,
        dependencies: new Dependencies(cfg),
        agent: createGuardedAgent({ allowPrivateNetwork: true }),
        workDir: mkdtempSync(join(tmpdir(), "vu-acquire-")),
        signal: new AbortController().signal,
        checkDuration: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
