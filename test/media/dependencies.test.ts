import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Dependencies } from "../../src/media/dependencies.js";
import { testConfig } from "../helpers/server.js";

describe("Dependencies", () => {
  it("finds a tool installed after an earlier failed probe", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "vu-deps-")), "yt-dlp");
    const dependencies = new Dependencies(testConfig({ ytDlpPath: path }));

    expect(await dependencies.ytDlpStatus()).toEqual({ available: false, version: null });

    writeFileSync(path, "#!/bin/sh\necho 2026.11.01\n");
    chmodSync(path, 0o755);

    expect(await dependencies.ytDlpStatus()).toEqual({ available: true, version: "2026.11.01" });
  });
});
