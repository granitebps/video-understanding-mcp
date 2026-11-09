# Video Understanding MCP Tasks

**Plan:** `plan.md` **Spec:** `spec.md`

## Execution Guard

Stop and report instead of improvising if repository reality materially contradicts this task manifest or its referenced plan, or if completing the work requires a materially different architecture or scope expansion. Ordinary local implementation details may be adapted conservatively within the plan.

Use Node.js ≥ 22.21 (the machine default `node` is 22.14; `/opt/homebrew/bin/node` is 26.4). Use `github.com/granitebps/twitter-mcp` as the reference for every file that the plan says to adapt.

- [x] T001 — Scaffold the package with a working `get_server_info`
  - **Refs:** REQ-004, REQ-010, REQ-015 (config only), REQ-023, REQ-026, NFR-001, NFR-004; Plan > Technical Decisions > Mirror twitter-mcp, Configuration; Affected Areas > Repository scaffold, `src/config/env.ts`, `src/errors/video-error.ts`, `src/server/*`
  - **Depends on:** None
  - **Parallel:** No
  - **Goal:** `npx`-style start serves MCP over stdio with `get_server_info`. Config validation, the error/result conventions, the CI and release scripts, and the package checks work for this package's name.
  - **Scope:**
    - Root config files: `package.json`, tsconfigs, eslint, prettier, vitest configs, `.gitignore`, MIT `LICENSE`, `server.json`.
    - `.github/`, `scripts/*.mjs`, `test/release/*`.
    - `src/cli.ts`, `src/index.ts`, `src/config/env.ts`, `src/errors/video-error.ts`.
    - `src/server/{create-server,register-tools,input,output}.ts`.
    - `src/media/ffmpeg.ts` (availability/version probe only), `src/media/process.ts`.
    - `test/config`, `test/errors`, `test/server`, `test/cli/stdio.test.ts`.
  - **Implementation:**
    - **Package metadata:** copy twitter-mcp's files, then rename to `@granitebps/video-understanding-mcp`, bin `video-understanding-mcp`, and `mcpName` `io.github.granitebps/video-understanding-mcp`. Use MIT and `engines >=22.21.0`. Add the `undici` dependency.
    - **Scripts:** adapt every hard-coded `twitter-mcp` and `TWITTER_*` reference and every tool count in `scripts/*.mjs` and `test/release/*`. `check-install` starts the server with only `VIDEO_BASE_URL` and `VIDEO_MODEL` set, and expects 2 tools.
    - **Config and errors:** `loadConfig` follows Plan > Configuration exactly. A missing base URL or model must not throw. `VideoError`, `redactSecrets` and `toVideoError` follow Plan > Affected Areas.
    - **Error results:** `errorResult` emits a `[CODE] message` text, `structuredContent.error`, and `_meta["video-understanding-mcp/error"]`.
    - **`understand_video`:** register it now with its full input schema, returning `CONFIG_MISSING` / `DEPENDENCY_MISSING` before any other work. The real pipeline lands in T007.
    - **`get_server_info`:** returns the REQ-004 shape, with dependency versions from the cached probes (`ffmpeg -version`, `ffprobe -version`, `yt-dlp --version`, each with a 10 s timeout).
    - **CI:** the Ubuntu jobs in `ci.yml` install ffmpeg before `npm run check`.
  - **Verify:**
    - `npm run check` passes with Node ≥ 22.21.
    - **Startup and server info:** the stdio test spawns `dist/cli.js` with `VIDEO_FFMPEG_PATH=/nonexistent` and an API key set. It lists 2 tools. `get_server_info` reports ffmpeg unavailable and `apiKeyConfigured: true`, and the key value appears nowhere in its output.
    - **Missing config:** `understand_video` without a base URL returns `[CONFIG_MISSING]`.
    - **Invalid config:** `VIDEO_MAX_DURATION_SECONDS=ten` makes the process exit non-zero with a message naming the variable.

  - **Evidence:** `npm run check` PASS on Node 26.4 (format, lint, typecheck, 38 tests with coverage thresholds, release/workflow/package/install checks); stdio test with `VIDEO_FFMPEG_PATH=/nonexistent` lists 2 tools, reports ffmpeg unavailable and no key in output; `VIDEO_MAX_DURATION_SECONDS=ten` exits 1 naming the variable; `[CONFIG_MISSING]` text + `_meta` verified. Dependency probing lives in `src/media/dependencies.ts` instead of `ffmpeg.ts`.

