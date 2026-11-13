# Video Understanding MCP v1.0.2

Adds one optional setting for endpoints behind an auth proxy. Tool names, inputs, results, error codes, and existing settings are unchanged.

## Install

```bash
npx -y @granitebps/video-understanding-mcp@1.0.2
```

## Added

- `VIDEO_EXTRA_HEADERS` takes a JSON object of header names and values and sends them with every endpoint request. Use it when the endpoint sits behind an auth proxy, for example a Cloudflare Access service token:

  ```bash
  VIDEO_EXTRA_HEADERS='{"CF-Access-Client-Id":"...","CF-Access-Client-Secret":"..."}'
  ```

  Without these headers, Cloudflare Access answers with an HTML sign-in page, which this server reports as `EMPTY_RESPONSE`.

  The setting cannot replace `Authorization`, `Accept`, or `Content-Type`. Header values are redacted from errors like the API key. Invalid JSON, invalid header names, and non-string or multi-line values stop the server at startup, and the error names keys only.

## Compatibility

No breaking changes; the new setting is optional. See the [v1 compatibility contract](v1-compatibility.md).
