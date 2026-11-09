import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fetchSource, type FetchSourceOptions } from "../../src/media/download.js";
import {
  assertUrlAllowed,
  createGuardedAgent,
  isBlockedAddress,
  type Resolver,
} from "../../src/media/network-guard.js";

interface Hit {
  path: string;
  headers: IncomingHttpHeaders;
}

let server: Server;
let port: number;
let hits: Hit[];

beforeEach(async () => {
  hits = [];
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    hits.push({ path, headers: request.headers });
    if (path === "/video.mp4") {
      response.writeHead(200, { "content-type": "video/mp4" });
      response.end(Buffer.alloc(2048, 7));
    } else if (path === "/big.mp4") {
      response.writeHead(200, { "content-type": "video/mp4" });
      response.end(Buffer.alloc(50_000, 1));
    } else if (path === "/expired.mp4") {
      response.writeHead(403);
      response.end("expired");
    } else if (path === "/page") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html></html>");
    } else if (path === "/same-host") {
      response.writeHead(302, { location: "/video.mp4" });
      response.end();
    } else if (path === "/cross-host") {
      response.writeHead(302, { location: `http://127.0.0.1:${port}/video.mp4` });
      response.end();
    } else if (path === "/to-private") {
      response.writeHead(302, { location: "http://10.0.0.5/video.mp4" });
      response.end();
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const toLoopback: Resolver = async () => [{ address: "127.0.0.1", family: 4 }];

function options(
  overrides: Partial<FetchSourceOptions> & { resolver?: Resolver } = {},
): FetchSourceOptions {
  const allowPrivateNetwork = overrides.allowPrivateNetwork ?? true;
  return {
    agent: createGuardedAgent({ allowPrivateNetwork, resolver: overrides.resolver ?? toLoopback }),
    allowPrivateNetwork,
    headers: undefined,
    maxBytes: 10_000,
    workDir: mkdtempSync(join(tmpdir(), "vu-download-")),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "0.0.0.0",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.215.14", "8.8.8.8", "2606:4700::6810:84e5"])("allows public %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("network restriction", () => {
  it.each([
    "http://127.0.0.1:1/a.mp4",
    "http://[::1]/a.mp4",
    "http://[::ffff:10.0.0.1]/a.mp4",
    "http://169.254.169.254/latest/meta-data",
  ])("refuses IP-literal %s before connecting", (url) => {
    expect(() => assertUrlAllowed(new URL(url), false)).toThrow(
      expect.objectContaining({ code: "SOURCE_NOT_ALLOWED" }) as Error,
    );
  });

  it("refuses non-http schemes", () => {
    expect(() => assertUrlAllowed(new URL("file:///etc/passwd"), true)).toThrow(/http and https/);
  });

  it("refuses a public-looking hostname that resolves to a private address", async () => {
    const toPrivate: Resolver = async () => [{ address: "10.0.0.5", family: 4 }];

    await expect(
      fetchSource(
        `http://videos.example:${port}/video.mp4`,
        options({ allowPrivateNetwork: false, resolver: toPrivate }),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_ALLOWED" });
    expect(hits).toEqual([]);
  });

  it("refuses a redirect that points at a private address", async () => {
    const publicThenServer: Resolver = async () => [{ address: "127.0.0.1", family: 4 }];
    const allowFirstHop = options({ allowPrivateNetwork: true, resolver: publicThenServer });

    await expect(
      fetchSource(`http://localhost:${port}/to-private`, {
        ...allowFirstHop,
        allowPrivateNetwork: false,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_ALLOWED" });
  });

  it("reaches a local server when private networks are allowed", async () => {
    const result = await fetchSource(`http://localhost:${port}/video.mp4`, options());

    expect(result.kind).toBe("media");
  });
});

describe("header scope", () => {
  it("keeps caller headers on a same-host redirect", async () => {
    await fetchSource(
      `http://localhost:${port}/same-host`,
      options({ headers: { referer: "https://www.tiktok.com/" } }),
    );

    expect(hits.map((hit) => [hit.path, hit.headers.referer])).toEqual([
      ["/same-host", "https://www.tiktok.com/"],
      ["/video.mp4", "https://www.tiktok.com/"],
    ]);
  });

  it("drops caller headers after a redirect to another host", async () => {
    await fetchSource(
      `http://localhost:${port}/cross-host`,
      options({ headers: { cookie: "sid=secret", referer: "https://www.tiktok.com/" } }),
    );

    expect(hits[0]?.headers.cookie).toBe("sid=secret");
    expect(hits[1]?.path).toBe("/video.mp4");
    expect(hits[1]?.headers.cookie).toBeUndefined();
    expect(hits[1]?.headers.referer).toBeUndefined();
  });
});

describe("fetchSource", () => {
  it("saves direct media to the work directory", async () => {
    const opts = options();
    const result = await fetchSource(`http://localhost:${port}/video.mp4`, opts);

    expect(result.kind).toBe("media");
    if (result.kind === "media") {
      expect(result.bytes).toBe(2048);
      expect(readFileSync(result.path).length).toBe(2048);
    }
  });

  it("classifies an HTML response as a page", async () => {
    const result = await fetchSource(`http://localhost:${port}/page`, options());

    expect(result).toMatchObject({ kind: "page" });
  });

  it("reports an expired media URL with its status", async () => {
    await expect(
      fetchSource(`http://localhost:${port}/expired.mp4`, options()),
    ).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      safeMessage: expect.stringContaining("HTTP 403") as string,
    });
  });

  it("stops an oversized download and leaves no partial file", async () => {
    const opts = options({ maxBytes: 10_000 });

    await expect(fetchSource(`http://localhost:${port}/big.mp4`, opts)).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
    expect(readdirSync(opts.workDir)).toEqual([]);
    expect(existsSync(join(opts.workDir, "source-download"))).toBe(false);
  });
});