- [x] T002 — Endpoint client: request shapes, response parsing, error classification, media check
  - **Refs:** REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020, REQ-021, NFR-001; Plan > Request shapes, Response parsing, Endpoint reachability and error classification, Media-not-processed check
  - **Depends on:** T001
  - **Parallel:** Yes
  - **Goal:** Given a prepared MP4 path and prompt texts, the endpoint layer builds the right request for each part format, checks reachability, parses every known response form, classifies failures, and runs the parallel baseline check.
  - **Scope:** `src/endpoint/{request-shapes,prompt,response-parser,client,media-check}.ts`, `test/endpoint/*`, `test/helpers/fake-endpoint.ts`
  - **Implementation:**
    - Follow the plan sections referenced above exactly; the thresholds and status lists are decided there.
    - `fake-endpoint.ts` is a `node:http` server that records each request (headers and parsed JSON body) and replays a scripted queue of `{ status, headers, body }` responses.
    - Expose `checkReachable(config, signal)`, `sendChat(config, body, signal)` → `{ text, reportedModel, usage, finishReason }`, and `verifyMediaProcessed(main, baseline, clipSeconds)`.
    - The system prompt text from Plan > Prompt and result contract lives in `prompt.ts`.
  - **Verify:**
    - **Parser:** table-driven tests decode plain JSON; JSON + `data: [DONE]`; SSE delta chunks split mid-content; content as an array of text parts; fenced JSON. A 200 body with an `error` object becomes `ENDPOINT_ERROR`.
    - **Classification against the fake endpoint:**

      | Response                                          | Expected                                                                   |
      | ------------------------------------------------- | -------------------------------------------------------------------------- |
      | 401                                               | `ENDPOINT_AUTH`                                                            |
      | 429 with `Retry-After: 7`                         | `ENDPOINT_RATE_LIMITED`, retry after 7                                     |
      | 413                                               | `LIMIT_EXCEEDED`                                                           |
      | Stalled response past a short timeout             | `TIMEOUT`                                                                  |
      | Empty content                                     | `EMPTY_RESPONSE`                                                           |
      | `finish_reason: "length"`                         | `TRUNCATED` warning                                                        |
      | Closed port                                       | `ENDPOINT_UNREACHABLE`, and the message contains host:port but not the key |
      | Error body that echoes the `Authorization` header | Echo redacted                                                              |

    - **Request shapes:** recorded bodies show the correct part structure for all four formats. `fps` is present for `video_url` and `file` and absent for `image_url` and `input_file`.
    - **Media check:**

      | Main / baseline tokens              | Clip | Expected                       |
      | ----------------------------------- | ---- | ------------------------------ |
      | 2,074 / 2,074                       | 15 s | `MEDIA_NOT_PROCESSED`          |
      | 3,433 / 2,074                       | 15 s | Passes                         |
      | 74 / 74                             | —    | `MEDIA_NOT_PROCESSED`          |
      | Baseline HTTP 500, or usage missing | —    | Passes with `MEDIA_UNVERIFIED` |

  - **Evidence:** 29 endpoint tests PASS: parser (plain JSON, JSON+`data: [DONE]`, split SSE deltas, array content, 200-with-error, noise); classification 401/403/413/400-too-large/500/429+Retry-After/empty/timeout/closed port; key echo redacted; reachability 404 accepted, 502/530 unreachable; all four shapes with fps only on `video_url`/`file`; media check 2074/2074 and 74/74 fail, 3433/2074 passes, missing baseline warns. The `TRUNCATED` warning is raised by the orchestrator from `finishReason` (T007).

