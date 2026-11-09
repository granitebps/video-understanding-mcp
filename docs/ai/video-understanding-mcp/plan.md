# Video Understanding MCP Implementation Plan

## Implementation Goal

Build `@granitebps/video-understanding-mcp` from an empty repository: a stdio MCP server with two tools, `understand_video` and `get_server_info`, that acquires a video (page URL via yt-dlp, direct media URL with headers, or allowlisted local file), prepares a small MP4 with ffmpeg, sends it inline to an operator-configured OpenAI-compatible chat completions endpoint in one of four request shapes, and returns a validated structured result. All of `spec.md` (REQ-001…REQ-026, NFR-001…NFR-004) applies.

Must not happen: secrets or media content in output or logs; local files outside the allowlist being read; downloads reaching non-public addresses; a video-less answer being returned as if the video was seen.

Out of scope here (spec Non-Goals): HTTP transport, caching, chunking, model fallback, native provider APIs. Registering the server in the ai-forge repo and publishing a release are separate, approval-gated work.

## Sources

- `docs/ai/video-understanding-mcp/spec.md` — REQ-001…REQ-026, NFR-001…NFR-004, Constraints, Assumptions.
- `github.com/granitebps/twitter-mcp` (v1.1.0) — the pattern for every scaffold, config, server, error, test, release, and CI file below. Clone it next to this repo for reference; it is not a dependency.
- Probe evidence, 2026-11-09 (spec Context) — response quirks, token costs, `video_url` behavior.
- Live verification and default-shape decision, 2026-11-09 — `image_url` is the default (spec Assumptions).
- Local check, 2026-11-09: an undici `Agent` with a `connect.lookup` hook can reject resolved addresses before the socket opens (tested against Node 22.14 with `undici@7`).

## Current-State Baseline

