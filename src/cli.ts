#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { config as loadDotenv } from "dotenv";

import { createUnderstand } from "./analysis/understand.js";
import { loadConfig } from "./config/env.js";
import { redactSecrets } from "./errors/video-error.js";
import { Dependencies } from "./media/dependencies.js";
import { createVideoServer } from "./server/create-server.js";

function packageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error("Package version is missing");
  return manifest.version;
}

function reportFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.VIDEO_API_KEY?.trim();
  console.error(`video-understanding-mcp: ${redactSecrets(message, apiKey ? [apiKey] : [])}`);
}

async function main(): Promise<void> {
  loadDotenv({ quiet: true });
  const config = loadConfig(process.env);
  const dependencies = new Dependencies(config);
  const understand = createUnderstand(config, dependencies);
  const version = packageVersion();
  const handle = serveStdio(
    () => createVideoServer({ config, dependencies, understand, version }),
    { onerror: reportFatal },
  );

  const close = (): void => {
    void handle.close().catch(reportFatal);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

void main().catch((error: unknown) => {
  reportFatal(error);
  process.exitCode = 1;
});
