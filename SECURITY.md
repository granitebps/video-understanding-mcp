# Security policy

## Supported versions

Security fixes target the latest published release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or exposed credential. Use GitHub's private vulnerability reporting for this repository. Include the affected version, impact, reproduction steps, and any proposed mitigation.

Never include an endpoint API key, cookie, or authorization header in a report. Revoke and replace any credential that may have been exposed.

## Security model

- **Credentials.** `VIDEO_API_KEY` is read from the process environment, sent only to the configured endpoint as a bearer token, and never written to tool results or logs. Restrict access to MCP client configuration files and avoid passing secrets on the command line.
- **Data sent to the endpoint.** Each analyzed video clip and the agent's question are sent to the configured endpoint. Choose an endpoint whose data handling you accept.
- **Local files.** Local paths are refused unless `VIDEO_ALLOWED_DIRS` lists the directories that may be read. Paths are resolved through symbolic links before the check.
- **Network access.** Downloads refuse loopback, private, link-local, and other non-public addresses, including through redirects, unless `VIDEO_ALLOW_PRIVATE_NETWORK=true`. For page URLs only the page host is checked; yt-dlp makes its own follow-up requests.
- **Caller headers.** Headers passed with a media URL go only to that URL's host and are dropped after a redirect to another host. They are never passed to yt-dlp.
- **Media inputs.** ffmpeg and ffprobe open inputs with `-protocol_whitelist file`, so a media file cannot make them fetch network resources. Playlist and concatenation formats such as HLS are rejected while probing, before anything is encoded or sent to the endpoint. yt-dlp runs with `--ignore-config`.
- **Processes.** ffmpeg, ffprobe, and yt-dlp run without a shell, with timeouts, and are killed when a call is cancelled. Temporary media is deleted after every call.
