# Video Understanding MCP Specification

## Context

AI agents driven through MCP clients cannot watch video. Given a video URL or file, an agent today sees at most a caption or a page description, so tasks such as "summarize this review", "what products are shown", or "check the form in this workout" fail or are answered by guessing.

Some multimodal models (notably Gemini) accept a whole video, including its audio, and can describe speech, visuals, and on-screen text together. Many users reach these models through OpenAI-compatible chat completions endpoints: hosted gateways, self-hosted routers, or local servers. Those endpoints disagree on how a video must be attached to a request, and several silently ignore a video sent in a shape they do not recognize while still returning a normal answer.

This work delivers a public, provider-neutral MCP server, published to npm as `@granitebps/video-understanding-mcp`, that takes a video source and a question, prepares the video, sends it to an operator-configured OpenAI-compatible endpoint, and returns a validated, structured answer.

Feasibility was established before this spec (2026-11-09) against one OpenAI-compatible router, with Gemini 3.x Flash models and two public short-form videos:

- a 95 s Indonesian speech review: every tested model produced an accurate transcript, including an uncommon brand name that local Whisper transcription got wrong;
- a 15 s music-only promo: models returned no speech (no hallucinated transcript) and read all prices and products from the screen;
- a 480p re-encode of the 95 s clip was about 2.3 MB and cost about 8.7k–10.7k input tokens; the 15 s clip cost about 3.4k;
- that router required the video as an `image_url` part with a `data:video/mp4;base64,` URL, appended `data: [DONE]` after a non-streamed JSON body, and the models usually wrapped JSON output in a Markdown code fence;
- sending the same 15 s clip as a `video_url` part returned HTTP 200 with confident descriptions of unrelated videos on both upstream providers. One reported 74 input tokens. The other reported 2,074, because it adds about 2,000 tokens of fixed overhead to every request (the clip with the video attached cost 3,433). The router's source (decolua/9router, commit `1339107`, 2026-11-08) shows its OpenAI-to-Gemini translator has no `video_url` branch; the other provider, reached through a generic OpenAI-compatible connection, probably ignores `video_url` itself.

Public documentation (OpenRouter, Alibaba Model Studio, Tencent TokenHub, LiteLLM, Requesty, Google Gemini API) shows at least four request shapes for video on OpenAI-compatible endpoints, and that frame-rate control is available only on some of them. Gemini samples video at 1 frame per second by default and recommends inline requests stay under 20 MB in total.

## Goals

- An agent can ask a question about a video and get a useful, structured answer, whatever the video's purpose (explainer, review, promo, workout, tutorial).
- Works with any OpenAI-compatible endpoint whose model accepts video, using a configurable request shape.
- Never presents an answer as video-based when the endpoint did not actually process the video.
- Safe to run as a public package: no secret leakage, no arbitrary local file exfiltration, no use as a network pivot.
- Packaged, documented, and released the same way as the author's existing MCP packages (`@granitebps/youtube-mcp`, `@granitebps/twitter-mcp`).

## Non-Goals

- Bundling or auto-installing ffmpeg or yt-dlp.
- Choosing, routing between, or falling back across models or providers. Fallback, when wanted, is the endpoint's responsibility (for example a router combo).
- Identifying which upstream provider served a request beyond what the endpoint reports.
- Native (non-OpenAI-compatible) provider APIs, file-upload APIs (such as the Gemini Files API), or remote-URL pass-through of the video to the endpoint.
- Automatically splitting long videos into chunks.
- Caching results or media between calls.
- HTTP/streamable transport. The first release is stdio only.
- Listing or discovering videos (profiles, search). Sources come from the caller, typically other MCP servers.

## Sources

- `grill-me` decisions, 2026-11-09: fixed result structure; `video_url` default request shape (superseded the same day, see below); local files off by default; caller headers limited to the original host; 300 s default duration; media-not-processed check fails by default, can be turned off, and accounts for endpoint overhead.
- Default-shape decision, 2026-11-09 (after live verification): `image_url` becomes the default request shape; the `video_url` live release gate is dropped.
- Conversation decisions, 2026-11-09: MCP server over an OpenAI-compatible endpoint; npm package; TypeScript; ffmpeg required and yt-dlp optional, both user-installed; accept any OpenAI-compatible endpoint and handle provider differences; default limits adjustable by configuration; MIT license; provider-neutral public scope; generic "base URL is not reachable" error.
- Feasibility probe results summarized in Context.
- `@granitebps/youtube-mcp` and `@granitebps/twitter-mcp` repositories: packaging, release, configuration, and error-reporting conventions.
- Public provider documentation listed in Context.

