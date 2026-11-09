# Video Understanding MCP

An [MCP](https://modelcontextprotocol.io) server that lets AI agents watch a video and answer questions about it: what is shown, what is said, what text appears on screen, and when. It works with any OpenAI-compatible chat completions endpoint whose model accepts video, such as Gemini models served through a gateway.

Give it a TikTok, YouTube, or X post URL, a direct media URL from a scraper, or a local file, plus a question. It downloads and shrinks the video, sends it to your endpoint, and returns a structured answer:

```json
{
  "answer": "The coach demonstrates three squat variations and warns against letting the knees cave in.",
  "summary": "A short workout tutorial showing bodyweight squats with form cues.",
  "speech": {
    "present": true,
    "language": "en",
    "transcript": "Keep your chest up and push through your heels..."
  },
  "on_screen_text": ["3 x 12 reps", "Rest 60s"],
  "timeline": [{ "start": 12.0, "description": "Switches to jump squats" }],
  "analysis": {
    "configuredModel": "your-model",
    "reportedModel": "gemini-...",
    "usage": { "promptTokens": 5400, "completionTokens": 480 },
    "sourceDurationSeconds": 58.4,
    "analyzedRange": { "start": 0, "end": 58.4 },
    "partFormat": "image_url",
    "warnings": []
  }
}
```

## Requirements

- Node.js 22.21.0 or newer.
- **ffmpeg** with ffprobe (required). macOS: `brew install ffmpeg`. Debian/Ubuntu: `sudo apt-get install ffmpeg`. Windows: `winget install ffmpeg`.
- **yt-dlp** (optional, needed only for page URLs such as TikTok or YouTube links). macOS: `brew install yt-dlp`. Others: `pipx install yt-dlp`.
- An OpenAI-compatible endpoint and a model that accepts video input.

Check what the server found with the `get_server_info` tool.

## Setup

Add the server to your MCP client. For example, in a JSON-configured client:

```json
{
  "mcpServers": {
    "video-understanding": {
      "command": "npx",
      "args": ["-y", "@granitebps/video-understanding-mcp"],
      "env": {
        "VIDEO_BASE_URL": "https://your-endpoint.example/v1",
        "VIDEO_MODEL": "your-video-capable-model",
        "VIDEO_API_KEY": "your-endpoint-api-key"
      }
    }
  }
}
```

The server also reads a `.env` file from its working directory. See [`.env.example`](.env.example).

## Tools

### `understand_video`

| Input                          | Description                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`                       | Required. A page URL (resolved with yt-dlp), a direct media URL, or an absolute local path inside an allowed directory.                                                 |
| `headers`                      | Optional request headers for a direct media URL, such as `Referer` or `Cookie` returned by a scraper. Sent only to that URL's host.                                     |
| `question`                     | Optional. What to find out. Without it you get a general description.                                                                                                   |
| `start_seconds`, `end_seconds` | Optional range of the source video to analyze. Needed for videos longer than the duration limit; a short range also gives more detail for fast motion such as workouts. |
| `fps`                          | Optional frame-sampling hint, applied only by request formats that support it.                                                                                          |

The result fields are shown above. `timeline` times are seconds from the start of the source video, even when a range was analyzed. `analysis.warnings` explains anything the server adjusted or could not confirm.

### `get_server_info`

Shows the version, endpoint host and model, request format, limits, local-file policy, and whether ffmpeg, ffprobe, and yt-dlp are available. It never shows the API key.

## Request formats

OpenAI-compatible endpoints disagree on how a video is attached to a chat request, and some silently ignore a format they do not understand. Pick the format your endpoint documents with `VIDEO_PART_FORMAT`:

| `VIDEO_PART_FORMAT`   | Request part                                                                            | Known to be used by                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `video_url`           | `{"type":"video_url","video_url":{"url":"data:video/mp4;base64,..."}}`                  | OpenRouter, Alibaba Model Studio (Qwen), Tencent TokenHub, vLLM                                               |
| `image_url` (default) | `{"type":"image_url","image_url":{"url":"data:video/mp4;base64,..."}}`                  | OpenRouter; routers that translate image parts by the data URL's MIME type, for example 9router's Gemini path |
| `file`                | `{"type":"file","file":{"file_data":"data:video/mp4;base64,...","format":"video/mp4"}}` | LiteLLM (Gemini, vLLM)                                                                                        |
| `input_file`          | `{"type":"input_file","file_data":"data:video/mp4;base64,...","mime_type":"video/mp4"}` | Requesty                                                                                                      |

`fps` is sent only with `video_url` and `file`.

If the endpoint ignores the video, the call fails with `MEDIA_NOT_PROCESSED` instead of returning an answer the model made up. The server detects this by sending the same prompt without the video in parallel (16 output tokens at most) and comparing prompt-token usage, which cancels out any fixed overhead the endpoint adds. This doubles the request count. Turn it off with `VIDEO_VERIFY_MEDIA=false` only for endpoints that report token usage unusually.

## Configuration

| Variable                      | Default     | Description                                                                                                      |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `VIDEO_BASE_URL`              | —           | Required. Endpoint base URL, for example `https://host/v1`.                                                      |
| `VIDEO_MODEL`                 | —           | Required. Model name or router alias.                                                                            |
| `VIDEO_API_KEY`               | —           | Sent as `Authorization: Bearer <key>`.                                                                           |
| `VIDEO_PART_FORMAT`           | `image_url` | `image_url`, `video_url`, `file`, or `input_file`.                                                               |
| `VIDEO_MAX_DURATION_SECONDS`  | `300`       | Longest analyzed range (1–7200).                                                                                 |
| `VIDEO_MAX_UPLOAD_MB`         | `15`        | Largest prepared video sent inline, before base64 (1–100).                                                       |
| `VIDEO_MAX_DOWNLOAD_MB`       | `500`       | Largest source download (1–10000).                                                                               |
| `VIDEO_REQUEST_TIMEOUT_MS`    | `180000`    | Endpoint request timeout (5000–900000).                                                                          |
| `VIDEO_MAX_CONCURRENCY`       | `2`         | Analyses running at once; further calls wait (1–16).                                                             |
| `VIDEO_MAX_OUTPUT_TOKENS`     | `8192`      | `max_tokens` for the answer (256–65536).                                                                         |
| `VIDEO_VERIFY_MEDIA`          | `true`      | Fail calls when the endpoint evidently ignored the video.                                                        |
| `VIDEO_ALLOWED_DIRS`          | —           | Directories local files may be read from, separated by `:` (`;` on Windows). Local files are refused when unset. |
| `VIDEO_ALLOW_PRIVATE_NETWORK` | `false`     | Allow downloads from loopback and private addresses.                                                             |
| `VIDEO_FFMPEG_PATH`           | `ffmpeg`    | ffmpeg executable.                                                                                               |
| `VIDEO_FFPROBE_PATH`          | `ffprobe`   | ffprobe executable.                                                                                              |
| `VIDEO_YTDLP_PATH`            | `yt-dlp`    | yt-dlp executable.                                                                                               |

Invalid values stop the server at startup with a message naming the variable. When `VIDEO_BASE_URL` or `VIDEO_MODEL` is missing the server still starts, and `understand_video` returns `CONFIG_MISSING`.

## How a call works

1. Checks the configuration, that ffmpeg is installed, and that the base URL answers. If it does not, the call fails with `ENDPOINT_UNREACHABLE` before anything is downloaded.
2. Gets the video: reads an allowed local file, downloads a direct media URL, or resolves a page URL with yt-dlp (refusing over-long videos before downloading).
3. Cuts the requested range and re-encodes it to at most 480p H.264 with mono AAC audio, dropping to 360p if needed to fit the upload limit.
4. Sends it inline as base64 with the question, plus the text-only baseline request.
5. Validates the reply, drops timeline moments outside the analyzed range, and converts times to source-video seconds.

Temporary files are deleted after every call, including failed and cancelled ones.

## Errors

Errors start with a code in brackets, for example `[LIMIT_EXCEEDED] The analyzed range is 1500 s, over the 300 s limit ...`, and carry the same code in `_meta["video-understanding-mcp/error"]`.

| Code                    | Meaning                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `INVALID_INPUT`         | Bad range or source string.                                                               |
| `CONFIG_MISSING`        | `VIDEO_BASE_URL` or `VIDEO_MODEL` is not set.                                             |
| `DEPENDENCY_MISSING`    | ffmpeg/ffprobe, or yt-dlp for a page URL, is not installed.                               |
| `SOURCE_UNAVAILABLE`    | The page or media URL could not be fetched or extracted (expired link, unsupported site). |
| `SOURCE_NOT_ALLOWED`    | Local file outside the allowed directories, or a download target on a private network.    |
| `INVALID_MEDIA`         | The source has no video stream.                                                           |
| `LIMIT_EXCEEDED`        | Over the duration, upload, or download limit, or rejected as too large by the endpoint.   |
| `ENDPOINT_UNREACHABLE`  | The configured base URL is not reachable.                                                 |
| `ENDPOINT_AUTH`         | The endpoint rejected the API key.                                                        |
| `ENDPOINT_RATE_LIMITED` | The endpoint rate-limited the request; `retryAfterSeconds` is set when known.             |
| `ENDPOINT_ERROR`        | Any other endpoint error, including errors returned with a success status.                |
| `TIMEOUT`               | The endpoint or a media step took too long.                                               |
| `EMPTY_RESPONSE`        | The model returned no text.                                                               |
| `MEDIA_NOT_PROCESSED`   | The endpoint evidently ignored the video; try another `VIDEO_PART_FORMAT`.                |
| `INTERNAL_ERROR`        | Unexpected failure.                                                                       |

## Privacy and content rights

- The analyzed clip and the question are sent to the endpoint you configure. Use an endpoint whose data handling you accept.
- You are responsible for having the right to download and analyze the content you submit, and for following the terms of the sites you download from.
- Logs go to stderr as one JSON line per call (code, source host, duration, size, timing, token count). They never contain media, transcripts, answers, URLs with query strings, headers, or the API key.

## Security

- Downloads refuse loopback, private, link-local, and other non-public addresses, including through redirects, unless `VIDEO_ALLOW_PRIVATE_NETWORK=true`. The endpoint itself may be on a local address.
- Local files are read only from `VIDEO_ALLOWED_DIRS`, after resolving symbolic links.
- Caller-supplied headers go only to the original host and are never passed to yt-dlp.

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Known limitations

- Videos are sent inline in the request, so each call is bounded by the upload limit. Use `start_seconds` and `end_seconds` for long videos; the server does not split them automatically.
- For page URLs, the network restriction checks only the page's host. yt-dlp makes its own follow-up requests to media servers.
- When a router falls back between providers, the baseline and the real request can be served by different providers whose fixed overhead differs, so the ignored-video check can misjudge. `analysis.reportedModel` shows which model answered.
- Which upstream provider served a request is not visible beyond the model name the endpoint reports.
- Only stdio transport is provided.

## Development

```bash
npm ci
npm run check
```

`npm run check` runs formatting, lint, type checks, tests with coverage, and the package checks. Tests use a fake endpoint, a fake yt-dlp, and ffmpeg-generated clips, so they need ffmpeg but no network or credentials. `npm run test:live` runs opt-in checks against a real endpoint configured with `VIDEO_LIVE_*` variables (see `.env.example`).

See [CONTRIBUTING.md](CONTRIBUTING.md) and [RELEASE.md](RELEASE.md).

## License

[MIT](LICENSE)