- [x] T003 — Media preparation with ffprobe and the ffmpeg ladder
  - **Refs:** REQ-009, REQ-011 (payload), REQ-012 (clip), REQ-013; Plan > ffmpeg preparation ladder
  - **Depends on:** T001
  - **Parallel:** Yes
  - **Goal:** Any local media file can be probed (duration, streams) and turned into a prepared MP4 for a given range within the payload limit, keeping audio, or fails with `INVALID_MEDIA` / `LIMIT_EXCEEDED`.
  - **Scope:** `src/media/ffmpeg.ts` (probe and prepare added to T001's availability probe), `src/media/process.ts`, `test/fixtures/make-fixtures.ts`, `test/media/ffmpeg.test.ts`
  - **Implementation:**
    - Follow the ladder and the flags in the plan.
    - `make-fixtures.ts` generates these into a temp dir once per test run:
      - a 1080p, 20 s clip with a `testsrc2` video and `sine` audio;
      - the same clip without audio;
      - a JPEG;
      - an HTML file.
    - All child processes go through `process.ts`: spawned without a shell, killed on abort, with stderr capped at 64 KB.
  - **Verify:**
    - **Prepared clip:** preparing the 1080p fixture for range 5–15 yields an MP4 whose ffprobe shows height ≤ 480, an audio stream, and a duration of 10 ± 0.5 s.
    - **No audio:** the no-audio fixture prepares without error.
    - **Not video:** the JPEG and the HTML file → `INVALID_MEDIA`.
    - **Oversize:** a payload limit of 0.01 MB → `LIMIT_EXCEEDED`, with the measured size, the limit and the range hint.
    - **Cancellation:** aborting mid-encode leaves no running ffmpeg process.

  - **Evidence:** 7 ffmpeg tests PASS on generated fixtures: range 5–15 of a 1080p clip → ≤480p with audio, 10±0.5 s; no-audio clip prepares; JPEG (ffprobe `image2`, detected by format name) and HTML → `INVALID_MEDIA`; 10 KB limit → `LIMIT_EXCEEDED` with range hint after both ladder attempts; abort kills ffmpeg (no matching process left).

- [x] T004 — Guarded downloads: network restriction, header scope, byte cap, URL classification
  - **Refs:** REQ-006, REQ-008, REQ-011 (download cap), NFR-001; Plan > Use `undici` for downloads, Classify URL sources
  - **Depends on:** T001
  - **Parallel:** Yes
  - **Goal:** A URL source is either streamed to disk as direct media under the byte cap, identified as a page URL, or refused. Non-public targets, including through redirects and IP literals, are never contacted unless allowed by config. Caller headers never leave the original host.
  - **Scope:** `src/media/{network-guard,download}.ts`, `test/media/network-guard.test.ts`, `test/media/download.test.ts`
  - **Implementation:**
    - Use the BlockList ranges, the IP-literal pre-check, the undici `Agent` `connect.lookup` hook (`all: true`), manual redirects (≤ 5), the header rule, and the classification rule from the plan.
    - Make the DNS resolver injectable, so tests can map a public-looking hostname to a private address.
    - On an upstream non-2xx: `SOURCE_UNAVAILABLE`, naming the status.
    - On exceeding `VIDEO_MAX_DOWNLOAD_MB`: abort the stream and delete the partial file, then `LIMIT_EXCEEDED`.
  - **Verify:**
    - **Refused targets (`SOURCE_NOT_ALLOWED`, and the test server records no connection):**
      - `http://127.0.0.1:<port>/a.mp4`, `http://[::1]/…`, `http://[::ffff:10.0.0.1]/…`, `http://169.254.169.254/latest/meta-data`;
      - a hostname the injected resolver maps to `10.0.0.5`;
      - a public URL whose redirect points at a private address.
    - **Private network allowed:** with `VIDEO_ALLOW_PRIVATE_NETWORK=true`, the local server is reached.
    - **Header scope:** a redirect from `localhost` to `127.0.0.1` drops the `Cookie` header; a same-host redirect keeps `Referer`.
    - **Download outcomes:** an expired-URL 403 → `SOURCE_UNAVAILABLE` naming 403; an over-cap body → `LIMIT_EXCEEDED` with no partial file left; a `text/html` response is classified as a page.

  - **Evidence:** 28 tests PASS: blocklist covers loopback/private/link-local/CGNAT/ULA/mapped (dotted and hex) and allows public v4/v6; IP-literal `127.0.0.1`, `[::1]`, `[::ffff:10.0.0.1]`, `169.254.169.254` refused before connecting; hostname resolving to `10.0.0.5` refused with zero server hits (real undici Agent lookup hook); redirect to a private literal refused; private allowed by config reaches the server; `localhost`→`127.0.0.1` redirect drops Cookie and Referer, same-host redirect keeps Referer; 403 → `SOURCE_UNAVAILABLE` naming 403; over-cap body → `LIMIT_EXCEEDED` with no partial file; `text/html` → page.

- [x] T005 — Local file allowlist
  - **Refs:** REQ-007; Plan > Local files
  - **Depends on:** T001
  - **Parallel:** Yes
  - **Goal:** Absolute paths and `file://` URLs are accepted only when their real path lies inside a configured allowed directory; local input is disabled when none is configured.
  - **Scope:** `src/media/local-file.ts`, `test/media/local-file.test.ts`
  - **Implementation:** `realpath` the input, then check it against each stored root with `path.relative`. Reject non-regular files. Return the resolved path for ffmpeg input. The "disabled" error message names `VIDEO_ALLOWED_DIRS`.
  - **Verify:** with a temp tree (allowed dir, sibling `allowed2/`, an outside file, and a symlink inside pointing outside):
    - an inside file is accepted;
    - each of these → `SOURCE_NOT_ALLOWED`, with no read: `allowed/../outside`, the symlink, `allowed2/x.mp4`, a directory, and any path when no directory is configured.

  - **Evidence:** 8 tests PASS: inside file accepted as path and `file://` URL; `allowed/../outside`, symlink escaping the root, sibling `allowed2/`, a directory, and a missing file → `SOURCE_NOT_ALLOWED`; no configured directory → `SOURCE_NOT_ALLOWED` naming `VIDEO_ALLOWED_DIRS`.

- [x] T006 — Page URLs through yt-dlp
  - **Refs:** REQ-005, REQ-008 (page host), REQ-011 (pre-download duration); Plan > yt-dlp in two steps
  - **Depends on:** T004
  - **Parallel:** Yes
  - **Goal:** A URL classified as a page is resolved by yt-dlp. Over-long videos are refused before download, and a missing tool or extraction failure is reported with the right code.
  - **Scope:** `src/media/ytdlp.ts`, `src/media/acquire.ts`, `test/media/ytdlp.test.ts`, `test/helpers/fake-yt-dlp.mjs`
  - **Implementation:**
    - Build `acquire.ts` to dispatch `source` to local (T005), direct, or page (T004 classification, then yt-dlp). T005's module is consumed through its exported function; until T005 lands, stub it behind the same signature.
    - Use the two-step yt-dlp flow and flags from the plan, passing `--ffmpeg-location` from config.
    - `fake-yt-dlp.mjs` is a Node script used via `VIDEO_YTDLP_PATH`. Its behavior is selected by the URL path:
      - `-J` prints scripted JSON or exits 1 with `ERROR: Unsupported URL`;
      - a download writes a fixture copy to the `-o` path, or writes nothing (over max filesize).
  - **Verify:**

    | Case                                                  | Expected                                                                      |
    | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
    | Fake returns a duration of 1,500 with a 300 s limit   | `LIMIT_EXCEEDED` before the download step runs (the fake records invocations) |
    | Unsupported URL                                       | `SOURCE_UNAVAILABLE` carrying the stderr reason                               |
    | No output file                                        | `LIMIT_EXCEEDED`                                                              |
    | `VIDEO_YTDLP_PATH=/nonexistent` with an HTML page URL | `DEPENDENCY_MISSING` naming yt-dlp and suggesting a direct media URL          |
    | Normal run                                            | The acquired file is the fixture                                              |

  - **Evidence:** 6 tests PASS with a fake yt-dlp: page URL (HTML via the guarded GET) downloaded with `--max-filesize`/`--merge-output-format` and no caller headers passed; 1,500 s duration → `LIMIT_EXCEEDED` with no download invocation; `ERROR: Unsupported URL` → `SOURCE_UNAVAILABLE` carrying the reason; no output file → `LIMIT_EXCEEDED`; missing yt-dlp → `DEPENDENCY_MISSING` suggesting a direct media URL; relative path → `INVALID_INPUT`.

- [x] T007 — `understand_video` end to end
  - **Refs:** REQ-001, REQ-002, REQ-003, REQ-012, REQ-016, REQ-017, REQ-022, REQ-024, REQ-025, REQ-026, NFR-002; Plan > Orchestration order, Prompt and result contract, Concurrency, Logging
  - **Depends on:** T002, T003, T004, T005, T006
  - **Parallel:** No
  - **Goal:** The tool runs the full pipeline in the planned order and returns the validated REQ-002 result with `analysis`, or a coded error. It cleans up on every exit path and bounds concurrent work.
  - **Scope:** `src/analysis/{understand,normalize,semaphore}.ts`, `src/server/register-tools.ts` (wire the handler), `src/server/create-server.ts` (instructions), `test/analysis/*`, `test/server/understand.test.ts`
  - **Implementation:**
    - Follow the orchestration order and the phase timeouts.
    - `normalize.ts` does the lenient field parsing, the unstructured fallback, timeline drop/offset/sort, and the warnings.
    - The temp dir comes from `fs.mkdtemp(os.tmpdir()/video-understanding-mcp-)`, removed with `fs.rm(…, { recursive: true, force: true })` in `finally`.
    - The FIFO semaphore removes cancelled waiters.
    - Stderr logging follows Plan > Logging.
    - The tool description tells agents to use `start_seconds`/`end_seconds` for long videos or fast motion, and states the effect of `fps`.
  - **Verify:** use an in-memory MCP client with a local allowlisted fixture against the fake endpoint.
    - **Happy path:** a scripted JSON reply (fenced, with a `[DONE]` trailer) yields every REQ-002 field. `analysis` carries the configured and reported model, usage, durations, range, part format and warnings.
    - **Timeline:** with range 5–15, a model timeline entry at 3 s becomes 8 s, and an entry at 42 s is dropped with a warning.
    - **Unstructured reply:** a prose reply → `answer` = the prose, plus the `STRUCTURED_FIELDS_UNAVAILABLE` warning.
    - **Unreachable endpoint:** with the endpoint stopped → `ENDPOINT_UNREACHABLE`, and no `video-understanding-mcp-*` temp dir is created.
    - **Cancellation:** cancelling during a delayed endpoint response leaves no temp dir and no child process.
    - **Concurrency:** with `VIDEO_MAX_CONCURRENCY=1`, a second call waits until the first finishes.
    - **Ranges:** `start=90, end=60` → `INVALID_INPUT`; an end past the source duration → `RANGE_CLAMPED`.
    - **Logs:** captured stderr contains no base64, transcript or answer text.

  - **Evidence:** `npm run check` PASS (133 tests; coverage 95.4% statements / 84.7% branches; package/install checks). Through an in-memory MCP client and the fake endpoint: fenced reply + `[DONE]` → all REQ-002 fields and `analysis` (configured/reported model, usage, range, format); timeline 3 s → 8 s with range 5–15, 42 s dropped with warning; prose → `STRUCTURED_FIELDS_UNAVAILABLE`; equal main/baseline tokens → `[MEDIA_NOT_PROCESSED]`; `finish_reason: length` → `TRUNCATED`, fps on `image_url` → `FPS_NOT_APPLIED`; closed port → `[ENDPOINT_UNREACHABLE]` with no temp dir; 90/60 → `INVALID_INPUT`, end 100 on a 20 s clip → `RANGE_CLAMPED`; 20 s over a 5 s limit → `LIMIT_EXCEEDED`; cancel mid-request leaves no temp dir or child process; concurrency 1 serializes calls; logs hold no base64, transcript, answer, or key. Found and fixed during T007: the baseline request now accepts an empty reply (`sendChat` `allowEmpty`), since a 16-token baseline from a thinking model can legitimately return no text.

- [x] T008 — Public documentation and release metadata
  - **Refs:** Spec > Documentation obligations, Constraints; NFR-004; Plan > Affected Areas > Documentation
  - **Depends on:** T007
  - **Parallel:** No
  - **Goal:** The repository can be reviewed and released like twitter-mcp. A new user can install, configure any of the four part formats, and understand privacy, rights, limits and known limitations.
  - **Scope:** `README.md`, `.env.example`, `server.json` (environment variables), `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `RELEASE.md`, `docs/v1-compatibility.md`, `docs/release-notes-v1.0.0.md`
  - **Implementation:**
    - Adapt the twitter-mcp documents.
    - The README covers every Documentation obligation in the spec: dependencies with install commands; data sent to the endpoint; the part formats with their known providers; tested endpoints and models; the user's responsibility for content rights; the yt-dlp network-guard caveat; the fallback-router caveat of the media check; and every setting with its default.
    - `.env.example` lists every variable from Plan > Configuration with its default.
    - `server.json` declares `VIDEO_BASE_URL`, `VIDEO_MODEL` and `VIDEO_API_KEY` (marked secret), plus the optional variables.
    - `docs/v1-compatibility.md` lists the public contract: tool names, inputs, result fields and error codes.
    - Keep every file provider-neutral: no personal router, tunnel or subscription account named.
  - **Verify:**
    - `npm run check` passes, including `check:release` (metadata versions agree) and `check:package`. The packed file list contains `dist`, README, LICENSE, `package.json` and `server.json`, with no `.env`, tests or `docs/ai`.
    - **Settings coverage:** every variable read in `src/config/env.ts` appears in both `.env.example` and the README.
    - **Provider neutrality:** a search for `20128|cloudflare|tunnel|antigravity|sumopod` (case-insensitive) in the repository, excluding `docs/ai/`, returns nothing.

  - **Evidence:** `npm run check` PASS including `check:release` and `check:package` (packed files: `dist/`, README, LICENSE, package.json, server.json only); every `VIDEO_*` variable read in `src/config/env.ts` appears in `.env.example` and README (scripted check, no gaps); case-insensitive search for `20128|cloudflare|tunnel|antigravity|sumopod` outside `docs/ai/` returns nothing. README example uses neutral content, not the probe videos.

- [x] T009 — Live verification against real endpoints
  - **Refs:** Spec > Assumptions (default `image_url`, verified live); REQ-005, REQ-013, REQ-015, REQ-021; Plan > Verification > Live
  - **Depends on:** T007
  - **Parallel:** No (edits the README that T008 writes)
  - **Goal:** There is recorded evidence that the default `image_url` format works through two real endpoints, that the media check catches a real ignored-video case, and that a real page URL works through yt-dlp.
  - **Scope:** `test/live/*.test.ts`, `vitest.live.config.ts`, the README's "Tested with" section
  - **Implementation:**
    - Live tests read their endpoint, key, model and format from `VIDEO_LIVE_*` variables, and skip when those are unset.
    - The clip is a public short-form video URL supplied through `VIDEO_LIVE_SOURCE`. No video is committed.
    - Needs the user's approval and credentials:
      - the operator's OpenAI-compatible router (`image_url`);
      - an OpenRouter key with a Gemini model (`image_url`; a `video_url` run is optional and needs an OpenRouter balance that allows video);
      - yt-dlp installed locally (`brew install yt-dlp`).
  - **Verify:**
    - **Router, `image_url`:** a correct description, and no `MEDIA_NOT_PROCESSED`.
    - **Router, `video_url`:** `MEDIA_NOT_PROCESSED`.
    - **OpenRouter, `image_url`:** a correct description.
    - **yt-dlp:** a TikTok page URL analyzed end to end.
    - Record the endpoints and models that passed, and the formats that were caught as ignored, in the README's "Tested with" section.
  - **Progress (task still open):** live suite `test/live/endpoint.test.ts` written. 9router `video-understanding` combo, 15 s local clip: `image_url` → correct description, no warnings (3,687 prompt tokens); `video_url` → `MEDIA_NOT_PROCESSED` (0 extra tokens); `file` → `MEDIA_NOT_PROCESSED` (151 extra tokens), and with the check off it described a different video, so the check was right. README "Tested with" updated. OpenRouter `google/gemini-3.8-flash`: `image_url` → correct description incl. all price lines (1,685 prompt tokens, no warnings); `video_url` → HTTP 402 "requires at least $1.00 in balance for video" (account balance, not a format result). yt-dlp 2026.10.26: TikTok page URL resolved, downloaded, and analyzed correctly via OpenRouter `image_url`. The OpenRouter `video_url` release gate was dropped by the 2026-11-09 default-shape decision (OpenRouter needs a $5 top-up for video).

  - **Evidence:** 9router: `image_url` correct; `video_url` and `file` caught as `MEDIA_NOT_PROCESSED` (the `file` answer described a different video with the check off). OpenRouter `google/gemini-3.8-flash`: `image_url` correct, including as the default. yt-dlp 2026.10.26: TikTok page URL analyzed end to end. Results recorded in the README "Tested with" section.

- [x] T010 — Make `image_url` the default request format
  - **Refs:** REQ-015; Spec > Assumptions (2026-11-09 default-shape decision); Plan > Request shapes, Configuration
  - **Depends on:** T008
  - **Parallel:** No
  - **Goal:** With `VIDEO_PART_FORMAT` unset, the server sends video as an `image_url` part, and every document, example and test states `image_url` as the default. The other three formats keep working when selected.
  - **Scope:** `src/config/env.ts`, `server.json`, `.env.example`, `README.md` (request-format table, configuration table, Tested with), `test/live/endpoint.test.ts` (default format), `test/config/env.test.ts`, `test/server/server.test.ts`, `test/server/understand.test.ts`
  - **Implementation:** Change the fallback in `readPartFormat` to `"image_url"`. Move the "(default)" marker in the README's request-format table to `image_url` and add OpenRouter to its known users. Update the configuration table, `.env.example`, and the `server.json` default. Tests that rely on the default expect `image_url`, and the end-to-end request assertion checks for an `image_url` part. Tests that pass a format explicitly stay unchanged.
  - **Verify:** `npm run check` passes. With an empty environment, `loadConfig` returns `partFormat: "image_url"`, and the end-to-end test's recorded request contains `"type":"image_url"` with a `data:video/mp4;base64,` URL. A search for `video_url` as a default ("(default)", `default: "video_url"`, `?? "video_url"`) outside `docs/ai/` returns nothing.

  - **Evidence:** `npm run check` PASS twice in a row (133 tests, coverage 95.4%/84.7%, package/install checks); `loadConfig({})` returns `image_url`; end-to-end recorded request contains `"type":"image_url"` with a data URL; live OpenRouter run with `VIDEO_LIVE_PART_FORMAT` unset used `image_url` and passed (1,685 prompt tokens, no warnings); no `video_url` default remains outside `docs/ai/`. The server-info and stdio tests now point `yt-dlp` at a nonexistent path: under the full parallel run the host's real yt-dlp start-up exceeded the 5 s test timeout, and those tests do not exercise yt-dlp.

## Requirement Accounting

- REQ-001 → T007
- REQ-002 → T007
- REQ-003 → T002 (prompt), T009 (observed)
- REQ-004 → T001
- REQ-005 → T006, T009
- REQ-006 → T004
- REQ-007 → T005
- REQ-008 → T004, T006
- REQ-009 → T003
- REQ-010 → T001
- REQ-011 → T003, T004, T006, T007
- REQ-012 → T003, T007
- REQ-013 → T003, T009
- REQ-014 → T002
- REQ-015 → T001 (config), T002 (shapes), T010 (default `image_url`), T009 (live)
- REQ-016 → T002, T007
- REQ-017 → T002, T007
- REQ-018 → T002
- REQ-019 → T002
- REQ-020 → T002
- REQ-021 → T002, T009
- REQ-022 → T007
- REQ-023 → T001
- REQ-024 → T003, T007
- REQ-025 → T007
- REQ-026 → T001
- NFR-001 → T001, T002, T004
- NFR-002 → T007
- NFR-003 → T001 (offline suite structure), with each task's tests using generated fixtures and the fake endpoint; T009 is opt-in
- NFR-004 → T001, T008