## Actors

- **Agent** — the MCP client's model, calling tools.
- **Operator** — the person installing and configuring the server (endpoint, key, model, limits, allowed directories).
- **Endpoint** — the OpenAI-compatible chat completions service the operator configures.

## Requirements

### Tool surface

### REQ-001 — Understand-video tool

The server MUST expose a tool that accepts a video source, an optional natural-language question, and an optional time range (start and end, in seconds), and returns an answer about that video.

#### Scenario — Question answered

Given a reachable endpoint and a valid video source  
When the agent calls the tool with the question "What products are shown and at what price?"  
Then the result contains an answer to that question derived from the video

#### Scenario — No question

Given a reachable endpoint and a valid video source  
When the agent calls the tool without a question  
Then the result contains a general description of the video covering what is shown, what is said, and notable on-screen text

### REQ-002 — Structured result

A successful result MUST contain, as structured output with an equivalent text rendering:

- `answer` — the response to the question, or the general description when no question was given;
- `summary` — a short description of the video;
- `speech` — whether speech was detected, its language when detected, and a transcript in the original language;
- `on_screen_text` — text visible in the video;
- `timeline` — notable moments, each with a start time in seconds relative to the source video and a description;
- `analysis` — metadata defined in REQ-016.

When the endpoint's answer cannot be parsed into these fields but contains usable text, the server MUST return that text as `answer`, leave the other content fields empty, and add a warning saying the structured fields are unavailable.

#### Scenario — Music-only video

Given a video with music and no spoken words  
When the tool analyzes it  
Then `speech` reports no speech detected and the transcript is empty

#### Scenario — Unstructured model reply

Given the endpoint returns prose instead of the requested structure  
When the tool completes  
Then `answer` contains that prose and a warning states that structured fields are unavailable

### REQ-003 — Answer language

The `answer` and `summary` SHOULD be in the language of the question, or English when no question was given. The transcript and on-screen text MUST be reported in their original language, not translated.

### REQ-004 — Server info tool

The server MUST expose a tool that reports, without secrets: package version, configured base URL host, configured model, request shape, effective limits, whether local files are enabled and which directories are allowed, and the detected availability and version of ffmpeg and yt-dlp.

#### Scenario — Secret not exposed

Given an API key is configured  
When the agent calls the server info tool  
Then the result shows that a key is configured but not its value

### Video sources

### REQ-005 — Page URL source

The tool MUST accept an http(s) page URL for a site supported by yt-dlp (for example a TikTok, YouTube, or X post URL) and analyze the video it resolves to.

#### Scenario — yt-dlp not installed

Given yt-dlp is not available  
When the agent passes a page URL that is not a direct media file  
Then the call fails with code `DEPENDENCY_MISSING`, names yt-dlp, says how to install it, and suggests passing a direct media URL instead

#### Scenario — Site not supported or video unavailable

Given yt-dlp cannot extract a video from the page  
When the agent passes that page URL  
Then the call fails with code `SOURCE_UNAVAILABLE` and a short reason taken from the extraction failure

### REQ-006 — Direct media URL source with headers

The tool MUST accept a direct http(s) media URL with optional request headers (for example `Referer`, `User-Agent`, `Cookie`) supplied by the caller, as returned by scraper MCP servers.

Caller-supplied headers MUST be sent only to the host of the URL the caller passed. They MUST be kept on redirects to the same host and MUST NOT be sent after a redirect to a different host.

#### Scenario — Cross-host redirect drops headers

Given the caller passes a media URL on host A with a `Cookie` header  
When host A redirects to host B  
Then the request to host B carries no caller-supplied headers

#### Scenario — Same-host redirect keeps headers

Given the caller passes a media URL on host A with a `Referer` header  
When host A redirects to another path on host A  
Then the redirected request still carries the `Referer` header

#### Scenario — Expired media URL

Given a direct media URL whose signature has expired  
When the agent passes it  
Then the call fails with code `SOURCE_UNAVAILABLE` and states the HTTP status returned by the media host

#### Scenario — Headers required

Given a media host that rejects requests without a `Referer` header  
When the agent passes the URL together with the `Referer` header  
Then the download succeeds

### REQ-007 — Local file source

The tool MUST accept a local file path only when the operator has configured one or more allowed directories and the path, after resolving symbolic links and relative segments, is inside one of them. Local file input MUST be disabled when no allowed directory is configured.

#### Scenario — Path outside allowed directories

Given allowed directory `/data/videos`  
When the agent passes `/data/videos/../../etc/passwd` or a symlink under `/data/videos` that points outside it  
Then the call fails with code `SOURCE_NOT_ALLOWED` and no file content is read or sent

