# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.0.0 — Unreleased

### Added

- `understand_video` tool: analyzes a page URL (through yt-dlp), a direct media URL with optional headers, or an allowlisted local file with any OpenAI-compatible endpoint whose model accepts video, and returns `answer`, `summary`, `speech`, `on_screen_text`, `timeline`, and `analysis`.
- `get_server_info` tool: endpoint host and model, request format, limits, local-file policy, and ffmpeg/yt-dlp availability, without secrets.
- Four request formats for attaching video (`video_url`, `image_url`, `file`, `input_file`), selected with `VIDEO_PART_FORMAT`.
- Detection of endpoints that silently ignore the video (`MEDIA_NOT_PROCESSED`), using a parallel text-only baseline request.
- Configurable duration, upload, download, timeout, concurrency, and output-token limits.
- Network restriction for downloads, local-file allowlist, and caller-header scoping.