- This repository contains only `docs/ai/video-understanding-mcp/` and an initialized git repo (`main`, remote `origin` = `git@github.com:granitebps/video-understanding-mcp.git`, no commits).
- twitter-mcp layout to mirror:
  - `src/cli.ts` — `#!/usr/bin/env node`; `dotenv` quiet load; `loadConfig(process.env)`; `serveStdio(() => createServer(...), { onerror })` from `@modelcontextprotocol/server/stdio`; SIGINT/SIGTERM close; fatal errors printed redacted to stderr with exit code 1.
  - `src/index.ts` — library exports.
  - `src/config/env.ts` — `loadConfig(env)` with `readNonEmpty` helpers; throws on invalid values.
  - `src/server/create-server.ts` — `new McpServer({ name, version }, { instructions })`.
  - `src/server/register-tools.ts` — `server.registerTool(name, { title, description, inputSchema, outputSchema, annotations }, handler)`; `execute()` wraps each call with an `AbortController` tied to `context.mcpReq.signal` plus a deadline.
  - `src/server/input.ts` — zod input schemas.
  - `src/server/output.ts` — `objectResult` (JSON text + `structuredContent`) and `errorResult` (`isError: true`, `structuredContent.error`).
  - `src/errors/twitter-error.ts` — typed error class with `code`, `safeMessage`, `retryable`; `redactSecrets()`; `toXError()` mapping unknowns to `INTERNAL_ERROR`.
  - Tests in `test/**` with vitest; server tests use `Client` + `InMemoryTransport` from `@modelcontextprotocol/client`; `test/cli/stdio.test.ts` spawns `dist/cli.js` through `StdioClientTransport`; live tests under `test/live/**` run only via `vitest.live.config.ts`.
  - Tooling: `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, bundler resolution) + `tsconfig.build.json`; `eslint.config.js` (typescript-eslint recommendedTypeChecked); prettier; coverage thresholds 90/80/80/90.
  - Release: `scripts/check-{install,package,release,workflows,registry-entry}.mjs`, `scripts/npm-command.mjs`, `.github/workflows/{ci,release}.yml`, `.github/dependabot.yml`, `server.json`, `RELEASE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/release-notes-vX.Y.Z.md`, `docs/v1-compatibility.md`, `test/release/*`. These scripts hard-code `twitter-mcp`, `TWITTER_*` env names, and expected tool counts; they must be adapted, not copied blind.
- Local machine: ffmpeg/ffprobe 9.0.1 with libx264 and aac on PATH; yt-dlp not installed; default `node` is 22.14 (below the engine floor), Node 26.4 available at `/opt/homebrew/bin/node`. Use Node ≥ 22.21 for all work.

## Technical Decisions

### Mirror twitter-mcp, with three deliberate departures

Copy twitter-mcp's stack and file conventions (MCP SDK `@modelcontextprotocol/server` ^2, zod 4, TypeScript 6, vitest 3, eslint 9, prettier 3, dotenv). Departures:

- `license: "MIT"` (spec Constraint) with an MIT `LICENSE`.
- `engines.node: ">=22.21.0"` (NFR-004; twitter-mcp's `^22.21.0` contradicts its own Node 24 CI job).
- Error results also carry `_meta["video-understanding-mcp/error"]` and a `[CODE] message` text prefix (REQ-026), in addition to twitter-mcp's `structuredContent.error`.

### Use `undici` for downloads; global `fetch` for the endpoint

Media downloads go through `undici.fetch` with a dedicated `Agent` whose `connect.lookup` resolves with `all: true` and rejects any non-public address before connecting (REQ-008). IP-literal hosts never invoke `lookup`, so they are checked explicitly before the request. Redirects use `redirect: "manual"`; each hop is re-validated, at most 5 hops. The endpoint (operator-configured, exempt from REQ-008) uses plain global `fetch`.

Non-public ranges are held in a `node:net` `BlockList`: IPv4 `0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4`; IPv6 `::/128, ::1/128, fc00::/7, fe80::/10, ff00::/8`; IPv4-mapped IPv6 (`::ffff:0:0/96`) is unwrapped and checked as IPv4. `VIDEO_ALLOW_PRIVATE_NETWORK=true` disables the check.

Rejected: an IP-classification npm package (BlockList covers the need without a dependency).

### Classify URL sources by what the server returns

For an http(s) source, the server issues one guarded GET:

- `Content-Type` `video/*`, `application/octet-stream`, or `binary/octet-stream`, or the URL path ending in `.mp4/.mov/.webm/.mkv/.m4v` → direct media; stream to disk.
- Anything else (typically `text/html`) → abort the body and treat as a page URL for yt-dlp.

Caller headers apply to this GET and to redirect hops whose `URL.host` (hostname and port) equals the caller URL's; any other hop gets only the server's default headers (REQ-006). A page URL with yt-dlp missing → `DEPENDENCY_MISSING` with the "pass a direct media URL" hint (REQ-005). Caller headers are not passed to yt-dlp.

### yt-dlp in two steps: metadata, then download

1. `yt-dlp --ignore-config -J --no-playlist --no-warnings <url>` (60 s timeout) → read `duration`. If the analyzed range is over the limit → `LIMIT_EXCEEDED` before downloading (REQ-011).
2. `yt-dlp --no-playlist -f "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b" --merge-output-format mp4 --max-filesize <maxDownloadBytes> --ffmpeg-location <ffmpeg dir> -o <tmp>/source.%(ext)s <url>`.

Extraction failures map to `SOURCE_UNAVAILABLE` with the last `ERROR:` line of stderr, truncated to 300 chars. A run that ends without a file (yt-dlp skips files over `--max-filesize`) → `LIMIT_EXCEEDED`.

### ffmpeg preparation ladder

`ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of json` gives the duration and streams. No video stream → `INVALID_MEDIA`. A non-zero ffprobe exit on a downloaded file also → `INVALID_MEDIA` (REQ-009).

Encode `prepared.mp4`:

| Attempt                                           | Video                                                                                                 | Audio                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------- |
| 1                                                 | Shorter side at most 480 pixels (even dimensions, never upscaled), libx264 `-preset veryfast -crf 30` | `-c:a aac -b:a 64k -ac 1` |
| 2 (only when attempt 1 exceeds the payload limit) | Shorter side at most 360 pixels, `-crf 34`                                                            | 48k                       |

Inputs are opened with `-protocol_whitelist file`, and ffprobe rejects playlist and concatenation formats (`hls`, `concat`). All attempts also use `-pix_fmt yuv420p -movflags +faststart -map 0:v:0 -map 0:a:0?`. A range uses `-ss <start> -t <end-start>` before `-i`.

If attempt 2 still exceeds the limit → `LIMIT_EXCEEDED` with measured size, limit, and the range hint. The probe measured 95 s at 480p ≈ 2.3 MB, so attempt 1 normally suffices (REQ-013).

### Request shapes

One builder per shape, selected by `VIDEO_PART_FORMAT` (default `image_url`). Each returns the media content part:

```ts
type PartFormat = "video_url" | "image_url" | "file" | "input_file";
// video_url : { type: "video_url", video_url: { url: dataUrl, fps? } }
// image_url : { type: "image_url", image_url: { url: dataUrl } }
// file      : { type: "file", file: { file_data: dataUrl, format: "video/mp4", video_metadata?: { fps } } }
// input_file: { type: "input_file", filename: "video.mp4", mime_type: "video/mp4", file_data: dataUrl }
const supportsFps: Record<PartFormat, boolean> = {
  video_url: true,
  image_url: false,
  file: true,
  input_file: false,
};
```

`fps` is attached only when the caller passed it and the shape supports it; otherwise add a warning (REQ-014). The request body is `{ model, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: [textPart, mediaPart] }], max_tokens: VIDEO_MAX_OUTPUT_TOKENS, stream: false }`. Do not send `response_format`; support for it varies across gateways.

### Prompt and result contract

The system prompt asks for a single JSON object, with times in seconds from the start of the supplied clip:

```json
{
  "answer": "...",
  "summary": "...",
  "speech": { "present": true, "language": "id", "transcript": "..." },
  "on_screen_text": ["..."],
  "timeline": [{ "start": 0.0, "description": "..." }]
}
```

It also states:

- `answer` answers the user's question, or gives a general description covering visuals, speech, and on-screen text when there is no question;
- `answer` and `summary` are in the language of the question, or English when there is none;
- the transcript and on-screen text are kept in their original language and not translated;
- an empty transcript means no speech.

The user text part carries the question (or the no-question instruction) and the clip duration.

The server parses the reply leniently. It strips a Markdown fence, then reads the first JSON object. A zod schema validates each field independently, and missing or invalid fields become empty values, so one bad field doesn't discard the rest. If no JSON object is found → `answer = raw text`, other fields empty, warning `STRUCTURED_FIELDS_UNAVAILABLE` (REQ-002).

Timeline post-processing (REQ-012, REQ-022):

1. Drop entries with `start < 0` or `start > clipDuration + 1`.
2. Add `rangeStart` to the remaining entries.
3. Sort by `start`.
4. Report the number dropped in a warning.

### Response parsing

`parseChatResponse(bodyText)`:

1. Remove every literal `data: [DONE]` and the bare `[DONE]` line.
2. Split into lines and strip a leading `data:` from each.
3. Decode every concatenated JSON value per line with a raw-decode loop.

From the decoded chunks, collect:

- `choices[].message.content` or `choices[].delta.content`, either a string or an array of `{type:"text", text}` parts, concatenated;
- the last `model`;
- the last `usage`;
- the last `finish_reason`;
- any top-level `error` object.

This covers plain JSON, SSE, JSON followed by `[DONE]`, and split chunks (REQ-019). The probe's `probe.py` logic, summarized in spec Context, is the reference behavior.

### Endpoint reachability and error classification

Before any media work, `GET {base}/models` with the API key, 5 s timeout.

| Result of the pre-check                                                        | Outcome                |
| ------------------------------------------------------------------------------ | ---------------------- |
| Network error (DNS, refused, reset, TLS, timeout)                              | `ENDPOINT_UNREACHABLE` |
| HTTP `502, 504, 521, 522, 523, 530` (gateways reporting an unreachable origin) | `ENDPOINT_UNREACHABLE` |
| Any other HTTP status, including 401/404                                       | Reachable              |

The message is `The configured base URL is not reachable: <scheme>://<host>:<port>`.

Main-request classification:

| Condition                                                                                      | Code                                                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 401/403                                                                                        | `ENDPOINT_AUTH`                                                  |
| 429                                                                                            | `ENDPOINT_RATE_LIMITED` (`retryAfterSeconds` from `Retry-After`) |
| 413, or an error body matching `/too large\|payload\|request entity\|exceeds.*(size\|limit)/i` | `LIMIT_EXCEEDED`                                                 |
| Abort by request timeout                                                                       | `TIMEOUT`                                                        |
| Network error mid-request                                                                      | `ENDPOINT_UNREACHABLE`                                           |
| Other non-2xx, or 2xx with an `error` object                                                   | `ENDPOINT_ERROR`                                                 |
| Empty content                                                                                  | `EMPTY_RESPONSE`                                                 |
| `finish_reason: "length"`                                                                      | Return the answer with warning `TRUNCATED` (REQ-020)             |

Endpoint error text is truncated to 300 chars and passed through `redactSecrets` (REQ-018).

### Media-not-processed check: parallel text-only baseline

When `VIDEO_VERIFY_MEDIA` is true (default), send the main request and, concurrently, a baseline request. The baseline has identical messages but the media part removed, `max_tokens: 16`, and the same model.

With `main` and `base` as the reported `usage.prompt_tokens`, `minVideoTokens = max(200, 25 × clipSeconds)`:

| Condition                                                          | Outcome                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| `main − base < minVideoTokens`                                     | `MEDIA_NOT_PROCESSED`, naming the other part formats |
| Either usage missing, or the baseline request fails for any reason | Warning `MEDIA_UNVERIFIED`; the answer is returned   |

A baseline failure never fails the call.

Why it works: both tested providers charged about 90 tokens per video second, so 25/s leaves a wide margin. The text-only baseline cancels each endpoint's fixed overhead: the Antigravity case was 2,074 − ~2,074 ≈ 0, so it fails correctly.

When disabled: no baseline; warning `MEDIA_UNVERIFIED` (REQ-021).

Known limitation, recorded in the README: with a router that falls back between providers, the baseline and the main call can be served by different providers whose overheads differ. That can let an ignored video through. The reported model names are included in `analysis` so the operator can spot it.

### Orchestration order (REQ-017 needs reachability before media work)

`understand_video` handler order:

1. Validate input (zod; `INVALID_INPUT`).
2. Check config: base URL and model present → else `CONFIG_MISSING`.
3. Check ffmpeg availability (cached probe of `ffmpeg -version`; `DEPENDENCY_MISSING`).
4. Acquire a concurrency slot.
5. Run the reachability pre-check.
6. Create a temp dir.
7. Acquire the source.
8. ffprobe.
9. Range checks. `start ≥ end` → `INVALID_INPUT`. An end past the source duration is clamped, with warning `RANGE_CLAMPED`. A missing start means 0, and a missing end means the source duration. An analyzed span over the limit → `LIMIT_EXCEEDED`, with measured and limit seconds and the range hint.
10. Prepare the video.
11. Check the payload size.
12. Send the main and baseline requests.
13. Parse and validate the reply.
14. Build the result.
15. Remove the temp dir in `finally` and release the slot.

One `AbortSignal`, combined from the MCP request signal and per-phase timeouts, is passed to every fetch and child process. Child processes are spawned without a shell and killed on abort (REQ-024).

Per-phase timeouts:

| Phase                  | Timeout                    |
| ---------------------- | -------------------------- |
| Reachability pre-check | 5 s                        |
| yt-dlp metadata        | 60 s                       |
| Download               | 600 s with a 60 s stall    |
| ffmpeg                 | 300 s                      |
| Endpoint request       | `VIDEO_REQUEST_TIMEOUT_MS` |

### Configuration (environment)

| Variable                                                      | Default                       | Validation                                                                                      |
| ------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `VIDEO_BASE_URL`                                              | —                             | http(s) URL; trailing `/` trimmed. Missing → tool returns `CONFIG_MISSING`; server still starts |
| `VIDEO_API_KEY`                                               | —                             | optional; sent as `Authorization: Bearer`                                                       |
| `VIDEO_MODEL`                                                 | —                             | missing → `CONFIG_MISSING`                                                                      |
| `VIDEO_PART_FORMAT`                                           | `image_url`                   | one of the four shapes                                                                          |
| `VIDEO_MAX_DURATION_SECONDS`                                  | `300`                         | integer 1–7200                                                                                  |
| `VIDEO_MAX_UPLOAD_MB`                                         | `15`                          | number 1–100                                                                                    |
| `VIDEO_MAX_DOWNLOAD_MB`                                       | `500`                         | number 1–10000                                                                                  |
| `VIDEO_REQUEST_TIMEOUT_MS`                                    | `180000`                      | integer 5000–900000                                                                             |
| `VIDEO_MAX_CONCURRENCY`                                       | `2`                           | integer 1–16                                                                                    |
| `VIDEO_MAX_OUTPUT_TOKENS`                                     | `8192`                        | integer 256–65536                                                                               |
| `VIDEO_VERIFY_MEDIA`                                          | `true`                        | `true`/`false`                                                                                  |
| `VIDEO_ALLOWED_DIRS`                                          | —                             | `path.delimiter`-separated absolute directories; each must exist; stored as `realpath`          |
| `VIDEO_ALLOW_PRIVATE_NETWORK`                                 | `false`                       | `true`/`false`                                                                                  |
| `VIDEO_FFMPEG_PATH`, `VIDEO_FFPROBE_PATH`, `VIDEO_YTDLP_PATH` | `ffmpeg`, `ffprobe`, `yt-dlp` | executable name or path                                                                         |

Invalid values throw at startup with the variable name and value (REQ-010). MB means 1,000,000 bytes. The payload limit applies to the prepared MP4 bytes, before base64 encoding.

### Local files

Accepted when the source is an absolute path or a `file://` URL, and allowed directories are configured (REQ-007). Resolve with `fs.realpath`, then require `path.relative(allowedRoot, real)` to not start with `..` and not be absolute, for at least one root. On Windows, compare case-insensitively. Reject non-regular files. The file is read in place (not copied) as ffmpeg input.

### Concurrency

A small in-process FIFO semaphore (`VIDEO_MAX_CONCURRENCY`). Waiting calls stay queued and respect cancellation; a cancelled waiter leaves the queue (REQ-025).

### Logging

Use stderr only, as one-line JSON events: `{ event, code, sourceHost, durationS, bytes, ms, promptTokens }`. Logs never contain URLs with query strings, headers, base64, transcripts, or answers (NFR-001, NFR-002). `redactSecrets` covers `Authorization`, `Cookie`, `VIDEO_API_KEY=` and the configured key value itself.

## Affected Areas

### Repository scaffold (root)

`package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `vitest.config.ts`, `vitest.live.config.ts`, `LICENSE` (MIT), `server.json`, `.env.example`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`, `scripts/*.mjs`. Adapted from twitter-mcp. The bin is `video-understanding-mcp` → `dist/cli.js`. In `ci.yml`, the Ubuntu jobs install ffmpeg (`sudo apt-get update && sudo apt-get install -y ffmpeg`) before `npm run check`. The macOS/Windows `package` job runs only `check:install`, which needs no ffmpeg (REQ-023: the server starts without it).

### `src/cli.ts`, `src/index.ts`, `src/server/create-server.ts`

These follow the twitter-mcp entry and server pattern, and the server is named `video-understanding-mcp`. The instructions tell the agent:

- what sources are accepted;
- to pass `start_seconds`/`end_seconds` for long videos or fast motion;
- to call `get_server_info` for limits.

### `src/config/env.ts`

`loadConfig(env): RuntimeConfig` as specified in Configuration.

### `src/errors/video-error.ts`

`VideoError { code, safeMessage, retryable, retryAfterSeconds?, cause? }` plus `redactSecrets(text, extraSecrets?)` and `toVideoError()`.

Codes: `INVALID_INPUT, CONFIG_MISSING, DEPENDENCY_MISSING, SOURCE_UNAVAILABLE, SOURCE_NOT_ALLOWED, INVALID_MEDIA, LIMIT_EXCEEDED, ENDPOINT_UNREACHABLE, ENDPOINT_AUTH, ENDPOINT_RATE_LIMITED, ENDPOINT_ERROR, TIMEOUT, EMPTY_RESPONSE, MEDIA_NOT_PROCESSED, INTERNAL_ERROR`.

### `src/server/input.ts`, `src/server/output.ts`, `src/server/register-tools.ts`

`understand_video` input:

| Field                          | Type                 | Constraint                                                                                             |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `source`                       | string               | required, 1–4096 chars                                                                                 |
| `headers`                      | record string→string | optional, ≤ 20 entries, values ≤ 8192 chars; `Host`, `Content-Length` and `Transfer-Encoding` rejected |
| `question`                     | string               | optional, ≤ 4000 chars                                                                                 |
| `start_seconds`, `end_seconds` | number               | optional, ≥ 0                                                                                          |
| `fps`                          | number               | optional, 0.1–24                                                                                       |

The `understand_video` output schema is the REQ-002 structure with `analysis`:

```ts
{
  configuredModel: string;
  reportedModel: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null } | null;
  sourceDurationSeconds: number;
  analyzedRange: { start: number; end: number };
  partFormat: PartFormat;
  warnings: Array<{ code: string; message: string }>;
}
```

These fields satisfy REQ-016. The `get_server_info` output covers REQ-004:

- `name`, `version`, `tools`;
- `endpoint { host, model, partFormat, apiKeyConfigured }`;
- `limits`, `verifyMedia`, `localFiles { enabled, allowedDirs }`, `allowPrivateNetwork`;
- `dependencies { ffmpeg, ffprobe, ytDlp }`, each `{ available, version }`.

`errorResult` adds the `[CODE]` text prefix and `_meta`. The annotations are `readOnlyHint: true, openWorldHint: true, idempotentHint: false, destructiveHint: false`.

### `src/media/` (new)

- `network-guard.ts` — the BlockList, the IP-literal check, and the undici `Agent` factory.
- `download.ts` — guarded GET, header policy, manual redirects, byte cap with abort, stall timeout, and URL classification.
- `local-file.ts` — allowlist resolution.
- `ytdlp.ts` — metadata and download.
- `ffmpeg.ts` — availability and version probe, ffprobe, the preparation ladder.
- `process.ts` — spawn with abort, timeout, and capped stderr capture.
- `acquire.ts` — dispatches a source string to local, direct, or page acquisition.

### `src/endpoint/` (new)

- `request-shapes.ts` — the part builders and `supportsFps`.
- `prompt.ts` — the system prompt and user text.
- `response-parser.ts` — `parseChatResponse`.
- `client.ts` — the reachability pre-check, `sendChat(body, signal)`, and error classification.
- `media-check.ts` — the baseline comparison.

### `src/analysis/` (new)

- `normalize.ts` — lenient structured parsing and timeline validation and offset.
- `understand.ts` — the orchestrator described in Orchestration order.
- `semaphore.ts`.

### `test/` (new)

Mirrors `src/`, plus:

- `test/fixtures/make-fixtures.ts`, which generates clips with ffmpeg at test time;
- `test/helpers/fake-endpoint.ts`, a local `node:http` server that records requests and replays scripted responses;
- `test/cli/stdio.test.ts`;
- `test/live/*.test.ts`;
- `test/release/*` adapted from twitter-mcp.

### Documentation (root and `docs/`)

- `README.md` — the spec's Documentation obligations, plus the fallback-router limitation of the media check.
- `.env.example`.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`.
- `RELEASE.md`, adapted names.
- `docs/v1-compatibility.md` — the public contract: tool names, inputs, result fields, error codes.
- `docs/release-notes-v1.0.0.md`.

## Implementation Sequence

1. **Scaffold and server info first.** Every later module plugs into the config, error, and output seams, and `check:install` needs a starting server.
2. **The endpoint client next.** It is the riskiest external behavior (shapes, parsing, classification, baseline), and it can be built and tested against the fake endpoint with a pre-made MP4 before acquisition exists.
3. **Then media preparation, the network guard, local files, and yt-dlp, in any order.** They are independent seams behind `acquire.ts`.
4. **Then the orchestrator and the `understand_video` tool**, wiring it all together with limits, concurrency, cancellation, and cleanup.
5. **Then the docs and release metadata.**
6. **Finally the live verification against real endpoints.** It gates 1.0 per the spec's Assumptions.

## Verification

Commands, adapted from twitter-mcp: `npm run check` (format, lint, typecheck, coverage-gated tests, release/package/install checks). `npm run test:live` is opt-in.

| Critical behavior                                                     | Meaningful failure                                                                                              | Evidence                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-public targets refused (REQ-008)                                  | IP literal bypasses lookup; redirect not re-checked; IPv4-mapped IPv6 slips through; private allowed by default | Unit tests on `network-guard`: `127.0.0.1`, `169.254.169.254`, `[::1]`, `[::ffff:10.0.0.1]`, `10.x` literals rejected. A public-host fake resolver returning `10.0.0.5` rejected via the real undici Agent. A redirect test using a local server only reachable with `VIDEO_ALLOW_PRIVATE_NETWORK` toggled, proving off = refused and on = followed |
| Header scope (REQ-006)                                                | Cookies forwarded cross-host                                                                                    | Local servers reached as `localhost` and `127.0.0.1` (different hosts for the policy), with the guard disabled for the test: same-host redirect keeps `Referer`; cross-host redirect arrives with no caller headers                                                                                                                                 |
| Local file allowlist (REQ-007)                                        | `..` traversal or symlink escape; prefix confusion (`/data/videos2`)                                            | Unit tests with a temp tree: traversal, symlink-out, sibling-prefix dir, disabled-by-default, all `SOURCE_NOT_ALLOWED`                                                                                                                                                                                                                              |
| Response tolerance (REQ-019, REQ-018, REQ-020)                        | `[DONE]` trailer breaks parsing; 200-with-error treated as success; array content dropped                       | Table-driven parser tests using the real probe bodies' shapes: plain JSON, JSON + `data: [DONE]`, SSE chunks, fenced content, array content, error object; classification tests per status through `sendChat` against the fake endpoint                                                                                                             |
| Media check (REQ-021)                                                 | Fixed overhead lets ignored video pass; baseline failure fails the call                                         | Fake endpoint scripted with the probe numbers: main 2,074 / baseline 2,074 for a 15 s clip → `MEDIA_NOT_PROCESSED`; main 3,433 / baseline 2,074 → success; baseline 500 → success + `MEDIA_UNVERIFIED`; check disabled → warning                                                                                                                    |
| Request shapes and fps (REQ-014, REQ-015)                             | Wrong JSON shape per format; fps sent where unsupported                                                         | Fake endpoint records bodies; assert each shape's part structure and fps presence/absence + warning                                                                                                                                                                                                                                                 |
| Preparation (REQ-009, REQ-013, REQ-011, REQ-012)                      | Audio dropped; range off by offset; oversize not caught                                                         | ffmpeg-generated fixtures (`testsrc2` + `sine`, 1080p, ~20 s; a no-audio variant; a JPEG; an HTML file): prepared output has an audio stream, height ≤ 480, duration ≈ range; tiny `VIDEO_MAX_UPLOAD_MB` forces `LIMIT_EXCEEDED`; JPEG/HTML → `INVALID_MEDIA`                                                                                       |
| End-to-end tool (REQ-001…REQ-004, REQ-016, REQ-017, REQ-022, REQ-024) | Reachability checked after download; timeline offset wrong; temp files leak on cancel                           | In-memory MCP client calling `understand_video` with a local fixture (allowlisted) against the fake endpoint: structured result, analysis metadata, offset timeline, out-of-range entry dropped; endpoint stopped → `ENDPOINT_UNREACHABLE` and no temp dir created; cancel mid-request → temp dir gone and child processes exited                   |
| Secrets (NFR-001, NFR-002)                                            | Key echoed in endpoint error or logs                                                                            | Fake endpoint echoes the Authorization header in its error body; assert result text and captured stderr contain no key                                                                                                                                                                                                                              |
| Startup without ffmpeg (REQ-023)                                      | Server crashes without ffmpeg                                                                                   | `VIDEO_FFMPEG_PATH=/nonexistent` stdio test: server lists tools, `get_server_info` shows unavailable, `understand_video` → `DEPENDENCY_MISSING`                                                                                                                                                                                                     |
| Packaging (NFR-004)                                                   | Package missing files or bin; fails on Windows/macOS                                                            | Adapted `check:package` / `check:install` in CI's macOS + Windows job                                                                                                                                                                                                                                                                               |
| yt-dlp path (REQ-005)                                                 | Extraction errors misreported; missing tool crashes                                                             | A fake `yt-dlp` executable script in the test (`VIDEO_YTDLP_PATH`) that emits scripted JSON/errors/output files; missing path → `DEPENDENCY_MISSING`                                                                                                                                                                                                |

Live (opt-in, `test:live`, before 1.0):

- **9router:** `image_url` against the operator's endpoint with a short public clip. Expect a correct description and no `MEDIA_NOT_PROCESSED`. Then `video_url` against the same endpoint. Expect `MEDIA_NOT_PROCESSED`, reproducing the real overhead case.
- **OpenRouter:** `image_url` against OpenRouter with a Gemini model (needs the user's OpenRouter key). Expect a correct description. A `video_url` run is optional and needs an OpenRouter balance that allows video requests.
- **yt-dlp:** one real page URL (TikTok), with yt-dlp installed.

Not worth adding: tests of zod field assignment, the semaphore internals beyond queue/cancel behavior, or the prompt wording itself (proven through the live run).

## Risks and Recovery

- **Risk: a fallback router serves the baseline and the main call from different providers.** The media check can then misjudge. _Mitigation:_ the opt-out exists, the reported model names appear in `analysis`, and the README documents the limitation.
- **Risk: yt-dlp's own requests bypass the network guard after the initial host check.** _Mitigation:_ the spec's Documentation obligations state it; page URLs are still checked at the initial host.
- **Risk: model output formats drift.** _Mitigation:_ lenient parsing and the unstructured fallback keep answers flowing, with a warning.
- **Recovery:** nothing is published until the author approves a tag (spec Constraint). Pre-1.0 changes need no migration. After 1.0, the public contract follows `docs/v1-compatibility.md`.