#### Scenario — Local files disabled

Given no allowed directory is configured  
When the agent passes a local path  
Then the call fails with code `SOURCE_NOT_ALLOWED` and says how the operator enables local files

### REQ-008 — Network target restriction

For media the server downloads itself, the server MUST refuse to connect to loopback, private, link-local, and other non-public addresses, checking the resolved address of the initial URL and of every redirect. For page URLs, the server MUST apply the same check to the page URL's host before extraction. The operator MAY explicitly allow non-public targets through configuration. This restriction MUST NOT apply to the operator-configured endpoint base URL.

#### Scenario — Private address refused

Given default configuration  
When the agent passes `http://169.254.169.254/latest/meta-data` or `http://127.0.0.1:8080/video.mp4`  
Then the call fails with code `SOURCE_NOT_ALLOWED` and no request is made to that address

#### Scenario — Redirect to private address refused

Given a public URL that redirects to `http://10.0.0.5/video.mp4`  
When the agent passes the public URL  
Then the call fails with code `SOURCE_NOT_ALLOWED`

#### Scenario — Local endpoint allowed

Given the operator configured the endpoint base URL `http://127.0.0.1:8000/v1`  
When a call is made with a public video source  
Then the request to the endpoint is made normally

### REQ-009 — Not a video

When the source has no video stream, the call MUST fail with code `INVALID_MEDIA`.

#### Scenario — Image or HTML passed as media

Given a direct URL that returns an HTML page or a JPEG  
When the agent passes it as a media URL  
Then the call fails with code `INVALID_MEDIA`

### Limits and preparation

### REQ-010 — Configurable limits

The server MUST enforce these limits, each adjustable by the operator, with these defaults:

| Limit                                      | Default                                |
| ------------------------------------------ | -------------------------------------- |
| Maximum analyzed duration                  | 300 seconds                            |
| Maximum video payload sent to the endpoint | 15 MB, measured before base64 encoding |
| Maximum source download size               | 500 MB                                 |
| Endpoint request timeout                   | 180 seconds                            |

An invalid limit value MUST stop the server at startup with a message naming the setting.

#### Scenario — Invalid configuration

Given the operator sets the maximum duration to `ten`  
When the server starts  
Then it exits with an error naming the duration setting and the invalid value

### REQ-011 — Over-limit guidance

When the analyzed range exceeds the maximum duration, or the prepared video exceeds the maximum payload, the call MUST fail before contacting the endpoint with code `LIMIT_EXCEEDED`, stating the measured value, the limit, and that the agent can pass a shorter start/end range.

When the source download exceeds the maximum download size, the call MUST stop downloading and fail with code `LIMIT_EXCEEDED`.

#### Scenario — Long video

Given a 25-minute video and default limits  
When the agent calls the tool without a range  
Then the call fails with `LIMIT_EXCEEDED`, reports about 1500 s against a 300 s limit, and suggests passing start and end

#### Scenario — Range within limit

Given the same 25-minute video  
When the agent passes start 300 and end 420  
Then only that 120-second range is analyzed

### REQ-012 — Time range

When a range is given, only that range MUST be sent to the endpoint. Timeline times in the result MUST be relative to the start of the source video, not the clipped range. Start MUST be less than end, and a range extending past the source duration MUST be clamped to the source duration and reported in a warning.

#### Scenario — Offset timestamps

Given the agent passes start 60 and end 90  
When the model reports a moment 5 seconds into the clip  
Then the timeline entry's start time is 65

#### Scenario — Invalid range

When the agent passes start 90 and end 60  
Then the call fails with code `INVALID_INPUT`

### REQ-013 — Prepared video keeps speech

The video sent to the endpoint MUST retain the source's audio track when one exists. The server MUST reduce the video's size before sending it, while keeping speech intelligible and typical on-screen text legible, so that a short-form video of about 95 seconds fits the default payload limit with room to spare.

#### Scenario — 95-second review

Given a 95-second 1080p short-form video with speech  
When it is prepared  
Then the payload is under 15 MB and the transcript in the result reflects the spoken words

### REQ-014 — Frame rate

The tool MUST accept an optional sampling rate (frames per second). When the configured request shape supports a sampling rate, the server MUST pass it to the endpoint. When it does not, the server MUST still analyze the video and add a warning that the sampling rate was not applied. The tool description MUST tell agents that, for fast motion, analyzing a short range gives more detail.

#### Scenario — Unsupported shape

Given the request shape is the `image_url` data-URL shape  
When the agent passes fps 4  
Then the result contains a warning that fps was not applied

