# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.0.2 — 2026-11-13

### Added

- `VIDEO_EXTRA_HEADERS` sends extra headers, given as a JSON object, with every endpoint request, for endpoints behind an auth proxy such as Cloudflare Access (`CF-Access-Client-Id` and `CF-Access-Client-Secret`). It cannot replace `Authorization`, `Accept`, or `Content-Type`; its values are redacted from errors like the API key; and an invalid value stops the server at startup with a message that names keys only.

## 1.0.1 — 2026-11-09

### Fixed

- Errors such as Google's "Invalid JSON payload received" (an unsupported request field) are reported as `ENDPOINT_ERROR` instead of `LIMIT_EXCEEDED`; only real request-size messages map to `LIMIT_EXCEEDED`.
- yt-dlp now runs with `--ignore-config`, so user or system yt-dlp config files cannot change formats, outputs, or skip downloads.
- A page URL that yt-dlp finishes without downloading is reported as `SOURCE_UNAVAILABLE`; `LIMIT_EXCEEDED` is used only when yt-dlp reports the download limit.
- ffmpeg, ffprobe, or yt-dlp installed while the server runs is detected on the next call instead of after a restart.
- The ignored-video check scales its minimum with a requested `fps` below 1, so silent clips sampled slowly are not rejected.

### Changed

- Portrait videos are prepared with the shorter side at up to 480 pixels (for example 480×854 instead of 270×480), keeping small on-screen text readable. Gemini charged the same prompt tokens in testing; the upload is about twice as large.

### Security

- ffmpeg and ffprobe read inputs with `-protocol_whitelist file`, and playlist or concatenation formats (such as HLS) are rejected as `INVALID_MEDIA` before encoding, so a media file cannot make them fetch network resources or pass other files to the endpoint.

## 1.0.0 — 2026-11-09

### Added

- `understand_video` tool: analyzes a page URL (through yt-dlp), a direct media URL with optional headers, or an allowlisted local file with any OpenAI-compatible endpoint whose model accepts video, and returns `answer`, `summary`, `speech`, `on_screen_text`, `timeline`, and `analysis`.
- `get_server_info` tool: endpoint host and model, request format, limits, local-file policy, and ffmpeg/yt-dlp availability, without secrets.
- Four request formats for attaching video (`video_url`, `image_url`, `file`, `input_file`), selected with `VIDEO_PART_FORMAT`.
- Detection of endpoints that silently ignore the video (`MEDIA_NOT_PROCESSED`), using a parallel text-only baseline request.
- Configurable duration, upload, download, timeout, concurrency, and output-token limits.
- Network restriction for downloads, local-file allowlist, and caller-header scoping.
