# Version 1 compatibility contract

This document records the public MCP contract established by `@granitebps/video-understanding-mcp` 1.0.0. Patch and minor releases in the 1.x line preserve it. Removing or renaming a tool, an input field, a result field, an error code, or a configuration variable is a breaking change and belongs in a new major release.

Minor releases may add optional input fields, result fields, warning codes, error codes, request formats, and configuration variables.

## Runtime and transport

- The server runs over standard input/output (`stdio`).
- The executable is `video-understanding-mcp` from the `@granitebps/video-understanding-mcp` npm package.
- Node.js 22.21.0 or newer is supported.
- ffmpeg and ffprobe are required system dependencies; yt-dlp is optional and needed only for page URLs.

## Tools

| Tool               | Input                                                                                      | Structured result                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `understand_video` | `source` (required); optional `headers`, `question`, `start_seconds`, `end_seconds`, `fps` | `answer`, `summary`, `speech`, `on_screen_text`, `timeline`, `analysis`                                              |
| `get_server_info`  | No fields                                                                                  | `name`, `version`, `tools`, `endpoint`, `limits`, `verifyMedia`, `localFiles`, `allowPrivateNetwork`, `dependencies` |

### `understand_video` result

- `answer` — string; the answer to `question`, or a general description.
- `summary` — string.
- `speech` — `{ present: boolean, language: string | null, transcript: string }`; the transcript is in the original language.
- `on_screen_text` — string array.
- `timeline` — `{ start: number, description: string }` array; `start` is seconds from the start of the source video.
- `analysis` — `{ configuredModel, reportedModel, usage: { promptTokens, completionTokens } | null, sourceDurationSeconds, analyzedRange: { start, end }, partFormat, warnings: { code, message }[] }`.

Warning codes in 1.0.0: `STRUCTURED_FIELDS_UNAVAILABLE`, `TIMELINE_ENTRIES_REMOVED`, `RANGE_CLAMPED`, `FPS_NOT_APPLIED`, `MEDIA_UNVERIFIED`, `TRUNCATED`.

## Errors

Tool errors set `isError: true`, start the text content with `[CODE]`, and carry `{ code, message, retryable, retryAfterSeconds? }` in both `structuredContent.error` and `_meta["video-understanding-mcp/error"]`.

Error codes: `INVALID_INPUT`, `CONFIG_MISSING`, `DEPENDENCY_MISSING`, `SOURCE_UNAVAILABLE`, `SOURCE_NOT_ALLOWED`, `INVALID_MEDIA`, `LIMIT_EXCEEDED`, `ENDPOINT_UNREACHABLE`, `ENDPOINT_AUTH`, `ENDPOINT_RATE_LIMITED`, `ENDPOINT_ERROR`, `TIMEOUT`, `EMPTY_RESPONSE`, `MEDIA_NOT_PROCESSED`, `INTERNAL_ERROR`.

Input that fails the tool's schema (for example a negative `start_seconds`) is rejected by the MCP layer as an invalid-params protocol error, not a tool result.

## Configuration

`VIDEO_BASE_URL`, `VIDEO_API_KEY`, `VIDEO_MODEL`, `VIDEO_PART_FORMAT`, `VIDEO_MAX_DURATION_SECONDS`, `VIDEO_MAX_UPLOAD_MB`, `VIDEO_MAX_DOWNLOAD_MB`, `VIDEO_REQUEST_TIMEOUT_MS`, `VIDEO_MAX_CONCURRENCY`, `VIDEO_MAX_OUTPUT_TOKENS`, `VIDEO_VERIFY_MEDIA`, `VIDEO_ALLOWED_DIRS`, `VIDEO_ALLOW_PRIVATE_NETWORK`, `VIDEO_FFMPEG_PATH`, `VIDEO_FFPROBE_PATH`, `VIDEO_YTDLP_PATH`. Defaults are listed in the README. Changing a default is a minor change when it does not remove behavior that was available before.