### Endpoint interaction

### REQ-015 — Configurable endpoint and request shape

The operator MUST be able to configure the endpoint base URL, an optional API key, the model name, and the request shape used to attach the video. Supported request shapes MUST include:

| Shape                                                          | Known users                                                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `video_url` part with a data URL                               | OpenRouter, Alibaba Model Studio (Qwen), Tencent TokenHub, vLLM                                                                        |
| `image_url` part with a `data:video/mp4;base64,` URL (default) | OpenRouter; OpenAI-compatible routers that translate image-typed parts by their data-URL MIME type (for example 9router's Gemini path) |
| `file` part with `file_data` data URL                          | LiteLLM (Gemini, vLLM)                                                                                                                 |
| `input_file` part with `file_data` and MIME type               | Requesty                                                                                                                               |

The model name MAY be a router alias (for example a combo name) and is sent unchanged.

#### Scenario — Missing endpoint configuration

Given no base URL or no model is configured  
When the agent calls the understand-video tool  
Then the call fails with code `CONFIG_MISSING` naming the missing setting, and the server info tool still works

### REQ-016 — Analysis metadata

Each successful result's `analysis` MUST include: the configured model, the model name reported by the endpoint (or null), token usage reported by the endpoint (or null), the source duration, the analyzed range, the request shape used, and a list of warnings. The server MUST NOT claim to know which upstream provider served the request.

### REQ-017 — Base URL not reachable

When the endpoint base URL cannot be reached (connection refused, DNS failure, connection timeout, TLS failure, or a gateway reporting its origin unreachable), the call MUST fail with code `ENDPOINT_UNREACHABLE` and a message that the configured base URL is not reachable, including the base URL's scheme, host, and port but never the API key. The server MUST detect this before downloading or preparing the video.

#### Scenario — Endpoint down

Given the endpoint is not running  
When the agent calls the tool with a valid source  
Then the call fails with `ENDPOINT_UNREACHABLE`, the message says the base URL is not reachable, and no video is downloaded

### REQ-018 — Endpoint error classification

Endpoint failures MUST be reported with distinct codes:

| Condition                                                                 | Code                    |
| ------------------------------------------------------------------------- | ----------------------- |
| Authentication rejected (HTTP 401/403)                                    | `ENDPOINT_AUTH`         |
| Rate limited (HTTP 429)                                                   | `ENDPOINT_RATE_LIMITED` |
| Request rejected as too large (HTTP 413 or equivalent provider message)   | `LIMIT_EXCEEDED`        |
| No response within the request timeout                                    | `TIMEOUT`               |
| Any other error status, or an error object returned with a success status | `ENDPOINT_ERROR`        |

The message MUST include the endpoint's own error text, truncated, with any secret removed.

#### Scenario — Error inside a success response

Given the endpoint returns HTTP 200 with a body containing an `error` object  
When the tool processes the response  
Then the call fails with `ENDPOINT_ERROR` carrying that error's message

### REQ-019 — Response format tolerance

The server MUST correctly read the model's reply from any of these response forms:

- a single JSON chat completion body;
- a server-sent event stream of chunks;
- a JSON body followed by `data: [DONE]` or other trailing stream markers;
- reply content wrapped in a Markdown code fence;
- reply content split across chunks.

#### Scenario — Trailing done marker

Given a response body consisting of a JSON chat completion followed by `data: [DONE]`  
When the tool processes it  
Then the reply is parsed and the call succeeds

### REQ-020 — Empty or truncated reply

An empty reply MUST fail with code `EMPTY_RESPONSE`. A reply cut off by the output-token limit MUST either be returned with a warning that it is truncated or fail with `ENDPOINT_ERROR`; it MUST NOT be presented as complete.

### REQ-021 — Media not processed

When the endpoint's reported input token usage is inconsistent with the video having been processed, the call MUST fail with code `MEDIA_NOT_PROCESSED`, explaining that the endpoint probably ignored the video and naming the other request shapes to try. The check MUST hold when the endpoint adds a fixed token overhead of its own to every request. When usage is not reported, the result MUST include a warning that video processing could not be confirmed.

The check MUST be on by default. The operator MAY turn it off through configuration, in which case the result MUST include a warning that video processing was not verified.

#### Scenario — Wrong request shape

Given an endpoint that ignores the configured request shape and answers from the text prompt alone  
When it reports input usage close to that of the text prompt  
Then the call fails with `MEDIA_NOT_PROCESSED` instead of returning the model's answer

#### Scenario — Ignored video behind fixed overhead

Given an endpoint that adds about 2,000 input tokens of its own to every request  
And it silently drops the video part of a 15-second clip, reporting 2,074 input tokens where the processed clip costs about 3,400  
When the tool processes the response  
Then the call fails with `MEDIA_NOT_PROCESSED`

#### Scenario — Check disabled

Given the operator turned the check off  
When an endpoint reports input usage close to that of the text prompt  
Then the answer is returned with a warning that video processing was not verified

### REQ-022 — Timeline validation

Timeline entries whose times fall outside the analyzed range MUST be removed from the result and reported in a warning.

#### Scenario — Hallucinated timestamp

Given a 15-second analyzed range starting at 0  
When the model reports a moment at 42 seconds  
Then that entry is absent from the timeline and a warning reports one entry removed

### Operation

### REQ-023 — Missing ffmpeg

When ffmpeg is not available, the understand-video tool MUST fail with code `DEPENDENCY_MISSING` naming ffmpeg with install guidance. The server MUST still start and the server info tool MUST still work.

### REQ-024 — Cancellation and cleanup

When the client cancels a call, the server MUST stop the download, preparation, and endpoint request for that call. Temporary media for a call MUST be removed when the call ends, whether it succeeded, failed, or was cancelled.

### REQ-025 — Concurrency bound

The server MUST bound the number of analyses running at once by an operator-adjustable setting, so that parallel agent calls cannot exhaust disk, memory, or CPU.

### REQ-026 — Error reporting convention

Tool errors MUST carry a machine-readable code both as a `[CODE]` prefix in the error text and in result metadata, following the convention of the author's existing MCP packages.

## Non-Functional Requirements

### NFR-001 — No secret disclosure

The API key and any caller-supplied `Authorization` or `Cookie` header values MUST NOT appear in tool results, error messages, logs, or the server info tool output.

### NFR-002 — No video content in logs

Logs MUST NOT contain base64 media, transcripts, or model answers. They MAY contain source host, durations, sizes, timings, codes, and token counts.

### NFR-003 — Offline test suite

The default test suite MUST pass without network access, without an endpoint, and without committed third-party video content. Any live endpoint test MUST run only when explicitly enabled by configuration.

### NFR-004 — Supported platforms

The package MUST install and start through `npx` on Node.js 22.21 or newer on macOS, Linux, and Windows, given ffmpeg on PATH.

## Constraints

- TypeScript, published to npm as `@granitebps/video-understanding-mcp`, public access, MIT license.
- Repository `github.com/granitebps/video-understanding-mcp`; MCP Registry name `io.github.granitebps/video-understanding-mcp`.
- Packaging, CI, and release process follow `@granitebps/twitter-mcp`, including its MCP SDK generation (`@modelcontextprotocol/server` v2), check scripts, `server.json`, tag-driven release, and documentation set (README, CHANGELOG, CONTRIBUTING, RELEASE, SECURITY, `.env.example`).
- ffmpeg (with ffprobe) is a required system dependency and yt-dlp an optional one; neither is bundled or downloaded by the package.
- The package must work only through the OpenAI-compatible chat completions interface.
- Public code and documentation must be provider-neutral: they must not name or recommend a specific personal router setup, tunnel, or subscription-based provider account.
- Publishing a release (npm, MCP Registry, GitHub release) requires explicit approval by the author and is not part of accepting this spec.
- From 1.0 on, the tool names, input fields, the REQ-002 result structure, and the error codes are a public contract: removing or renaming any of them requires a new major version.

## Assumptions

- Accepted: the video is sent inline (base64) in the chat completion request; with the default payload limit this stays within Gemini's recommended inline request size and common gateway request-size limits.
- Accepted (2026-11-09, supersedes the earlier `video_url` default): the default request shape is `image_url`, because it is the only shape verified live on more than one endpoint (9router and OpenRouter, both with Gemini 3.8 Flash). `video_url` remains supported on the strength of provider documentation but is not live-verified, because OpenRouter requires a $5 minimum top-up to enable video requests. A wrong shape fails loudly through REQ-021, and the operator selects another shape by configuration.
- Low risk: callers use this mainly for short-form social video (under about 3 minutes); longer videos are handled through ranges.
- Low risk: models asked for the REQ-002 structure return it often enough that the unstructured fallback is the exception.

## Documentation obligations

The README MUST state: required and optional system dependencies with install commands; that the video and question are sent to the configured endpoint; the supported request shapes and which providers are known to use each; which endpoints and models the release was tested against; that users are responsible for having the right to download and analyze the content they submit; that the network restriction of REQ-008 covers page URLs only at the initial host, because yt-dlp performs its own follow-up requests; and every configuration setting with its default.
