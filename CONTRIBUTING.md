# Contributing

## Development setup

Use Node.js 22.21.0 or newer, and install ffmpeg (with ffprobe) so the media tests can generate their fixtures.

```bash
npm ci
npm run check
```

Tests must not call a real model endpoint, download real videos, or need credentials. Use the fake endpoint in `test/helpers/fake-endpoint.ts`, the fake yt-dlp in `test/helpers/fake-yt-dlp.mjs`, and the ffmpeg-generated fixtures in `test/fixtures/make-fixtures.ts`. Do not commit third-party video files.

Live checks against a real endpoint live under `test/live/` and run only with `npm run test:live` and explicit `VIDEO_LIVE_*` settings.

Preserve the [v1 compatibility contract](docs/v1-compatibility.md) unless a change is explicitly planned as breaking.

## Pull requests

Keep changes focused, add tests for behavior changes, and update the README or changelog when user-facing behavior changes. Run `npm run check` before opening a pull request.

Release preparation follows [RELEASE.md](RELEASE.md). A release pull request may prepare version metadata and notes, but it must not create or push the release tag. Tagging and publication require separate approval for the exact version and commit.

Report security problems through the process in `SECURITY.md`, not a public issue.
