# Video Understanding MCP v1.0.0

First release. AI agents can now watch a video and answer questions about it through any OpenAI-compatible endpoint whose model accepts video.

## Install

Requires Node.js 22.21.0 or newer and ffmpeg. yt-dlp is optional and needed only for page URLs.

```bash
npx -y @granitebps/video-understanding-mcp
```

Configure at least `VIDEO_BASE_URL` and `VIDEO_MODEL` (and `VIDEO_API_KEY` when the endpoint needs one). See the README for every setting.

## Highlights

- `understand_video` accepts page URLs, direct media URLs with headers, and allowlisted local files, and returns an answer, summary, transcript, on-screen text, and a timeline.
- Four request formats for attaching video, so one server works across gateways that disagree on the format.
- Calls fail with `MEDIA_NOT_PROCESSED` instead of returning an invented answer when the endpoint ignored the video.
- Downloads cannot reach private networks, local files are off unless allowlisted, and credentials never appear in results or logs.

## Known limitations

- Videos are sent inline, so each call is bounded by the upload limit (15 MB by default after re-encoding) and the duration limit (300 s by default). Use `start_seconds` and `end_seconds` for longer videos.
- When a router serves the baseline and the real request from different providers, the ignored-video check can misjudge; see the README.
- For page URLs, only the page host is checked against the network restriction; yt-dlp makes its own follow-up requests.
