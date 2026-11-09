# Video Understanding MCP v1.0.1

A patch release with bug fixes and hardening. Tool names, inputs, results, error codes, and settings are unchanged.

## Install

```bash
npx -y @granitebps/video-understanding-mcp@1.0.1
```

## Fixed

- Google's "Invalid JSON payload received" errors are now `ENDPOINT_ERROR`, not `LIMIT_EXCEEDED`, so agents are no longer told to shorten the range when the request format is the problem.
- yt-dlp ignores user and system config files (`--ignore-config`), and a page that yields no file is reported as `SOURCE_UNAVAILABLE` unless yt-dlp says the download limit was hit.
- Installing ffmpeg or yt-dlp while the server runs takes effect on the next call.
- The ignored-video check no longer rejects silent clips analyzed with a low `fps`.

## Changed

- Portrait videos keep up to 480 pixels on their shorter side (480×854 instead of 270×480). In testing the prompt-token cost was unchanged and the upload about twice as large; long portrait clips may fall back to 360 pixels to stay within the upload limit.

## Security

- ffmpeg and ffprobe open inputs as local files only, and playlist or concatenation formats such as HLS are rejected.

## Compatibility

No breaking changes. See the [v1 compatibility contract](v1-compatibility.md).
