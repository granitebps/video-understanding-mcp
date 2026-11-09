#!/usr/bin/env node
// Stand-in for yt-dlp in tests. Behavior is chosen by the URL path; invocations are logged.
import { appendFileSync, copyFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2026.10.01\n");
  process.exit(0);
}

const url = new URL(args.at(-1) ?? "http://invalid/");
if (process.env.FAKE_YTDLP_LOG) {
  appendFileSync(process.env.FAKE_YTDLP_LOG, `${JSON.stringify(args)}\n`);
}

if (url.pathname.includes("unsupported")) {
  process.stderr.write(`WARNING: something\nERROR: Unsupported URL: ${url.href}\n`);
  process.exit(1);
}

if (args.includes("-J")) {
  const duration = url.pathname.includes("long") ? 1500 : 20;
  process.stdout.write(JSON.stringify({ id: "x", duration }));
  process.exit(0);
}

if (url.pathname.includes("toolarge")) {
  process.stdout.write(
    "[download] File is larger than max-filesize (900000000 bytes > 500000000 bytes). Aborting.\n",
  );
  process.exit(0);
}
if (url.pathname.includes("nofile")) process.exit(0);

const template = args[args.indexOf("-o") + 1] ?? "";
const fixture = process.env.FAKE_YTDLP_FIXTURE;
if (!fixture) {
  process.stderr.write("ERROR: FAKE_YTDLP_FIXTURE is not set\n");
  process.exit(1);
}
copyFileSync(fixture, template.replace("%(ext)s", "mp4"));
process.exit(0);
